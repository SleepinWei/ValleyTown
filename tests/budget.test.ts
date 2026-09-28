import { tmpdir } from 'node:os';
import { join as tempPath } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, BudgetError } from '../server/store';
import { ModelGateway } from '../server/models';
import { World } from '../server/world';
import { createApp } from '../server/app';
const setup=()=>{const dir=mkdtempSync(tempPath(tmpdir(), 'valley-budget-'));const store=new Store(dir,{DeepSeek:1,Jev:1});store.setExchange(7);return {dir,store,close(){this.store.close();rmSync(dir,{recursive:true,force:true});}};};

test('provider pools are independent and Jev output never consumes money',()=>{
 const f=setup();try{
  const ds=f.store.reserve('DeepSeek','plan','deepseek-flash',500000);
  assert.throws(()=>f.store.reserve('DeepSeek','plan','deepseek-flash',1),BudgetError);
  const jev=f.store.reserve('Jev','decision','jev-1.13.0',1000000,1000000);
  f.store.settle(jev,1000000,2000000,1);
  assert.equal(f.store.usage().pools.Jev.spentCny,.294);
  assert.equal(f.store.usage().pools.DeepSeek.reservedCny,1);
  f.store.fail(ds,'not sent',true);assert.equal(f.store.usage().pools.DeepSeek.reservedCny,0);
 }finally{f.close();}
});
test('cached DeepSeek input is charged once and prices are fixed when dispatching',()=>{
 const f=setup();try{
  f.store.setLimit('DeepSeek',10);
  const id=f.store.reserve('DeepSeek','plan','deepseek-flash',1000000,100000);
  f.store.settle(id,1000000,100000,1,undefined,800000);
  assert.equal(f.store.usage().pools.DeepSeek.spentCny,1.232);
  const jev=f.store.reserve('Jev','decision','jev-1.13.0',1000000);
  f.store.setExchange(8);assert.equal(f.store.usage().pools.Jev.reservedCny,.294);
  f.store.settle(jev,1000000,50,1);assert.equal(f.store.usage().pools.Jev.spentCny,.294);
  const next=f.store.reserve('Jev','decision','jev-1.13.0',1000000);f.store.settle(next,1000000,0,1);
  assert.equal(f.store.usage().pools.Jev.spentCny,.63);
 }finally{f.close();}
});
test('unknown requests retain money and token reservations across restart and restore',()=>{
 const f=setup();try{
  const w=new World(f.store,'demo'),save=f.store.archive(w.state,'before');
  f.store.reserve('DeepSeek','plan','deepseek-flash',100000,10000);
  f.store.close();f.store=new Store(f.dir,{DeepSeek:50,Jev:50});
  assert.equal(f.store.usage().unknown,1);assert.equal(f.store.usage().pools.DeepSeek.reservedCny,.28);
  f.store.restore(save);assert.equal(f.store.usage().pools.DeepSeek.limitCny,1);assert.equal(f.store.usage().reserved,110000);
 }finally{f.close();}
});
test('old ledger migrates once without clearing completed usage or unknown reservations',()=>{
 const dir=mkdtempSync(tempPath(tmpdir(), 'valley-old-budget-')),db=new DatabaseSync(join(dir,'valleytown.sqlite'));
 db.exec(`CREATE TABLE calls(id TEXT PRIMARY KEY,provider TEXT NOT NULL,purpose TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,input INTEGER NOT NULL DEFAULT 0,output INTEGER NOT NULL DEFAULT 0,reserved INTEGER NOT NULL,latency INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,error TEXT);
 CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 INSERT INTO settings VALUES ('token_limit','5000000');
 INSERT INTO calls VALUES ('old-ds','DeepSeek','plan','deepseek-flash','complete',100000,10000,0,1,1,NULL);
 INSERT INTO calls VALUES ('old-pending','DeepSeek','plan','deepseek-flash','pending',0,0,100000,0,2,NULL);`);db.close();
 let store=new Store(dir);try{
  const before=store.usage();assert.equal(before.used,110000);assert.equal(before.pools.DeepSeek.spentCny,.28);assert.equal(before.pools.DeepSeek.reservedCny,.8);assert.equal(before.pools.DeepSeek.legacyCalls,2);assert.equal(before.unknown,1);
  store.setLimit('DeepSeek',20);store.close();store=new Store(dir);assert.equal(store.usage().pools.DeepSeek.spentCny,.28);assert.equal(store.usage().pools.DeepSeek.limitCny,20);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('invalid settings are rejected and closing one pool leaves demo mode usable',async()=>{
 const f=setup(),w=new World(f.store,'demo'),app=await createApp(w,{internal:true});
 w.state.incidents.nextAt=1e12;for(const a of w.state.actors){a.nextPlan=1e9;a.nextDecision=1e9;}
 try{
  for(const payload of [{action:'limit',value:10},{action:'limit',provider:'Other',value:10},{action:'limit',provider:'Jev',value:-1},{action:'limit',provider:'Jev',value:.001},{action:'exchange',value:0}])assert.equal((await app.inject({method:'POST',url:'/api/control',payload})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/control',payload:{action:'limit',provider:'Jev',value:0}})).statusCode,200);
  assert.equal(f.store.usage().pools.DeepSeek.limitCny,1);w.resume();assert.equal(w.state.status,'running_live');w.pause();w.state.mode='live';assert.throws(()=>w.resume(),BudgetError);
  f.store.setLimit('Jev',1);w.resume();await app.inject({method:'POST',url:'/api/control',payload:{action:'limit',provider:'DeepSeek',value:0}});assert.equal(w.state.status,'paused_budget_limit');
 }finally{await app.close();f.close();}
});
test('gateway settles cache usage and retains reservation if usage is malformed',async()=>{
 const f=setup(),oldFetch=globalThis.fetch,oldKey=process.env.DEEPSEEK_API_KEY,oldTransport=process.env.MODEL_HTTP_TRANSPORT;
 try{
  process.env.DEEPSEEK_API_KEY='test-only';delete process.env.MODEL_HTTP_TRANSPORT;
  const gateway=new ModelGateway(f.store);
  globalThis.fetch=async()=>new Response(JSON.stringify({model:'deepseek-flash',usage:{prompt_tokens:1000,completion_tokens:100,prompt_cache_hit_tokens:800},choices:[{message:{content:'ok'}}]}));
  await gateway.text('test',{},'test');assert.equal(f.store.usage().pools.DeepSeek.spentCny,.001232);
  globalThis.fetch=async()=>new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:200}}));
  await assert.rejects(gateway.text('test',{},'test'),/有效用量/);assert.equal(f.store.usage().unknown,1);assert.ok(f.store.usage().pools.DeepSeek.reservedCny>0);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;if(oldTransport===undefined)delete process.env.MODEL_HTTP_TRANSPORT;else process.env.MODEL_HTTP_TRANSPORT=oldTransport;f.close();}
});
test('legacy budget pause migrates without resuming the world',()=>{
 const f=setup();try{const w=new World(f.store,'demo');Object.assign(w.state,{status:'paused_token_limit'});f.store.save(w.state);const migrated=new World(f.store,'demo');assert.equal(migrated.state.status,'paused_budget_limit');}finally{f.close();}
});
