import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { Store } from '../server/store';
import { World } from '../server/world';
import { SimulationRate } from '../server/simulation-rate';
import { createApp } from '../server/app';
import type { Question } from '../server/models';

const flush=()=>new Promise<void>(r=>setImmediate(r));
function setup(){
  const dir=mkdtempSync('/private/tmp/valley-rate-'),store=new Store(dir),w=new World(store,'live');
  for(const a of w.state.actors){a.nextPlan=1e9;a.nextDecision=1e9;}
  w.gateway.jev=async(_state,q:Record<string,Question>)=>({answers:Object.fromEntries(Object.entries(q).map(([id,spec])=>[id,spec.type==='choice'?{type:'choice',choice:'wait' in spec.criteria?'wait':Object.keys(spec.criteria)[0],confidence:1}:spec.type==='score'?{type:'score',score:1}:{type:'noul',noul:1}])),model:'stub',input:0,output:0,latency:1});
  w.resume();return {w,store,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

for(const lane of ['action','dialogue','background'] as const){
 test(`${lane} API holds clock, walking and activity deadlines; completion never catches up`,async()=>{
  const f=setup();let finish!:(r:any)=>void;
  try{
   const {w}=f,a=w.actor('baker');
   if(lane==='action'){a.nextDecision=0;w.gateway.jev=async()=>new Promise(r=>finish=r);}
   else {
    w.gateway.text=async()=>new Promise(r=>finish=r);
    if(lane==='background')a.nextPlan=0;
    else {Object.assign(w.state.player,{x:a.x,y:a.y});const c=w.startConversation('player',a.id);w.sendMessage(c.id,'你好');}
   }
   w.tick(.1);await flush();assert.equal(w.lanes[lane],1);
   const clock=w.state.clock,x=w.state.player.x;
   w.state.player.path=[{x:x+100,y:w.state.player.y}];
   const b=w.actor('gardener'),energy=b.energy;
   b.localTask={candidate:{kind:'rest',label:'休息'},startedAt:clock,endsAt:clock+.1};
   for(let i=0;i<20;i++)w.tick(.5);
   assert.equal(w.state.clock,clock);assert.equal(w.state.player.x,x);assert.equal(b.energy,energy);assert.ok(b.localTask);
   assert.equal(w.snapshot().timing.waitingForApi,true);close(w.snapshot().timing.actualMultiplier,0);
   finish(lane==='action'?{answers:{action:{type:'choice',choice:'wait',confidence:1}},model:'stub',input:0,output:0,latency:1}:{text:'可以一起休息一会儿。',model:'stub',input:0,output:0,latency:1});
   await flush();assert.equal(w.active,0);
   w.tick(.25);close(w.state.clock-clock,.2);close(w.state.player.x-x,1.25);
   assert.equal(b.localTask,null);assert.ok(b.energy>energy);
   w.pause();await flush();
  }finally{f.close();}
 });
}

test('walking covers the same distance per game minute at every slider speed',()=>{
 for(const dayMinutes of [120,30,30/1.75,5]){
  const f=setup();try{
   const {w}=f;w.setDayMinutes(dayMinutes);const start=w.state.clock,x=w.state.player.x;
   w.state.player.path=[{x:x+100,y:w.state.player.y}];w.tick(.5);
   close(w.state.clock-start,.5*1440/(dayMinutes*60));
   close(w.state.player.x-x,(w.state.clock-start)*6.25);
   close(w.snapshot().timing.actualMultiplier,30/dayMinutes);
   w.pause();close(w.snapshot().timing.actualMultiplier,0);
  }finally{f.close();}
 }
});

test('measured rolling rate includes API wait and trims fractional samples accurately',()=>{
 const rate=new SimulationRate();rate.record(2,1.6);rate.record(3,0);
 close(rate.snapshot(30,true).actualMultiplier,.4);
 rate.record(1,0);close(rate.snapshot(30,true).actualMultiplier,.2);
 rate.record(4,0);close(rate.snapshot(30,true).actualMultiplier,0);
 rate.record(.5,.4);close(rate.snapshot(30,false).actualMultiplier,.1);
 rate.reset();close(rate.snapshot(30,false).actualMultiplier,0);
});

test('suspension gaps do not advance simulation or movement',()=>{
 const f=setup();try{
  const {w}=f,clock=w.state.clock,x=w.state.player.x;
  w.state.player.path=[{x:x+100,y:w.state.player.y}];w.tick(3600);
  assert.equal(w.state.clock,clock);assert.equal(w.state.player.x,x);close(w.snapshot().timing.actualMultiplier,0);
  w.tick(.1);close(w.state.clock-clock,.08);close(w.state.player.x-x,.5);
 }finally{f.close();}
});

test('speed API accepts slider values, persists them and rejects out-of-range values',async()=>{
 const f=setup();f.w.pause();const app=await createApp(f.w);
 try{
  const bootstrap=await app.inject('/api/bootstrap'),headers={cookie:String(bootstrap.headers['set-cookie']).split(';')[0]};
  for(const value of [120,30/1.75,5]){
   const r=await app.inject({method:'POST',url:'/api/control',headers,payload:{action:'speed',value}});
   assert.equal(r.statusCode,200);assert.equal(f.store.load()!.dayMinutes,value);
   const w=(await app.inject({url:'/api/world',headers})).json();close(w.timing.targetMultiplier,30/value);assert.equal(w.timing.actualMultiplier,0);
  }
  for(const value of [0,4.9,121,'fast',null])assert.equal((await app.inject({method:'POST',url:'/api/control',headers,payload:{action:'speed',value}})).statusCode,400);
 }finally{await app.close();f.close();}
});
