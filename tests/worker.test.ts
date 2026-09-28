import { tmpdir } from 'node:os';
import { join as tempPath } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { SimulationWorker } from '../server/worker-client';
import { createApp } from '../server/app';
import { Store } from '../server/store';
test('real worker owns simulation; gateway preserves auth, privacy, pause, saves and money pools across restart',async()=>{
 const dir=mkdtempSync(tempPath(tmpdir(), 'valley-worker-test-'));let worker=new SimulationWorker({dir,mode:'demo',limits:{DeepSeek:20,Jev:10}});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await worker.ready;assert.ok(worker.snapshot().runtime!.threadId>0);assert.equal(worker.snapshot().actors.length,24);
  app=await createApp(worker);const denied=await app.inject({method:'POST',url:'/api/control',payload:{action:'resume'}});assert.equal(denied.statusCode,401);
  const bootstrap=await app.inject('/api/bootstrap'),cookie=String(bootstrap.headers['set-cookie']).split(';')[0],headers={cookie};
  const observer=await app.inject({url:'/api/world?view=observer',headers});assert.equal(observer.json().privateActors.length,24);
  assert.equal((await app.inject({url:'/api/world',headers})).json().privateActors,undefined);
  assert.equal((await app.inject({method:'POST',url:'/api/control',headers,payload:{action:'resume'}})).statusCode,200);
  await new Promise(resolve=>setTimeout(resolve,350));
  const paused=await app.inject({method:'POST',url:'/api/control',headers,payload:{action:'pause'}});assert.equal(paused.statusCode,200);
  const clock=worker.snapshot().clock;await new Promise(resolve=>setTimeout(resolve,200));assert.equal(worker.snapshot().clock,clock);
  const saved=await app.inject({method:'POST',url:'/api/saves',headers,payload:{label:'worker test'}});assert.equal(saved.statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/control',headers,payload:{action:'limit',provider:'DeepSeek',value:12.34}})).statusCode,200);
  const restored=await app.inject({method:'POST',url:`/api/saves/${saved.json().id}/restore`,headers,payload:{}});assert.equal(restored.statusCode,200);assert.equal(worker.snapshot().usage.pools.DeepSeek.limitCny,12.34);
  assert.equal(worker.snapshot().usage.pools.Jev.limitCny,10);
  const story=await app.inject({url:'/api/stories/doctor?view=observer',headers});assert.equal(story.statusCode,200);assert.equal(story.json().actorId,'doctor');assert.equal(story.json().view,'observer');
  const docs=await app.inject({url:'/api/documents/doctor',headers});assert.equal(docs.json().length,4);
  const bad=await app.inject({method:'POST',url:'/api/commands',headers,payload:{commandId:'bad',type:'murder'}});assert.equal(bad.statusCode,400);
  await app.close();app=undefined;
  worker=new SimulationWorker({dir,mode:'demo',limits:{DeepSeek:20,Jev:10}});await worker.ready;assert.equal(worker.snapshot().status,'paused_manual');assert.equal(worker.snapshot().clock,clock);assert.equal(worker.snapshot().usage.pools.DeepSeek.limitCny,12.34);
  await worker.request('POST','/api/control',{action:'resume'});await worker.close();
  const store=new Store(dir),savedState=store.load()!;const savedClock=savedState.clock;
  savedState.checkpointAt=Date.now()-3600000;store.save(savedState);store.close();
  worker=new SimulationWorker({dir,mode:'demo',limits:{DeepSeek:20,Jev:10}});await worker.ready;assert.equal(worker.snapshot().clock,savedClock);assert.equal(worker.snapshot().status,'running_live');assert.equal('catchupTarget' in worker.snapshot(),false);await worker.request('POST','/api/control',{action:'pause'});
 }finally{if(app)await app.close();else await worker.close();rmSync(dir,{recursive:true,force:true});}
});
