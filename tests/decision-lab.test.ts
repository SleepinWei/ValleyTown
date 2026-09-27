import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { Store } from '../server/store';
import { World } from '../server/world';
import { scenarioInputs, syntheticInputs } from '../server/decision-lab';
import { labStats } from '../shared/telemetry';
import { captureAttempts, modelAttempts } from '../server/telemetry';
import { ModelGateway, type Question, type JevResult } from '../server/models';
import { createApp } from '../server/app';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const result=(choice='rest',confidence=1):JevResult=>({answers:{action:{type:'choice',choice,confidence,probabilities:{[choice]:1}}},model:'test-jev',input:3,output:1,latency:5});
function setup(){const dir=mkdtempSync('/private/tmp/valley-lab-'),store=new Store(dir),w=new World(store,'live');for(const a of w.state.actors){a.nextPlan=1e9;a.nextDecision=1e9;}w.state.weather='晴朗';w.gateway.jev=async()=>result();return {w,store,close(){store.close();rmSync(dir,{recursive:true,force:true});}};}
function configureLab(w:World){Object.defineProperty(w.lab.gateway,'configured',{value:{jev:true,deepseek:true}});w.lab.gateway.jev=async()=>result();w.lab.gateway.chooseText=async()=>({choice:'rest',text:'{"choice":"rest"}',model:'test-ds',input:1,output:1,latency:1});}

