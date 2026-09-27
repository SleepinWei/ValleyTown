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
  w.gateway.text=async()=>({text:'测试计划',model:'stub',input:0,output:0,latency:1});
  w.resume();return {w,store,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

for(const lane of ['action','dialogue','background'] as const){
 test(`${lane} API allows known walking and unrelated activities to continue`,async()=>{
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
   (w as any).fastReady.set(b.id,1e9);
   b.localTask={candidate:{kind:'rest',label:'休息'},startedAt:clock,endsAt:clock+.1};
   for(let i=0;i<20;i++)w.tick(.5);
   close(w.state.clock-clock,8);close(w.state.player.x-x,50);assert.ok(b.energy>energy);assert.equal(b.localTask,null);
   assert.equal(w.snapshot().timing.waitingForApi,false);close(w.snapshot().timing.actualMultiplier,1);
   assert.equal(w.lanes[lane],1); // no duplicate dispatch for the waiting actor
   finish(lane==='action'?{answers:{action:{type:'choice',choice:'wait',confidence:1}},model:'stub',input:0,output:0,latency:1}:{text:'可以一起休息一会儿。',model:'stub',input:0,output:0,latency:1});
   await flush();assert.equal(w.active,0);
   w.tick(.25);close(w.state.clock-clock,8.2);close(w.state.player.x-x,51.25);
   assert.equal(b.localTask,null);assert.ok(b.energy>energy);
   w.pause();await flush();
  }finally{f.close();}
 });
}

for(const boundary of ['weather','midnight','appointment','activity','outdoor','birth','investigation','release','conversation'] as const){
 test(`${boundary} boundary drains in-flight decisions, prevents new dispatch and resumes without catch-up`,async()=>{
  const f=setup();let finish!:()=>void;
  try{
   const {w}=f,a=w.actor('baker');
   // Isolate scheduling from provider output; normal lane ownership still applies.
   (w as any).job(a,()=>new Promise<void>(r=>finish=r),'background');
   const at=boundary==='weather'?720:boundary==='midnight'?1440:500;
   w.state.clock=at-.2;w.state.weatherSlot=Math.floor(w.state.clock/240);
   if(boundary==='appointment')w.state.appointments.push({id:'sync',from:a.id,to:'gardener',place:'riverside',at,status:'accepted',type:'date',arrived:[]});
   if(boundary==='activity')a.localTask={candidate:{kind:'rest',label:'休息'},startedAt:at-10,endsAt:at};
   if(boundary==='outdoor')a.outdoor.task={id:'sync',kind:'fishing',place:'riverside',phase:'active',startedAt:at-10,endsAt:at};
   if(boundary==='birth')w.state.society.births.push({id:'sync',parents:['baker','gardener'],dueAt:at});
   if(boundary==='investigation'||boundary==='release')w.state.society.cases.push({id:'sync',victim:'gardener',perpetrator:'baker',at:at-100,position:{x:0,y:0},status:boundary==='release'?'sentenced':'investigating',evidence:[],nextInvestigation:at,sentenceAt:null,releaseAt:at});
   if(boundary==='conversation')w.state.conversations.push({id:'sync',participants:['baker','gardener'],messages:[],status:'active',turn:0,pending:true,started:at-180,nextTurn:at+100,expires:at});
   const energy=a.energy;
   w.tick(.5);assert.ok(w.state.clock<at&&w.state.clock>at-.01);assert.equal(w.snapshot().timing.waitingForApi,true);
   const held=w.state.clock;w.actor('merchant').nextDecision=0;
   for(let i=0;i<20;i++)w.tick(.5);
   assert.equal(w.state.clock,held);assert.equal(w.lanes.action,0);assert.equal(w.lanes.background,1);
   close(w.snapshot().timing.actualMultiplier,0);
   if(boundary==='activity'){assert.ok(a.localTask);assert.equal(a.energy,energy);}
   finish();await flush();w.actor('merchant').nextDecision=1e9;
   w.tick(.25);close(w.state.clock-held,.2);assert.ok(w.state.clock>at);
   assert.equal(w.snapshot().timing.waitingForApi,false);
   if(boundary==='activity'){assert.equal(a.localTask,null);assert.ok(a.energy>energy);}
   w.pause();await flush();
  }finally{f.close();}
 });
}

test('failed decisions release a critical barrier; story generation does not block simulation',async()=>{
 const f=setup();let reject!:(e:Error)=>void;
 try{
  const {w}=f;w.state.clock=719.9;w.state.weatherSlot=2;
  (w as any).job(w.actor('baker'),()=>new Promise<void>((_,r)=>reject=r));
  w.tick(.5);assert.equal(w.snapshot().timing.waitingForApi,true);
  reject(new Error('API timeout'));await flush();w.tick(.5);assert.ok(w.state.clock>720);
  Object.defineProperty(w.stories,'active',{value:true});
  w.state.clock=959.9;w.state.weatherSlot=3;w.tick(.5);
  assert.ok(w.state.clock>960);assert.equal(w.snapshot().timing.waitingForApi,false);
  w.pause();await flush();
 }finally{f.close();}
});

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

test('failed API jobs release the clock barrier and retain retry backoff',async()=>{
 const f=setup();try{
  const {w}=f,a=w.actor('baker');a.nextDecision=0;
  w.gateway.jev=async()=>{throw new Error('temporary API failure');};
  w.tick(.1);await flush();assert.equal(w.active,0);
  const clock=w.state.clock;assert.ok(a.nextDecision>clock);
  w.tick(.5);close(w.state.clock-clock,.4);assert.equal(w.snapshot().timing.waitingForApi,false);
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
