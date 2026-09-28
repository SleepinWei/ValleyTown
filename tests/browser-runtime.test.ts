import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { BrowserStore, emptyTownData, validateTownData } from '../engine/browser-store';
import { World } from '../server/world';
import { PageLifecycle } from '../src/runtime/lifecycle';
import { createWorldRequests } from '../engine/requests';
import { openTownDatabase, readLocal, writeLocal } from '../src/runtime/database';

function fixture(){const store=new BrowserStore(),world=new World(store,'demo');return {world,store};}
test('browser world retains real gameplay, stories, privacy and independently versioned documents',async()=>{
  const {world,store}=fixture(),request=createWorldRequests(world);
  assert.equal(world.state.actors.length,24);assert.equal(world.state.status,'paused_manual');
  await request('POST','/control',{action:'resume'});world.tick(.1);world.pause();
  assert.equal(world.snapshot(false).privateActors,undefined);assert.equal(world.snapshot(true).privateActors?.length,24);
  const rows=world.documents.list('gardener'),row=rows[0],text=row.text.replace(/\n---\n[\s\S]+$/,'\n---\n喜欢花与清晨。');
  world.documents.import(row.id,text,row.revision);assert.equal(world.actor('gardener').persona,'喜欢花与清晨。');
  assert.throws(()=>world.documents.import(row.id,text,row.revision),/版本冲突/);
  const saved=await request('POST','/saves',{label:'browser checkpoint'}) as {id:string};
  const original=world.state.clock;world.state.clock+=45;await request('POST',`/saves/${saved.id}/restore`,{});assert.equal(world.state.clock,original);
  const story=await request('GET','/stories/gardener?view=observer') as any;assert.equal(story.name,'许棠');
  const reloaded=new World(new BrowserStore(validateTownData(store.data)),'demo');assert.equal(reloaded.actor('gardener').persona,'喜欢花与清晨。');
});
test('visible-page lifecycle pauses on hiding, lost heartbeat and return; no offline catch-up',()=>{
  const {world}=fixture();let now=100;const lifecycle=new PageLifecycle(world,()=>now);
  assert.throws(()=>lifecycle.requireVisible(),/可见/);
  lifecycle.heartbeat(true);world.resume();now+=100;lifecycle.step();now+=100;lifecycle.step();assert.ok(world.state.clock>480);
  lifecycle.heartbeat(false);const paused=world.state.clock;now+=60000;lifecycle.step();assert.equal(world.state.clock,paused);assert.equal(world.state.status,'paused_manual');
  lifecycle.heartbeat(true);now+=100;lifecycle.step();assert.equal(world.state.clock,paused);world.resume();now+=100;lifecycle.step();assert.ok(world.state.clock>paused);
  now+=5000;lifecycle.step();assert.equal(world.state.status,'paused_manual');
});
test('browser budgets retain unknown reservations on reload and costs across world restore',()=>{
  const {world,store}=fixture();store.setLimit('DeepSeek',1);const saved=store.archive(world.state,'before models');
  const id=store.reserve('DeepSeek','test','test',100000,100);const pending=store.usage().pools.DeepSeek.reservedCny;
  const other=new BrowserStore(structuredClone(store.data));assert.equal(other.call(id).status,'unknown');assert.equal(other.usage().pools.DeepSeek.reservedCny,pending);
  other.settle(id,100000,100,50);const spent=other.usage().pools.DeepSeek.spentCny;other.save(other.restore(saved));assert.equal(other.usage().pools.DeepSeek.spentCny,spent);assert.equal(other.usage().pools.DeepSeek.reservedCny,0);
  assert.throws(()=>other.reserve('DeepSeek','test','test',1000000,0),/额度不足/);
});
test('IndexedDB writes world and ledger atomically and isolates guest/account namespaces',async()=>{
  Object.assign(globalThis,{indexedDB});const db=await openTownDatabase();
  const {store}=fixture();await writeLocal(db,'guest',{data:store.data,revision:0,dirty:true,updated:1});
  assert.equal((await readLocal(db,'guest'))!.data.world!.actors.length,24);assert.equal(await readLocal(db,'user:other'),undefined);
  await writeLocal(db,'user:other',{data:emptyTownData(),revision:3,dirty:false,updated:2});assert.equal((await readLocal(db,'guest'))!.revision,0);db.close();
});
test('malformed imports are rejected before becoming a browser world',()=>{
  assert.throws(()=>validateTownData({format:'valleytown-browser',version:1}),/有效/);
  const {store}=fixture();const invalid=structuredClone(store.data);invalid.world!.clock=NaN;assert.throws(()=>validateTownData(invalid),/参数无效/);
  const id=store.reserve('DeepSeek','test','test',100,10);
  const ledger=structuredClone(store.data);ledger.calls[id].cost_nano=-1;assert.throws(()=>validateTownData(ledger),/费用记录无效/);
  const docs=structuredClone(store.data);docs.documents['gardener:persona'].revision=0;assert.throws(()=>validateTownData(docs),/文档记录无效/);
});