test('action traces separate model choice, low confidence fallback and weather execution override',async()=>{
 const f=setup();try{const {w,store}=f,a=w.actor('baker');w.resume();w.gateway.jev=async()=>result('work',.1);await w.chooseAction(a,Date.now()-50);
 let t=store.traces()[0];assert.equal(t.selected,'work');assert.equal(t.effective,'wait');assert.equal(t.status,'overridden');assert.ok(t.queueMs>=50);assert.ok(t.totalMs!>=t.modelMs);assert.equal(a.activity,'看看周围');
 a.localTask=null;w.gateway.jev=async()=>{w.state.weather='雷雨';return result('riverside');};await w.chooseAction(a);t=store.traces()[0];assert.equal(t.selected,'riverside');assert.equal(t.effective,'shelter');assert.equal(t.status,'overridden');assert.match(t.reason!,/雷雨/);
 assert.equal(w.snapshot(false).actionTraces,undefined);assert.ok(w.snapshot(true).actionTraces!.length>=2);
 }finally{f.close();}
});
test('paused results remain deferred and revision changes reject instead of claiming execution',async()=>{
 const f=setup();try{const {w,store}=f,a=w.actor('baker');w.resume();w.gateway.jev=async()=>{w.pause();return result();};await w.chooseAction(a);assert.equal(store.traces()[0].status,'deferred');assert.equal(w.state.pending.length,1);const activity=a.activity;a.revision++;w.resume();w.tick(.1);assert.equal(store.traces()[0].status,'rejected');assert.equal(a.activity,activity);
 w.gateway.jev=async()=>{a.revision++;return result();};await w.chooseAction(a);assert.equal(store.traces()[0].status,'rejected');
 }finally{f.close();}
});
test('unavailable social target and model failures never claim successful execution',async()=>{
 const f=setup();try{const {w,store}=f,a=w.actor('baker'),b=w.actor('gardener');Object.assign(b,{x:a.x,y:a.y});w.resume();w.gateway.jev=async(_s,q)=>{assert.ok((q.action as any).criteria.talk_gardener);b.conversation='busy';return result('talk_gardener');};await w.chooseAction(a);assert.equal(store.traces()[0].status,'rejected');assert.equal(w.state.conversations.length,0);
 w.gateway.jev=async()=>{throw new Error('response invalid');};await assert.rejects(w.chooseAction(a),/invalid/);const t=store.traces()[0];assert.equal(t.status,'failed');assert.ok(t.totalMs!==undefined);assert.equal(t.selected,undefined);
 }finally{f.close();}
});
test('benchmark inputs are frozen paired counterfactuals and never mutate town memories or candidate sets',()=>{
 const f=setup();try{const before=JSON.stringify(f.w.state);for(const scenario of ['rain','tired','enemy','lover'] as const){const i=scenarioInputs(f.w,'baker',scenario);assert.deepEqual(i.before.candidates,i.after.candidates);assert.notEqual(i.before.hash,i.after.hash);assert.equal(i.before.instructions,i.after.instructions);assert.equal(Object.keys(i.before.candidates).length,7);assert.ok(!JSON.stringify(i).includes(f.w.actor('gardener').secret.core));}const same=scenarioInputs(f.w,'baker','baseline');assert.equal(same.before.hash,same.after.hash);assert.equal(JSON.stringify(f.w.state),before);}finally{f.close();}
});
test('benchmark runs equal provider lanes, records failures, freezes time, leaves town paused',async()=>{
 const f=setup();try{const {w,store}=f;configureLab(w);let jevActive=0,dsActive=0,maxJ=0,maxD=0;const calls:{provider:string;state:unknown;criteria:unknown}[]=[];
 w.lab.gateway.jev=async(state,q)=>{jevActive++;maxJ=Math.max(maxJ,jevActive);calls.push({provider:'Jev',state,criteria:(q.action as Extract<Question,{type:'choice'}>).criteria});await flush();jevActive--;return result();};
 let count=0;w.lab.gateway.chooseText=async(state,q)=>{dsActive++;maxD=Math.max(maxD,dsActive);calls.push({provider:'DeepSeek',state,criteria:q.criteria});await flush();dsActive--;if(count++===0)throw new Error('invalid JSON');return {choice:'rest',text:'',model:'test',input:1,output:1,latency:1};};
 const actors=JSON.stringify(w.state.actors),clock=w.state.clock;const run=w.lab.start('baker','rain',2,true);w.tick(2);assert.equal(w.state.clock,clock);assert.throws(()=>w.requireRunning(),/实验期间/);await w.lab.settled;
 assert.equal(run.status,'complete');assert.equal(run.samples.length,8);assert.equal(maxJ,1);assert.equal(maxD,1);assert.equal(run.samples.filter(s=>s.status==='failed').length,1);assert.equal(labStats(run,'DeepSeek').rate,.75);
 for(const variant of ['before','after'] as const){const samples=run.samples.filter(s=>s.variant===variant);assert.equal(new Set(samples.map(s=>s.inputHash)).size,1);}
 assert.deepEqual(calls.filter(c=>c.provider==='Jev').map(c=>c.state),calls.filter(c=>c.provider==='DeepSeek').map(c=>c.state));assert.equal(JSON.stringify(w.state.actors),actors);assert.equal(w.state.status,'paused_manual');assert.equal(w.state.clock,clock);assert.equal(store.labs()[0].id,run.id);
 }finally{f.close();}
});
test('global pause stops later benchmark requests and settles the in-flight calls',async()=>{
 const f=setup();try{const {w}=f;configureLab(w);const finishes:((r:any)=>void)[]=[];w.lab.gateway.jev=async()=>new Promise(r=>finishes.push(r));w.lab.gateway.chooseText=async()=>new Promise(r=>finishes.push(r));const run=w.lab.start('baker','rain',3,true);assert.equal(finishes.length,2);w.pause();assert.equal(w.lab.active,true);assert.equal(run.samples.filter(s=>s.status==='cancelled').length,10);assert.throws(()=>w.resume(),/结算/);finishes[0](result());finishes[1]({choice:'rest'});await w.lab.settled;assert.equal(run.status,'cancelled');assert.equal(w.lab.active,false);assert.equal(w.state.status,'paused_manual');assert.equal(run.samples.filter(s=>s.status==='complete').length,2);}finally{f.close();}
});
test('HTTP failures and valid HTTP with invalid model content both count toward logical failures and tokens',async()=>{
 const f=setup();const oldFetch=globalThis.fetch,oldTransport=process.env.MODEL_HTTP_TRANSPORT,oldKey=process.env.VALLEYTOWN_JEV_API_KEY;try{
 delete process.env.MODEL_HTTP_TRANSPORT;process.env.VALLEYTOWN_JEV_API_KEY='test-only';const {w,store}=f;w.gateway=new ModelGateway(store,()=>true);w.resume();globalThis.fetch=async()=>new Response('{}',{status:400});await assert.rejects(w.chooseAction(w.actor('baker')));let t=store.traces()[0];assert.equal(t.status,'failed');assert.equal(t.attempts.length,1);assert.equal(t.attempts[0].status,'failed');
 globalThis.fetch=async()=>new Response(JSON.stringify({model:'test',usage:{input_tokens:10,output_tokens:2},answers:{action:{type:'choice',choice:'illegal',confidence:1}}}),{status:200});
 // setup uses a stub; restore the actual gateway for both transport cases.
 w.gateway=new ModelGateway(store,()=>true);await assert.rejects(w.chooseAction(w.actor('baker')),/合法候选/);t=store.traces()[0];assert.equal(t.status,'failed');assert.equal(t.attempts[0].status,'complete');assert.equal(t.attempts[0].input,10);
 }finally{globalThis.fetch=oldFetch;if(oldTransport===undefined)delete process.env.MODEL_HTTP_TRANSPORT;else process.env.MODEL_HTTP_TRANSPORT=oldTransport;if(oldKey===undefined)delete process.env.VALLEYTOWN_JEV_API_KEY;else process.env.VALLEYTOWN_JEV_API_KEY=oldKey;f.close();}
});
test('async-local attempt attribution stays isolated across overlapping decisions',async()=>{
 const left:any[]=[],right:any[]=[];await Promise.all([captureAttempts(left,async()=>{await flush();modelAttempts.getStore()!.push({id:'left'} as any);}),captureAttempts(right,async()=>{modelAttempts.getStore()!.push({id:'right'} as any);await flush();})]);assert.deepEqual(left,[{id:'left'}]);assert.deepEqual(right,[{id:'right'}]);
});
test('lab API requires local session and validates bounded runs without starting requests',async()=>{
 const f=setup();const app=await createApp(f.w);try{const denied=await app.inject({method:'GET',url:'/api/decision-lab',headers:{host:'127.0.0.1'}});assert.equal(denied.statusCode,401);const boot=await app.inject({method:'GET',url:'/api/bootstrap',headers:{host:'127.0.0.1'}});const cookie=String(boot.headers['set-cookie']).split(';')[0];const invalid=await app.inject({method:'POST',url:'/api/decision-lab',headers:{host:'127.0.0.1',cookie},payload:{actorId:'baker',scenario:'rain',repeats:999,paired:true}});assert.equal(invalid.statusCode,400);assert.equal(f.w.lab.active,false);}finally{await app.close();f.close();}
});

