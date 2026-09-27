import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { Store } from '../server/store';
import { World } from '../server/world';
import { actionLimit, buildActions, validateAction, advanceLocalActions, beginLocalAction } from '../server/actions';
import { planning, planIssue, requestPlan, replanEligibility, planningPolicy } from '../server/planning';
import { location } from '../shared/map';
import { dayOf } from '../shared/types';
const flush=()=>new Promise<void>(r=>setImmediate(r));
function setup(){const dir=mkdtempSync('/private/tmp/valley-policy-'),store=new Store(dir),w=new World(store,'live');for(const a of w.state.actors){a.nextPlan=1e9;a.nextDecision=1e9;}w.state.weather='晴朗';w.state.weatherSlot=Math.floor(w.state.clock/240);w.gateway.text=async()=>({text:'先完成工作，再照顾关系；恶劣天气留在屋檐附近。',input:1,output:1,latency:1,model:'test-ds'});w.gateway.jev=async()=>({answers:{action:{type:'choice',choice:'wait',confidence:1}},model:'test-jev',input:1,output:1,latency:1});w.resume();return {w,store,close(){store.close();rmSync(dir,{recursive:true,force:true});}};}
function enableReplan(w:World,id='baker'){const a=w.actor(id),p=planning(a,w.state.clock);p.dailyIssuedDay=dayOf(w.state.clock);p.plannedDay=p.day;p.nextReplanAt=0;p.nextReplanWallAt=0;planIssue(a,w.state.clock,'blocked','计划目标受阻');return a;}

