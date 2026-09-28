import { registerWorldRoutes } from '../engine/requests';
import { setIncidentPace, triggerIncident } from './incidents';
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
  registerWorldRoutes(world,{get:(path,handler)=>app.get(path,req=>handler({body:req.body,query:req.query,params:req.params as Record<string,string>})),post:(path,handler)=>app.post(path,req=>handler({body:req.body,query:req.query,params:req.params as Record<string,string>}))});
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
