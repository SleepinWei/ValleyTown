import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { Store } from '../server/store';
import { World } from '../server/world';
import { planning, planIssue, reusablePlan, replanEligibility, completedAction, failedAction } from '../server/planning';
import { buildActions } from '../server/actions';
import { location } from '../shared/map';
import type { Question } from '../server/models';

const flush=()=>new Promise<void>(r=>setImmediate(r));
function setup(){
 const dir=mkdtempSync('/private/tmp/valley-ds-efficient-'),store=new Store(dir),w=new World(store,'live');
 w.state.incidents.nextAt=1e12;for(const a of w.state.actors){a.nextPlan=1e9;a.nextDecision=1e9;}
 const calls:string[]=[];
 w.gateway.text=async(_s,_c,purpose)=>{calls.push(purpose);return {text:'优先本职活动，再休息；恶劣天气留在屋檐附近。',model:'test-ds',input:1,output:1,latency:1};};
 w.gateway.jev=async(_s,q:Record<string,Question>)=>({answers:Object.fromEntries(Object.entries(q).map(([key,spec])=>[key,spec.type==='choice'?{type:'choice',choice:key==='intent'?'respond':'wait',confidence:1}:spec.type==='score'?{type:'score',score:1}:{type:'noul',noul:1}])),model:'test-jev',input:1,output:1,latency:1});
 w.resume();return {w,store,calls,close(){w.pause();store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('three-day reusable goals issue one DS request, expire on day four and survive restart',async()=>{
 const f=setup();try{
  const {w,store,calls}=f,a=w.actor('baker');await w.plan(a);
  for(let day=1;day<=2;day++){w.state.clock=480+day*1440;await w.plan(a);}
  assert.deepEqual(calls,['daily-plan']);assert.equal(a.planning!.dailyIssuedDay,3);assert.equal(a.planning!.callsToday,0);
  w.persist();const restored=new World(store,'live');assert.equal(reusablePlan(restored.actor(a.id),restored.state.clock),true);
  w.state.clock=480+3*1440;await w.plan(a);assert.deepEqual(calls,['daily-plan','daily-plan']);
 }finally{f.close();}
});

test('routine progress/weather never offers DS; persistent failures and material changes do',async()=>{
 const f=setup();try{
  const {w}=f,a=w.actor('baker');await w.plan(a);const p=planning(a,w.state.clock);p.nextReplanAt=0;p.nextReplanWallAt=0;
  for(let i=0;i<12;i++)completedAction(a,w.state.clock);
  planIssue(a,w.state.clock,'weather','细雨');assert.equal(replanEligibility(a,w.state.clock).allowed,false);assert.equal(reusablePlan(a,w.state.clock),true);
  failedAction(a,w.state.clock,'位置改变');failedAction(a,w.state.clock,'位置改变');assert.equal(replanEligibility(a,w.state.clock).allowed,false);
  failedAction(a,w.state.clock,'位置改变');assert.equal(replanEligibility(a,w.state.clock).allowed,true);
  completedAction(a,w.state.clock);assert.equal(replanEligibility(a,w.state.clock).allowed,false);
  planIssue(a,w.state.clock,'major-event','家中新添孩子');w.state.clock+=1440;
  assert.equal(reusablePlan(a,w.state.clock),false);assert.ok(planning(a,w.state.clock).issues.some(i=>i.code==='major-event'));
  await w.plan(a);assert.equal(f.calls.length,2);
 }finally{f.close();}
});

test('a material event during DS generation invalidates the old plan',async()=>{
 const f=setup();try{
  const {w}=f,a=w.actor('baker'),old=a.plan;let finish!:(v:any)=>void;
  w.gateway.text=async()=>new Promise(r=>finish=r);const pending=w.plan(a);
  planIssue(a,w.state.clock,'major-event','家庭情况改变');finish({text:'过期结果',model:'test',input:1,output:1,latency:1});await pending;
  assert.equal(a.plan,old);assert.equal(a.planning!.request,null);assert.equal(reusablePlan(a,w.state.clock),false);
 }finally{f.close();}
});

test('obsolete queued replans are discarded before another DS call',async()=>{
 const f=setup();try{
  const {w,calls}=f,a=w.actor('baker');await w.plan(a);const p=planning(a,w.state.clock);
  p.replanCount=1;p.request={id:'legacy-progress',day:p.day,kind:'replan',reason:'已完成多项行动',attempts:0,retryAt:0,retryWallAt:0};
  planIssue(a,w.state.clock,'progress','已完成多项行动');await w.plan(a);
  assert.deepEqual(calls,['daily-plan']);assert.equal(p.request,null);assert.equal(p.replanCount,0);
 }finally{f.close();}
});

test('NPC conversation uses one DS expression across six Jev-selected turns',async()=>{
 const f=setup();try{
  const {w,calls}=f,a=w.actor('baker'),b=w.actor('gardener');Object.assign(b,{x:a.x,y:a.y});const c=w.startConversation(a.id,b.id);
  for(let turn=0;turn<6;turn++)await w.respond(c,turn%2?b:a);
  assert.equal(c.messages.length,6);assert.deepEqual(calls,['dialogue']);assert.equal(c.expressionCalls,1);
  assert.ok(c.messages.slice(1).every(m=>m.source==='Jev 意图 · 本地表达'));
 }finally{f.close();}
});

test('player open-ended replies retain DS; explicit ending needs no DS',async()=>{
 const f=setup();try{
  const {w,calls}=f,a=w.actor('baker');Object.assign(w.state.player,{x:a.x,y:a.y});const c=w.startConversation('player',a.id);
  w.sendMessage(c.id,'你最近如何？');await flush();w.sendMessage(c.id,'能继续说说吗？');await flush();assert.deepEqual(calls,['dialogue','dialogue']);
  const jev=w.gateway.jev;w.gateway.jev=async(s,q,p)=>{const r=await jev(s,q,p);if(r.answers.intent)r.answers.intent.choice='end';return r;};
  w.sendMessage(c.id,'再见');await flush();assert.equal(calls.length,2);assert.equal(c.status,'ended');
 }finally{f.close();}
});

test('failed NPC text generation still consumes its single expression slot',async()=>{
 const f=setup();try{
  const {w}=f,a=w.actor('baker'),b=w.actor('gardener');Object.assign(b,{x:a.x,y:a.y});const c=w.startConversation(a.id,b.id);let calls=0;
  w.gateway.text=async()=>{calls++;throw new Error('network failure');};await assert.rejects(w.respond(c,a));await w.respond(c,a);
  assert.equal(calls,1);assert.equal(c.messages.length,1);assert.match(c.messages[0].source,/本地表达/);
 }finally{f.close();}
});

test('approved travel resumes across restart and starts the approved work without another API',async()=>{
 const f=setup();try{
  const {w,store}=f,a=w.actor('baker');Object.assign(a,location('square').door);
  const [key,candidate]=Object.entries(buildActions(w,a)).find(([,c])=>c.target===a.home&&c.kind==='visit')!;assert.equal(candidate.arrival?.kind,'work');
  w.gateway.jev=async()=>({answers:{action:{type:'choice',choice:key,confidence:1}},model:'test',input:1,output:1,latency:1});await w.chooseAction(a);
  assert.ok(a.travelIntent);w.persist();const restored=new World(store,'live'),b=restored.actor(a.id);restored.resume();
  Object.assign(b,location(b.home).door);b.path=[];let calls=0;restored.gateway.jev=async()=>{calls++;throw new Error('no new choice needed');};
  restored.tick(.1);assert.equal(calls,0);assert.equal(b.localTask?.candidate.kind,'work');assert.equal(b.travelIntent,null);
  const end=b.localTask!.endsAt;restored.tick(.1);assert.equal(b.localTask!.endsAt,end);restored.pause();
 }finally{f.close();}
});

for(const invalidation of ['closing','revision','supplies'] as const)test(`arrival rechecks ${invalidation} without executing stale activity`,async()=>{
 const f=setup();try{
  const {w}=f,a=w.actor('baker');Object.assign(a,location('square').door);
  if(invalidation==='closing'){w.state.clock=1199;w.state.weatherSlot=Math.floor(1199/240);}
  const destination=invalidation==='closing'?'library':invalidation==='supplies'?'riverside':a.home;
  const [key,candidate]=Object.entries(buildActions(w,a)).find(([,c])=>c.kind==='visit'&&c.target===destination)!;
  if(invalidation==='supplies')assert.equal(candidate.arrival?.kind,'outdoor');
  w.gateway.jev=async()=>({answers:{action:{type:'choice',choice:key,confidence:1}},model:'test',input:1,output:1,latency:1});await w.chooseAction(a);
  Object.assign(a,location(destination).door);a.path=[];
  if(invalidation==='closing'){w.state.clock=1210;w.state.weatherSlot=Math.floor(1210/240);}else if(invalidation==='revision')a.revision++;else a.inventory.bait=0;
  (w as any).fastReady.set(a.id,1e9);w.tick(.1);
  assert.equal(a.travelIntent,null);assert.equal(a.localTask,null);assert.equal(a.outdoor.task,null);assert.match(a.decisionReason!,/重新决定/);w.pause();await flush();
 }finally{f.close();}
});