test('registry separates local activities from travel and filters gear, weather, identity and opening hours',()=>{
 const f=setup();try{const {w}=f,a=w.actor('baker');let actions=buildActions(w,a);assert.ok(actions.work);assert.ok(!Object.values(actions).some(c=>c.kind==='outdoor'));assert.ok(Object.values(actions).some(c=>c.kind==='visit'));assert.ok(Object.keys(actions).length<=actionLimit);
 Object.assign(a,location('lakepier').door);actions=buildActions(w,a);assert.equal(actions.fishing_lakepier.category,'place');assert.ok(!actions.work);a.inventory.bait=0;assert.ok(!buildActions(w,a).fishing_lakepier);a.inventory.bait=1;w.state.weather='雷雨';assert.ok(!buildActions(w,a).fishing_lakepier);
 w.state.weather='晴朗';Object.assign(a,location('library').door);assert.ok(buildActions(w,a).read);w.state.clock=1350;assert.ok(!buildActions(w,a).read);
 Object.assign(a,location('clinic').door);assert.ok(!Object.values(buildActions(w,a)).some(c=>c.kind==='care'));
 const doctor=w.actor('doctor');w.state.clock=600;Object.assign(doctor,location('clinic').door);a.energy=20;assert.ok(buildActions(w,doctor).care_baker);
 }finally{f.close();}
});
test('candidate inspection is deterministic and does not roll crime probability or consume cooldowns',()=>{
 const f=setup();try{const {w}=f,a=w.actor('miner'),b=w.actor('broker');Object.assign(a,{x:b.x,y:b.y});const rng=w.state.rng,cooldowns=JSON.stringify(a.socialCooldown);assert.deepEqual(buildActions(w,a),buildActions(w,a));assert.equal(w.state.rng,rng);assert.equal(JSON.stringify(a.socialCooldown),cooldowns);}finally{f.close();}
});
test('arriving opens local candidates, and delayed outputs are revalidated before spending supplies',async()=>{
 const f=setup();try{const {w,store}=f,a=w.actor('baker');Object.assign(a,location('lakepier').door);const bait=a.inventory.bait;const candidate=buildActions(w,a).fishing_lakepier;assert.ok(candidate);
 w.gateway.jev=async()=>{a.inventory.bait=0;return {answers:{action:{type:'choice',choice:'fishing_lakepier',confidence:1}},model:'test',input:1,output:1,latency:1};};await w.chooseAction(a);assert.equal(store.traces()[0].status,'rejected');assert.equal(a.outdoor.task,null);assert.equal(a.inventory.bait,0);a.inventory.bait=bait;
 Object.assign(a,location('square').door);assert.ok(validateAction(w,a,candidate));assert.ok(!buildActions(w,a).fishing_lakepier);
 }finally{f.close();}
});
test('local work continues without model calls, completes once and persists across restart',async()=>{
 const f=setup();try{const {w,store}=f,a=w.actor('baker');Object.assign(a,location(a.home).door);const item=a.inventory.bread,coins=a.coins;const c=buildActions(w,a).work;beginLocalAction(w,a,c);let calls=0;w.gateway.jev=async()=>{calls++;throw new Error('should not be called');};for(let i=0;i<10;i++)w.tick(.1);assert.equal(calls,0);assert.equal(a.inventory.bread,item);w.pause();w.tick(10000);assert.ok(a.localTask);const restored=new World(store,'live');restored.resume();const b=restored.actor(a.id);restored.state.clock=b.localTask!.endsAt;advanceLocalActions(restored);advanceLocalActions(restored);assert.equal(b.inventory.bread,item+1);assert.equal(b.coins,coins+2);assert.equal(b.localTask,null);assert.equal(b.nextDecision,restored.state.clock);assert.ok(b.memories.some(m=>m.text.includes('烘焙面包')));restored.pause();}finally{f.close();}
});
test('daily plans run once per day and weather changes do not call DS',async()=>{
 const f=setup();try{const {w}=f,a=w.actor('baker'),purposes:string[]=[];w.gateway.text=async(_s,_c,purpose)=>{purposes.push(purpose);return {text:'优先完成工作，雷雨时休息。',input:1,output:1,latency:1,model:'test'};};a.nextPlan=0;w.tick(.1);await flush();assert.deepEqual(purposes,['daily-plan']);assert.equal(a.planning!.plannedDay,1);
 w.state.clock=1100;w.tick(.1);await flush();assert.deepEqual(purposes,['daily-plan']);
 w.state.clock=2160;w.updateWeather();assert.ok(a.planning!.issues.some(i=>i.code==='weather'));assert.deepEqual(purposes,['daily-plan']);w.tick(.1);await flush();assert.deepEqual(purposes,['daily-plan','daily-plan']);assert.equal(a.planning!.plannedDay,2);w.pause();
 }finally{f.close();}
});
test('Jev replan is an explicit action, bounded by cooldown and daily quota',async()=>{
 const f=setup();try{const {w}=f,a=enableReplan(w);assert.ok(buildActions(w,a).replan);const previousPlan=a.plan;
 w.gateway.jev=async()=>({answers:{action:{type:'choice',choice:'replan',confidence:1}},model:'test-jev',input:1,output:1,latency:1});await w.chooseAction(a);assert.equal(a.planning!.request!.kind,'replan');assert.equal(a.plan,previousPlan);assert.equal(a.planning!.replanCount,1);assert.ok(!buildActions(w,a).replan);
 let purpose='';w.gateway.text=async(_s,_c,p)=>{purpose=p;return {text:'更新的阶段目标',input:1,output:1,latency:1,model:'test'};};await w.plan(a);assert.equal(purpose,'replan');assert.equal(a.plan,'更新的阶段目标');assert.ok(!replanEligibility(a,w.state.clock).allowed);
 const p=a.planning!;p.nextReplanAt=0;p.nextReplanWallAt=0;planIssue(a,w.state.clock,'new','新的重要事件');requestPlan(a,w.state.clock,'replan','新的重要事件');await w.plan(a);p.nextReplanAt=0;p.nextReplanWallAt=0;planIssue(a,w.state.clock,'new2','另一个事件');assert.equal(p.replanCount,2);assert.ok(!replanEligibility(a,w.state.clock).allowed);
 }finally{f.close();}
});
test('slow DS planning allows Jev and local actions, and pause defers the plan until resume',async()=>{
 const f=setup();try{const {w}=f,a=w.actor('baker');let finish!:(r:any)=>void;w.gateway.text=async()=>new Promise(r=>finish=r);a.nextPlan=0;a.nextDecision=0;w.tick(.1);await flush();assert.equal(w.lanes.background,1);assert.equal(w.lanes.action,0);assert.ok(a.localTask);const old=a.plan;w.pause();finish({text:'待提交阶段目标',input:1,output:1,latency:1,model:'test'});await flush();assert.equal(a.plan,old);assert.equal(w.state.pending.filter(p=>p.kind==='plan').length,1);assert.ok(a.planning!.request);w.resume();w.tick(.1);await flush();assert.equal(a.plan,'待提交阶段目标');w.pause();}finally{f.close();}
});
test('stale plan after a day rollover cannot overwrite new goals; failed planning is retried only once',async()=>{
 const f=setup();try{const {w}=f,a=w.actor('baker');let finish!:(r:any)=>void;w.gateway.text=async()=>new Promise(r=>finish=r);const old=a.plan,job=w.plan(a);w.state.clock+=1440;finish({text:'昨日过时计划',input:1,output:1,latency:1,model:'test'});await job;assert.equal(a.plan,old);assert.equal(a.planning!.request,null);
 w.gateway.text=async()=>{throw new Error('temporary');};await assert.rejects(w.plan(a));let p=a.planning!;assert.equal(p.request!.attempts,1);assert.ok(p.request!.retryAt>w.state.clock);p.request!.retryAt=0;p.request!.retryWallAt=0;await assert.rejects(w.plan(a));assert.equal(p.request,null);assert.ok(p.issues.some(i=>i.code==='plan_failed'));assert.equal(p.callsToday,planningPolicy.maxAttempts);await assert.rejects(w.plan(a),/已经请求/);
 }finally{f.close();}
});
test('default daily memory consolidation copies real personal experiences without DS',async()=>{
 const f=setup();const old=process.env.DEEPSEEK_REFLECTION;try{delete process.env.DEEPSEEK_REFLECTION;const {w}=f,a=w.actor('baker');w.memory(a,'今天完成了一批面包。','test',true);w.state.reflectionQueue.push({actorId:a.id,day:1});w.gateway.text=async()=>{throw new Error('unexpected DS');};await w.reflect(a,1);assert.equal(w.state.reflectionQueue.length,0);const m=a.memories.at(-1)!;assert.equal(m.kind,'reflection');assert.match(m.text,/面包/);assert.match(m.source,/本地日终摘录/);assert.ok(!m.text.includes(w.actor('gardener').secret.core));}finally{if(old===undefined)delete process.env.DEEPSEEK_REFLECTION;else process.env.DEEPSEEK_REFLECTION=old;f.close();}
});
