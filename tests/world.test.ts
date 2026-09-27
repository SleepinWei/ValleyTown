import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, BudgetError } from '../server/store';
import { World, allowedFragments } from '../server/world';
import { createApp } from '../server/app';
import { pathfind, locations, walkable, location, TOWN_OFFSET } from '../shared/map';

function fixture(limit=10){const dir=mkdtempSync(join(tmpdir(),'valleytown-test-'));const store=new Store(dir,{DeepSeek:limit,Jev:limit});const world=new World(store,'demo');world.state.incidents.nextAt=1e12;return {dir,store,world,close:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};}
test('all map locations have a legal path from the square',()=>{for(const l of locations){const path=pathfind({x:36+TOWN_OFFSET.x,y:36+TOWN_OFFSET.y},l.door);assert.ok(path.length>0,l.id);assert.ok(path.every(p=>walkable(p.x,p.y)));}});
test('atomic monetary reservations prevent concurrent overspending and settlement is idempotent',()=>{const f=fixture(1);try{const id=f.store.reserve('DeepSeek','test','deepseek-flash',300000,10000);assert.throws(()=>f.store.reserve('DeepSeek','test','deepseek-flash',200000),BudgetError);f.store.settle(id,100000,10000,10);f.store.settle(id,100000,10000,10);assert.equal(f.store.usage().pools.DeepSeek.spentCny,.28);assert.equal(f.store.usage().reserved,0);assert.ok(f.store.reserve('DeepSeek','test','deepseek-flash',300000));}finally{f.close();}});
test('crash recovery retains reservations as unknown; restoring world cannot reset ledger',()=>{const dir=mkdtempSync(join(tmpdir(),'valleytown-ledger-'));let store=new Store(dir);const world=new World(store,'demo');const save=store.archive(world.state,'before');store.reserve('Jev','test','jev',60);store.close();store=new Store(dir);assert.equal(store.usage().reserved,60);assert.equal(store.usage().unknown,1);store.restore(save);assert.equal(store.usage().reserved,60);store.close();rmSync(dir,{recursive:true,force:true});});
test('global pause freezes time, movement and new model requests',()=>{const f=fixture();try{f.world.state.player.path=[{x:36,y:37}];const clock=f.world.state.clock;f.world.tick(5);assert.equal(f.world.state.clock,clock);assert.equal(f.world.state.player.y,36+TOWN_OFFSET.y);assert.equal(f.world.active,0);assert.throws(()=>f.world.gift('gardener','flowers'),/暂停/);}finally{f.close();}});
test('responses arriving during pause persist without mutating plan until resume',async()=>{const f=fixture();try{const a=f.world.actor('gardener');f.world.state.mode='live';let finish!:(value:any)=>void;f.world.gateway.text=async()=>new Promise(resolve=>finish=resolve);f.world.resume();const before=a.plan;const task=f.world.plan(a);f.world.pause();finish({text:'新的合法计划',input:1,output:1,latency:1,model:'test'});await task;assert.equal(a.plan,before);assert.equal(f.world.state.pending.length,1);for(const actor of f.world.state.actors){actor.nextPlan=1e9;actor.nextDecision=1e9;}f.world.resume();f.world.tick(.1);assert.equal(a.plan,'新的合法计划');assert.equal(f.world.state.pending.length,0);}finally{f.close();}});
test('player snapshots exclude private secrets, private conversation content and decision inputs',()=>{const f=fixture();try{const a=f.world.actor('gardener');a.secret.core='PRIVATE_SECRET_CANARY';a.memories.push({id:'secret',text:'PRIVATE_MEMORY_CANARY',day:1,minute:1,source:'self',kind:'belief',important:true});f.world.event('dialogue','PRIVATE_DIALOGUE_CANARY',['gardener','baker'],['gardener','baker']);const publicData=JSON.stringify(f.world.snapshot(false));assert.ok(!publicData.includes('PRIVATE_'));assert.ok(!publicData.includes('privateActors'));assert.ok(JSON.stringify(f.world.snapshot(true)).includes('PRIVATE_SECRET_CANARY'));}finally{f.close();}});
test('secret disclosure needs trust plus independent experiences and respects resentment',()=>{const f=fixture();try{const a=f.world.actor('gardener');assert.deepEqual(allowedFragments(a,'player',480),[]);a.relations.player.trust=90;assert.deepEqual(allowedFragments(a,'player',480),[0,1]);a.trustedEvents.player=['event1','event2'];assert.deepEqual(allowedFragments(a,'player',480),[0,1,2]);a.relations.player.resentment=40;assert.deepEqual(allowedFragments(a,'player',480),[]);}finally{f.close();}});
test('editing private documents changes only owner, invalidates decisions, and detects conflicts',()=>{const f=fixture();try{const a=f.world.actor('gardener'),b=f.world.actor('baker');const oldOther=b.persona;const doc=f.world.documents.list(a.id)[0],revision=a.revision;const text=doc.text.replace(a.persona,'开朗，有自己的生活边界。');const rows=f.world.documents.import(doc.id,text,doc.revision);assert.equal(a.persona,'开朗，有自己的生活边界。');assert.ok(a.revision>revision);assert.equal(b.persona,oldOther);assert.throws(()=>f.world.documents.import(doc.id,text,doc.revision),/版本冲突/);assert.equal(rows[0].revision,2);}finally{f.close();}});
test('external files are loaded after two stable scans; malformed headers remain errors',()=>{const f=fixture();try{const a=f.world.actor('gardener'),doc=f.world.documents.list(a.id)[0];writeFileSync(doc.file,doc.text.replace(a.persona,'来自外部编辑器的人设。'));f.world.documents.scan();assert.notEqual(a.persona,'来自外部编辑器的人设。');f.world.documents.scan();assert.equal(a.persona,'来自外部编辑器的人设。');writeFileSync(doc.file,'broken header');f.world.documents.scan(true);assert.ok(f.world.documents.errors().length>0);assert.equal(a.persona,'来自外部编辑器的人设。');}finally{f.close();}});
test('duplicate player command transfers a gift exactly once',()=>{const f=fixture();try{f.world.resume();const a=f.world.actor('gardener');f.world.state.player.x=a.x;f.world.state.player.y=a.y;const count=f.world.state.player.inventory.flowers;for(let i=0;i<2;i++)f.world.command('same-id',()=>{f.world.gift(a.id,'flowers');return {ok:true};});assert.equal(f.world.state.player.inventory.flowers,count-1);}finally{f.close();}});
test('API rejects unauthenticated and cross-origin mutations and exposes only selected view',async()=>{const f=fixture();const app=await createApp(f.world);try{const r=await app.inject({method:'POST',url:'/api/control',payload:{action:'resume'}});assert.equal(r.statusCode,401);const bootstrap=await app.inject('/api/bootstrap');const cookie=String(bootstrap.headers['set-cookie']).split(';')[0];const bad=await app.inject({method:'POST',url:'/api/control',headers:{cookie,origin:'https://evil.example'},payload:{action:'resume'}});assert.equal(bad.statusCode,403);const res=await app.inject({url:'/api/world',headers:{cookie}});assert.equal(res.statusCode,200);assert.equal(res.json().privateActors,undefined);const admin=await app.inject({url:'/api/world?view=observer',headers:{cookie}});assert.equal(admin.json().privateActors.length,24);}finally{await app.close();f.close();}});
for(const status of ['running_live','paused_manual','paused_budget_limit'] as const){
 test(`restart preserves ${status} and ignores elapsed wall time`,()=>{
  const f=fixture();try{
   f.world.state.status=status;f.world.state.dayMinutes=5;
   f.world.state.checkpointAt=Date.now()-30*24*3600000;
   for(const a of f.world.state.actors){a.nextDecision=1e9;a.nextPlan=1e9;}
   const clock=f.world.state.clock;f.store.save(f.world.state);
   const restarted=new World(f.store,'demo');
   assert.equal(restarted.state.status,status);assert.equal(restarted.state.clock,clock);
   assert.equal('catchupTarget' in restarted.state,false);assert.equal('offlineDays' in restarted.snapshot(),false);
   restarted.tick(.25);
   assert.equal(restarted.state.clock,clock+(status==='running_live'?1.2:0));
   assert.equal(f.store.usage().calls,0);
  }finally{f.close();}
 });
}
for(const status of ['running_catchup','paused_manual','paused_budget_limit'] as const){
 test(`legacy ${status} save drops offline debt without losing completed progress`,()=>{
  const f=fixture();try{
   const clock=f.world.state.clock,events=structuredClone(f.world.state.events);
   const id=f.store.reserve('Jev','test','jev',80);f.store.settle(id,30,10,1);
   const pending={kind:'plan',actorId:'gardener',revision:f.world.actor('gardener').revision,data:{text:'待应用的计划'}};
   Object.assign(f.world.state,{status,catchupTarget:clock+12*1440,offlineDays:12,checkpointAt:Date.now()-3600000,pending:[pending]});
   f.store.save(f.world.state);
   const restarted=new World(f.store,'demo');
   assert.equal(restarted.state.clock,clock);
   assert.equal(restarted.state.status,status==='running_catchup'?'running_live':status);
   assert.equal('catchupTarget' in restarted.state,false);assert.equal('offlineDays' in restarted.state,false);
   assert.deepEqual(restarted.state.events,events);assert.deepEqual(restarted.state.pending,[pending]);
   assert.equal(f.store.usage().used,40);
   assert.equal('catchupTarget' in f.store.load()!,false);
   if(status!=='running_catchup'){restarted.resume();assert.equal(restarted.state.status,'running_live');assert.equal(restarted.state.clock,clock);}
  }finally{f.close();}
 });
}
test('restoring an archived catch-up save stays paused and resumes without offline debt',async()=>{
 const f=fixture();const clock=f.world.state.clock;
 const legacy=structuredClone(f.world.state);Object.assign(legacy,{status:'running_catchup',catchupTarget:clock+14400,offlineDays:10});
 const id=f.store.archive(legacy,'legacy catch-up');const app=await createApp(f.world);
 try{
  const bootstrap=await app.inject('/api/bootstrap');const headers={cookie:String(bootstrap.headers['set-cookie']).split(';')[0]};
  const restored=await app.inject({method:'POST',url:`/api/saves/${id}/restore`,headers,payload:{}});
  assert.equal(restored.statusCode,200);assert.equal(f.world.state.status,'paused_manual');assert.equal(f.world.state.clock,clock);
  assert.equal('catchupTarget' in f.world.state,false);assert.equal('offlineDays' in f.world.state,false);
  const resumed=await app.inject({method:'POST',url:'/api/control',headers,payload:{action:'resume'}});
  assert.equal(resumed.statusCode,200);assert.equal(f.world.state.status,'running_live');assert.equal(f.world.state.clock,clock);
  const command=await app.inject({method:'POST',url:'/api/commands',headers,payload:{commandId:'after-legacy-restore',type:'move',target:'square'}});
  assert.equal(command.statusCode,200);
  f.world.pause();
 }finally{await app.close();f.close();}
});
test('money threshold pauses all live simulation without time progress',()=>{const f=fixture(1);try{f.world.state.mode='live';f.world.resume();const id=f.store.reserve('DeepSeek','test','deepseek-flash',1000);f.store.settle(id,500000,2,1);const clock=f.world.state.clock;f.world.tick(1);assert.equal(f.world.state.status,'paused_budget_limit');assert.equal(f.world.state.clock,clock);f.store.setLimit('DeepSeek',10);f.world.resume();assert.equal(f.world.state.status,'running_live');assert.equal(f.store.usage().used,500002);}finally{f.close();}});
test('restored world republishes accepted documents with new revisions and preserves external edits',()=>{const f=fixture();try{const a=f.world.actor('gardener');const original=a.persona;const save=f.store.archive(f.world.state,'original');const d=f.world.documents.list(a.id)[0];f.world.documents.import(d.id,d.text.replace(original,'新的设定。'),d.revision);const current=f.world.documents.list(a.id)[0];writeFileSync(current.file,current.text+'\n外部尚未导入的修改');f.world.state=f.store.restore(save);f.world.documents.restoreFromWorld();const restored=f.world.documents.list(a.id)[0];assert.ok(restored.text.includes(original));assert.equal(restored.revision,3);f.world.documents.scan(true);assert.equal(f.world.actor(a.id).persona,original);}finally{f.close();}});
test('long-term notes remain in context and daily notes expire at the day boundary',()=>{const f=fixture();try{const a=f.world.actor('gardener');for(const kind of ['notes','today']){const d=f.world.documents.list(a.id).find(d=>d.id.endsWith(':'+kind))!;f.world.documents.import(d.id,d.text.replace(/---\n[^]*?---\n/,'').length?d.text+'\n'+kind:d.text,d.revision);}for(let i=0;i<40;i++)f.world.memory(a,'普通经历','test');assert.match(f.world.privateContext(a).longTermNotes,/notes/);assert.match(f.world.privateContext(a).dailyNotes,/today/);f.world.state.clock+=1440;assert.equal(f.world.privateContext(a).dailyNotes,'');assert.match(f.world.privateContext(a).longTermNotes,/notes/);}finally{f.close();}});
test('opt-in model reflections remain queued for retry on failure',async()=>{const f=fixture(),previous=process.env.DEEPSEEK_REFLECTION;try{process.env.DEEPSEEK_REFLECTION='true';const a=f.world.actor('gardener');f.world.state.mode='live';for(const actor of f.world.state.actors){actor.nextDecision=1e9;actor.nextPlan=1e9;}f.world.state.reflectionQueue=[{actorId:a.id,day:1}];let calls=0;f.world.gateway.text=async()=>{calls++;throw new Error('temporary');};f.world.resume();f.world.tick(.1);while(f.world.active)await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(f.world.state.reflectionQueue.length,1);f.world.pause();}finally{if(previous===undefined)delete process.env.DEEPSEEK_REFLECTION;else process.env.DEEPSEEK_REFLECTION=previous;f.close();}});

