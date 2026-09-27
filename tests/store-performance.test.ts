import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Store, BudgetError } from '../server/store';
import { createWorld } from '../server/seed';

test('cached usage tracks money reservations, settlement, failures and external SQLite writes',()=>{
 const dir=mkdtempSync('/private/tmp/valley-cache-'),store=new Store(dir,{DeepSeek:1,Jev:1});
 const other=new DatabaseSync(join(dir,'valleytown.sqlite'));
 try{
  assert.equal(store.usage().used,0);
  const id=store.reserve('DeepSeek','test','deepseek-flash',350000);assert.equal(store.usage().pools.DeepSeek.reservedCny,.7);
  assert.throws(()=>store.reserve('DeepSeek','test','deepseek-flash',200000),BudgetError);
  store.settle(id,100000,10000,3);assert.equal(store.usage().pools.DeepSeek.spentCny,.28);assert.equal(store.usage().reserved,0);
  const failed=store.reserve('DeepSeek','test','deepseek-flash',100000);store.usage();store.fail(failed,'failed',true);
  assert.equal(store.usage().pools.DeepSeek.reservedCny,0);
  const unknown=store.reserve('DeepSeek','test','deepseek-flash',100000);store.usage();store.fail(unknown,'unknown',false);
  assert.equal(store.usage().pools.DeepSeek.reservedCny,.2);assert.equal(store.usage().unknown,1);
  other.prepare('UPDATE calls SET cost_nano=500000000 WHERE id=?').run(id);
  assert.equal(store.usage().pools.DeepSeek.spentCny,.5);
  other.exec("UPDATE settings SET value='750000000' WHERE key='budget_cny_DeepSeek'");
  assert.equal(store.usage().pools.DeepSeek.limitCny,.75);assert.throws(()=>store.reserve('DeepSeek','test','deepseek-flash',30000),BudgetError);
  store.setLimit('DeepSeek',2);assert.equal(store.usage().pools.DeepSeek.limitCny,2);
 }finally{other.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('incremental event persistence preserves archived events after the world window drops them',()=>{
 const dir=mkdtempSync('/private/tmp/valley-events-'),store=new Store(dir);
 try{
  const world=createWorld('demo');
  const event={id:'persisted-event',at:world.clock,kind:'test',text:'An immutable event',actorIds:[],audience:['public'],mode:'live' as const};
  world.events.push(event);store.save(world);store.save(world);
  world.events=[];store.save(world);store.recordEvent(event);
  assert.deepEqual(store.eventsByIds([event.id]),[event]);
  assert.deepEqual(store.load()!.events,[]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
