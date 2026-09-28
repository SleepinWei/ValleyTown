import { z } from 'zod';
import { World, isRunning } from '../server/world';
import { setIncidentPace, triggerIncident } from '../server/incidents';
import { actionRegistry, buildActions } from '../server/actions';
import { planning, replanEligibility } from '../server/planning';
import { migrateWorld } from '../server/migrations';
import { location, items, pathfind, distance } from '../shared/map';
type Handler = (request: {body:any;query:any;params:Record<string,string>}) => unknown;
interface Routes { get(path:string, handler:Handler):unknown; post(path:string, handler:Handler):unknown; }
export function registerWorldRoutes(world:World, app:Routes) {
  const storyView=(query:unknown)=>z.object({view:z.enum(['player','observer']).default('player')}).parse(query).view;
  app.get('/api/stories/:actorId',async req=>world.stories.get(z.string().max(100).parse((req.params as any).actorId),storyView(req.query)));
  app.post('/api/stories/:actorId',async req=>world.stories.start(z.string().max(100).parse((req.params as any).actorId),storyView(req.query)));
  app.get('/api/story-jobs/:id',async req=>world.stories.job(z.string().uuid().parse((req.params as any).id),storyView(req.query)));
  app.get('/api/action-policy/:actorId',async req=>{
    const a=world.actor(z.string().parse((req.params as any).actorId)),eligibility=replanEligibility(a,world.state.clock);
    return {catalog:actionRegistry.map(({id,category,description})=>({id,category,description})),candidates:buildActions(world,a),planning:planning(a,world.state.clock),canReplan:eligibility.allowed,replanReason:eligibility.reason,localTask:a.localTask??null,mode:world.state.mode,reflection:world.store.reflectionEnabled?'model':'local',usage:world.store.callSummary()};
  });
  app.get('/api/decision-lab',async()=>({runs:world.store.labs(),traces:world.store.traces(200).filter(t=>t.worldId===world.state.id)}));
  app.post('/api/decision-lab',async req=>{
    const b=z.object({actorId:z.string().max(100),scenario:z.enum(['baseline','rain','tired','enemy','lover']),repeats:z.number().int().min(1).max(10).default(3),paired:z.boolean().default(true),profile:z.enum(['synthetic','resident']).default('synthetic')}).parse(req.body);
    const run=world.lab.start(b.actorId,b.scenario,b.repeats,b.paired,b.profile);return {id:run.id};
  });
  app.post('/api/decision-lab/stop',async()=>{world.pause();return {ok:true};});
  app.post('/api/control',async req=>{
    const b=z.object({action:z.enum(['pause','resume','speed','mode','limit','exchange','incident-pace']),value:z.union([z.string(),z.number()]).optional(),provider:z.enum(['DeepSeek','Jev']).optional()}).parse(req.body);
    if(b.action==='pause')world.pause();if(b.action==='resume')world.resume();
    if(b.action==='incident-pace'){if(world.lab.active)throw new Error('决策实验期间不能改变事件节奏');setIncidentPace(world,z.enum(['natural','showcase']).parse(b.value));}
    if(b.action==='speed'){const speed=z.number().finite().min(5).max(120).parse(b.value);world.setDayMinutes(speed);}
    if(b.action==='mode'){if(isRunning(world.state)||world.active)throw new Error('请暂停并等待在途请求结束，再切换模式');world.state.mode=z.enum(['demo','live']).parse(b.value);world.state.notice=world.state.mode==='demo'?'规则演示模式 · 无模型费用':'真实模型模式 · 使用 Jev 与 DeepSeek';}
    if(b.action==='limit')world.store.setLimit(z.enum(['DeepSeek','Jev']).parse(b.provider),z.number().finite().min(0).parse(b.value));
    if(b.action==='exchange')world.store.setExchange(z.number().finite().positive().max(100).parse(b.value));
    if(b.action==='limit'&&world.state.mode==='live'&&isRunning(world.state)&&world.store.exhaustedProvider())world.pause('paused_budget_limit');
    world.persist();return {ok:true};
  });
  app.post('/api/commands',async req=>{
    if(world.lab.active)throw new Error('决策实验期间世界冻结，请先停止实验');
    const b=z.object({commandId:z.string().min(1).max(100),type:z.enum(['move','talk','message','end','gift','invite','confess','apologize','breakup','contribute','buy','work','outdoor','cancel-outdoor','incident']),activity:z.enum(['fishing','jogging','basketball','hiking','hunting','rest']).optional(),target:z.string().max(100).optional(),item:z.string().max(40).optional(),text:z.string().max(1000).optional(),x:z.number().finite().optional(),y:z.number().finite().optional()}).parse(req.body);
    return world.command(b.commandId,()=>{
      if(b.type==='end'){if(world.state.player.conversation)world.endConversation(world.state.player.conversation);return {ok:true};}
      world.requireRunning();
      if(b.type==='incident'){const event=triggerIncident(world,true);if(!event)throw new Error('暂时没有合适的事件：请让居民结束忙碌，或等待至少 6 游戏分钟后再试。');return {ok:true,event};}
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
}
const locationsForWork=[{id:'garden',item:'flowers'},{id:'riverside',item:'fish'},{id:'workshop',item:'wood'}];

// Same validated commands for browser workers and legacy Node tools; no HTTP server is required.
export function createWorldRequests(world:World) {
  const routes: {method:string;path:string;handler:Handler}[]=[];
  registerWorldRoutes(world, {get:(path,handler)=>routes.push({method:'GET',path,handler}),post:(path,handler)=>routes.push({method:'POST',path,handler})});
  return async (method:string, path:string, body?:unknown) => {
    const url=new URL('/api'+path,'http://worker.local');
    for(const route of routes) {
      if(route.method!==method)continue;
      const keys:string[]=[];
      const pattern=route.path.replace(/:([A-Za-z]+)/g,(_match,key)=>{keys.push(key);return '([^/]+)';});
      const match=url.pathname.match(new RegExp('^'+pattern+'$'));
      if(!match)continue;
      const params=Object.fromEntries(keys.map((key,i)=>[key,decodeURIComponent(match[i+1])]));
      return route.handler({body,params,query:Object.fromEntries(url.searchParams)});
    }
    throw new Error('未知的世界操作');
  };
}