test('dating requires fifteen minutes of simultaneous presence',async()=>{const f=fixture();try{const a=f.world.actor('gardener'),b=f.world.actor('baker'),place=locations.find(l=>l.id==='riverside')!.door;for(const actor of f.world.state.actors){actor.nextDecision=1e9;actor.nextPlan=1e9;}Object.assign(a,place);Object.assign(b,place);f.world.state.appointments.push({id:'date',from:a.id,to:b.id,place:'riverside',at:f.world.state.clock,status:'accepted',type:'date',arrived:[]});f.world.resume();f.world.tick(.1);assert.equal(f.world.state.appointments[0].status,'accepted');f.world.state.clock+=16;f.world.tick(.1);assert.equal(f.world.state.appointments[0].status,'fulfilled');f.world.pause();while(f.world.active)await new Promise(r=>setImmediate(r));}finally{f.close();}});
test('autonomous gift conserves inventory and records only participants memories',async()=>{const f=fixture();try{const a=f.world.actor('gardener'),b=f.world.actor('baker');Object.assign(b,{x:a.x+1,y:a.y});a.relations[b.id].affection=50;const item=Object.keys(a.inventory).find(k=>a.inventory[k]>0)!;const total=(a.inventory[item]??0)+(b.inventory[item]??0);f.world.resume();const original=f.world.evaluate.bind(f.world);f.world.evaluate=async(actor,state,questions,purpose)=>original(actor,state,questions,purpose,'gift_baker');await f.world.chooseAction(a);assert.equal((a.inventory[item]??0)+(b.inventory[item]??0),total);assert.ok(b.memories.some(m=>m.text.includes('送给')));assert.ok(!f.world.actor('librarian').memories.some(m=>m.text.includes('送给')));f.world.pause();}finally{f.close();}});