test('synthetic benchmark context is independent of all resident data',()=>{
 const i=syntheticInputs('rain');assert.equal((i.before.state as any).identity.name,'合成测试居民');assert.deepEqual((i.before.state as any).importantMemories,[]);assert.deepEqual(i.before.candidates,i.after.candidates);assert.equal((i.after.state as any).environment.weather,'雷雨');
});
test('token exhaustion cancels pending experiments and leaves the global budget pause in force',async()=>{
 const f=setup();try{const {w}=f;configureLab(w);w.lab.gateway.jev=async()=>{w.pause('paused_budget_limit');throw new Error('budget exhausted');};const run=w.lab.start('baker','rain',3,true);await w.lab.settled;assert.equal(w.state.status,'paused_budget_limit');assert.equal(run.status,'cancelled');assert.equal(run.samples.filter(s=>s.status==='failed').length,1);assert.equal(run.samples.filter(s=>s.status==='cancelled').length,11);}finally{f.close();}
});
test('restart during laboratory work stays paused at the saved game time',()=>{
 const f=setup();try{const {w,store}=f;const clock=w.state.clock;w.state.status='running_live';w.state.laboratoryRun='crashed-lab';w.state.checkpointAt=Date.now()-3600000;store.save(w.state);const restarted=new World(store,'live');assert.equal(restarted.state.status,'paused_manual');assert.equal(restarted.state.clock,clock);assert.equal('catchupTarget' in restarted.state,false);assert.equal(restarted.state.laboratoryRun,undefined);}finally{f.close();}
});
