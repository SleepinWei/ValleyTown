import { actionRegistry, buildActions } from './actions';
import { planning, replanEligibility } from './planning';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { World, isRunning } from './world';
import type { SimulationWorker } from './worker-client';
import { migrateWorld } from './migrations';
import { location, items, pathfind, distance } from '../shared/map';

export async function createApp(world:World|SimulationWorker,options:{internal?:boolean}={}){
  const app=Fastify({logger:false,bodyLimit:40_000});
  const session=randomBytes(32).toString('hex');
  const sockets=new Map<WebSocket,boolean>();
  await app.register(websocket);
  app.addHook('onRequest',async(req,reply)=>{
    if(options.internal||!req.url.startsWith('/api'))return;
    const host=req.headers.host??'';
    if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))return reply.code(403).send({error:'只允许本地访问'});
    const origin=req.headers.origin;
    if(origin){const u=new URL(origin);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.host!==host)return reply.code(403).send({error:'请求来源不匹配'});}
    if(req.url.split('?')[0]==='/api/bootstrap'&&req.method==='GET'){reply.header('Set-Cookie',`valley_session=${session}; HttpOnly; SameSite=Strict; Path=/`);return;}
    if(!req.headers.cookie?.split(';').some(c=>c.trim()===`valley_session=${session}`))return reply.code(401).send({error:'会话已过期，请刷新页面'});
  });
  app.setErrorHandler((error,_req,reply)=>{const e=error as Error;reply.code(400).send({error:e instanceof z.ZodError?'请求参数无效':e.message});});
  app.get('/api/bootstrap',async()=>({ok:true}));
  app.get('/api/world',async(req)=>world.snapshot((req.query as any).view==='observer'));
  app.get('/api/live',{websocket:true},(socket,req)=>{
    const observer=(req.query as any).view==='observer';sockets.set(socket,observer);socket.send(JSON.stringify(world.snapshot(observer)));socket.on('close',()=>sockets.delete(socket));
  });
  if('request' in world){
    app.all('/api/*',async(req,reply)=>{const result=await world.request(req.method,req.url,req.body);return reply.code(result.status).send(result.body);});
    world.onSnapshot=()=>broadcast();
    world.onFailure=()=>{for(const socket of sockets.keys())socket.close(1011,'模拟线程停止，请重启服务');};
    app.addHook('onClose',async()=>{for(const socket of sockets.keys())socket.close();await world.close();});
  }else{
  app.get('/api/action-policy/:actorId',async req=>{
    const a=world.actor(z.string().parse((req.params as any).actorId)),eligibility=replanEligibility(a,world.state.clock);
    return {catalog:actionRegistry.map(({id,category,description})=>({id,category,description})),candidates:buildActions(world,a),planning:planning(a,world.state.clock),canReplan:eligibility.allowed,replanReason:eligibility.reason,localTask:a.localTask??null,mode:world.state.mode,reflection:process.env.DEEPSEEK_REFLECTION==='true'?'model':'local',usage:world.store.db.prepare("SELECT purpose,COUNT(*) AS calls,SUM(input) AS input,SUM(output) AS output FROM calls WHERE provider='DeepSeek' GROUP BY purpose").all()};
  });
  app.get('/api/decision-lab',async()=>({runs:world.store.labs(),traces:world.store.traces(200).filter(t=>t.worldId===world.state.id)}));
  app.post('/api/decision-lab',async req=>{
    const b=z.object({actorId:z.string().max(100),scenario:z.enum(['baseline','rain','tired','enemy','lover']),repeats:z.number().int().min(1).max(10).default(3),paired:z.boolean().default(true),profile:z.enum(['synthetic','resident']).default('synthetic')}).parse(req.body);
    const run=world.lab.start(b.actorId,b.scenario,b.repeats,b.paired,b.profile);return {id:run.id};
  });
  app.post('/api/decision-lab/stop',async()=>{world.pause();return {ok:true};});
  app.post('/api/control',async req=>{
    const b=z.object({action:z.enum(['pause','resume','speed','mode','limit']),value:z.union([z.string(),z.number()]).optional()}).parse(req.body);
    if(b.action==='pause')world.pause();if(b.action==='resume')world.resume();
    if(b.action==='speed'){const speed=z.number().finite().min(5).max(120).parse(b.value);world.setDayMinutes(speed);}
    if(b.action==='mode'){if(isRunning(world.state)||world.active)throw new Error('请暂停并等待在途请求结束，再切换模式');world.state.mode=z.enum(['demo','live']).parse(b.value);world.state.notice=world.state.mode==='demo'?'规则演示模式 · 无模型费用':'真实模型模式 · 使用 Jev 与 DeepSeek';}
    if(b.action==='limit')world.store.setLimit(z.number().int().positive().parse(b.value));
    world.persist();return {ok:true};
  });
  app.post('/api/commands',async req=>{
    if(world.lab.active)throw new Error('决策实验期间世界冻结，请先停止实验');
    const b=z.object({commandId:z.string().min(1).max(100),type:z.enum(['move','talk','message','end','gift','invite','confess','apologize','breakup','contribute','buy','work','outdoor','cancel-outdoor']),activity:z.enum(['fishing','jogging','basketball','hiking','hunting','rest']).optional(),target:z.string().max(100).optional(),item:z.string().max(40).optional(),text:z.string().max(1000).optional(),x:z.number().finite().optional(),y:z.number().finite().optional()}).parse(req.body);
    return world.command(b.commandId,()=>{
      if(b.type==='end'){if(world.state.player.conversation)world.endConversation(world.state.player.conversation);return {ok:true};}
      world.requireRunning();
      if(b.type==='outdoor'){if(!b.activity||!b.target)throw new Error('请选择活动与地点');world.startOutdoor('player',b.activity,b.target);}
      if(b.type==='cancel-outdoor')world.cancelOutdoor('player');
      if(b.type==='move'){world.cancelOutdoor('player');if(world.state.player.conversation)world.endConversation(world.state.player.conversation);let p=b.target?location(b.target).door:{x:b.x!,y:b.y!};if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('坐标无效');const path=pathfind(world.state.player,p);if(!path.length&&distance(world.state.player,p)>1)throw new Error('那里暂时无法到达');world.state.player.path=path;}
      if(b.type==='talk')return {conversationId:world.startConversation('player',b.target!).id};
      if(b.type==='message')world.sendMessage(b.target!,b.text?.trim()??'');
      if(b.type==='gift')world.gift(b.target!,b.item!);
      if(['invite','confess','apologize'].includes(b.type))world.requestSocial('player',b.target!,b.type as 'invite'|'confess'|'apologize');
      if(b.type==='breakup'){const a=world.actor(b.target!);if(a.life.spouse)throw new Error('婚姻需要通过家庭关系处理');if(a.partner!=='player')throw new Error('你们并未正式交往');a.partner=null;world.relationship(a,'player',{affection:-15,resentment:10});const e=world.event('relationship',`你结束了与${a.name}的恋爱关系。`,['player',a.id],['player',a.id]);world.memory(a,e.text,e.id,true);}
      if(b.type==='contribute')world.contribute('player',b.target!);
      if(b.type==='buy'){if(distance(world.state.player,location('market').door)>5)throw new Error('请先走到杂货铺');world.requireAvailable('merchant',true);const item=items[b.item!],merchant=world.actor('merchant');if(!item)throw new Error('物品不存在');if((merchant.inventory[b.item!]??0)<1)throw new Error('这件物品暂时售罄');if(world.state.player.coins<item.price)throw new Error('金币不足');merchant.inventory[b.item!]--;merchant.coins+=item.price;world.state.player.coins-=item.price;world.state.player.inventory[b.item!]=(world.state.player.inventory[b.item!]??0)+1;world.event('trade',`你买了一份${item.name}。`,['player','merchant'],['player','merchant']);}
      if(b.type==='work'){
        const place=locationsForWork.find(p=>distance(world.state.player,location(p.id).door)<5);if(!place)throw new Error('走到花圃、河岸或木工作坊，可以帮忙工作');
        const previous=world.state.events.findLast(e=>e.kind==='player-work');if(previous&&world.state.clock-previous.at<30)throw new Error('休息一下，半小时游戏时间后再工作');
        world.state.player.inventory[place.item]=(world.state.player.inventory[place.item]??0)+1;world.state.player.coins+=3;
        const e=world.event('player-work',`你在${location(place.id).name}帮了忙，获得${items[place.item].name}与 3 枚金币。`,['player'],['public']);
        for(const a of world.state.actors.filter(a=>a.life.status==='alive'&&!a.life.custody&&distance(a,world.state.player)<6)){world.relationship(a,'player',{trust:3,affection:2});(a.trustedEvents.player??=[]).push(e.id);world.memory(a,'亲眼看见玩家帮忙工作。',e.id,true);}
      }
      return {ok:true};
    });
  });
  app.get('/api/documents/:actorId',async req=>world.documents.list(z.string().parse((req.params as any).actorId)));
  app.post('/api/documents',async req=>{const b=z.object({id:z.string(),revision:z.number().int(),text:z.string().max(16000)}).parse(req.body);return world.documents.import(b.id,b.text,b.revision);});
  app.post('/api/documents/reload',async()=>{world.documents.scan(true);world.persist();return {errors:world.documents.errors()};});
  app.get('/api/saves',async()=>world.store.saves());
  app.post('/api/saves',async req=>{world.persist();world.documents.project();return {id:world.store.archive(world.state,z.object({label:z.string().max(80).default('手动存档')}).parse(req.body??{}).label)};});
  app.post('/api/saves/:id/restore',async req=>{
    if(isRunning(world.state)||world.active)throw new Error('先暂停并等待在途请求结束，再恢复存档');
    const restored=migrateWorld(world.store.restore((req.params as any).id));restored.status='paused_manual';restored.pending=[];restored.speechQueue=[];for(const c of restored.conversations)c.pending=false;for(const a of restored.actors)a.busy=false;
    world.invalidatePendingTraces('管理员恢复了存档，暂存决策不再执行');
    world.state=restored;world.state.notice='已恢复世界存档；token 历史用量保持不变。';world.documents.initialize();world.documents.restoreFromWorld();world.persist();return {ok:true};
  });
  world.onChange=()=>broadcast();
  let last=performance.now();const timer=setInterval(()=>{const now=performance.now();try{world.tick((now-last)/1000);}catch(e){world.pause();world.state.notice=`模拟异常，已暂停：${(e as Error).message}`;world.persist();}last=now;},100);
  const stream=setInterval(broadcast,500);
  app.addHook('onClose',async()=>{clearInterval(timer);clearInterval(stream);world.persist();for(const socket of sockets.keys())socket.close();});
  }
  const dist=resolve('dist');if(!options.internal&&existsSync(dist)){await app.register(fastifyStatic,{root:dist});app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api')?reply.code(404).send({error:'接口不存在'}):reply.sendFile('index.html'));}
  function broadcast(){for(const [socket,observer]of sockets)if(socket.readyState===1)socket.send(JSON.stringify(world.snapshot(observer)));}
  return app;
}
const locationsForWork=[{id:'garden',item:'flowers'},{id:'riverside',item:'fish'},{id:'workshop',item:'wood'}];
