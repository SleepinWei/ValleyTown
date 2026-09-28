import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';

test('heartbeats during asynchronous storage startup do not abort the worker',async t=>{
  const messages:any[]=[];
  const worker={postMessage:(message:unknown)=>messages.push(message),onmessage:undefined as undefined|((event:{data:any})=>Promise<void>)};
  Object.assign(globalThis,{self:worker,indexedDB});
  // Exercise the real worker message handler without leaving periodic timers.
  t.mock.method(globalThis,'setInterval',()=>0 as any);
  await import('../src/runtime/worker');
  const send=(data:any)=>worker.onmessage!({data});
  const starting=send({type:'init',key:'startup-regression',shared:true,active:true,validForMs:90000});
  assert.equal(messages.some(m=>m.type==='ready'),false,'Storage startup should still be pending');
  await send({type:'heartbeat',active:true,validForMs:90000});
  assert.deepEqual(messages.filter(m=>m.type==='error'),[]);
  await starting;
  assert.equal(messages.filter(m=>m.type==='ready').length,1);
  await send({type:'heartbeat',active:true,validForMs:90000});
  await send({type:'request',id:1,method:'POST',path:'/control',body:{action:'resume'}});
  assert.equal(messages.find(m=>m.type==='reply'&&m.id===1)?.error,undefined);
  assert.equal(messages.filter(m=>m.type==='snapshot').at(-1)?.value.player.status,'running_live');
  await send({type:'suspend',id:2});
  assert.equal(messages.filter(m=>m.type==='snapshot').at(-1)?.value.player.status,'paused_manual');
  assert.deepEqual(messages.filter(m=>m.type==='error'),[]);
});
