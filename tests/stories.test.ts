import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { Store } from '../server/store';
import { World } from '../server/world';
import { StoryService, buildStory, storyContext } from '../server/stories';
import { createApp } from '../server/app';
import type { StoryJob } from '../shared/story';
const setup=()=>{const dir=mkdtempSync('/tmp/valley-story-test-'),store=new Store(dir),world=new World(store,'demo');return {world,store,close(){store.close();rmSync(dir,{recursive:true,force:true});}};};
const complete=async(job:StoryJob)=>{for(let i=0;i<100&&job.status==='running';i++)await new Promise(resolve=>setTimeout(resolve,2));assert.notEqual(job.status,'running');};

test('story reads lifetime archives beyond the recent event window, including legacy memory references',()=>{
 const f=setup();try{const w=f.world,a=w.actor('gardener');
  const old=w.event('marriage','许棠与林穗结婚了。',[a.id,'baker']);w.memory(a,old.text,old.id,true);
  a.storyEventIds=[]; // A legacy save has memories but no explicit story index.
  for(let i=0;i<520;i++){w.state.clock++;w.event('work',`工作完成 ${i}`,[a.id]);}
  assert.equal(w.state.events.length,500);const story=buildStory(w,a.id,'observer');assert.equal(story.total,521);assert.ok(story.highlights.some(h=>h.id===old.id));
  w.persist();const restarted=new World(f.store);assert.equal(buildStory(restarted,a.id,'observer').total,521);
 }finally{f.close();}
});

test('player stories never expose private events, memories, editor backstory, or other residents secrets',()=>{
 const f=setup();try{const w=f.world,a=w.actor('gardener'),other=w.actor('baker');
  const pub=w.event('gift','你送给许棠一束花。',['player',a.id],['player',a.id]);w.memory(a,pub.text,pub.id);
  const hidden=w.event('dialogue','PRIVATE-CONVERSATION',[a.id,other.id],[a.id,other.id]);w.memory(a,hidden.text,hidden.id);
  w.memory(a,'PRIVATE-THOUGHT','unknown',false,'belief');w.memory(a,'EDITOR-NOT-FACT','editor',true,'editor');w.memory(other,'OTHER-PRIVATE-MEMORY','unknown');
  const player=JSON.stringify(buildStory(w,a.id,'player')),observer=buildStory(w,a.id,'observer');
  for(const value of ['PRIVATE-CONVERSATION','PRIVATE-THOUGHT','EDITOR-NOT-FACT','OTHER-PRIVATE-MEMORY',a.secret.core,other.secret.core])assert.ok(!player.includes(value),value);
  assert.equal(observer.chapters.flatMap(c=>c.records).filter(r=>r.id===pub.id).length,1);
  assert.ok(observer.chapters.flatMap(c=>c.records).some(r=>r.text==='PRIVATE-THOUGHT'&&r.perspective==='belief'));
  assert.ok(!JSON.stringify(observer).includes('EDITOR-NOT-FACT'));assert.ok(!JSON.stringify(observer).includes('OTHER-PRIVATE-MEMORY'));
 }finally{f.close();}
});

test('restoring a save excludes abandoned future events even after time advances past them again',()=>{
 const f=setup();try{const w=f.world,a=w.actor('gardener');w.event('gift','保留的经历',[a.id]);const save=f.store.archive(w.state,'before');
  w.state.clock=1000;w.event('marriage','废弃时间线婚姻',[a.id,'baker']);w.persist();w.state=f.store.restore(save);w.state.clock=1200;
  const story=buildStory(w,a.id,'observer');assert.equal(story.total,1);assert.ok(!JSON.stringify(story).includes('废弃时间线'));
 }finally{f.close();}
});

test('long lifetime context covers earliest and latest days rather than truncating to recent events',()=>{
 const f=setup();try{const w=f.world,a=w.actor('gardener');for(let i=0;i<100;i++){w.state.clock=480+i*1440;w.event(i===0?'marriage':'work',`第 ${i+1} 天经历`,[a.id]);}
  const story=buildStory(w,a.id,'observer'),context=storyContext(story);assert.equal(story.days,100);assert.ok(context.periods.length<=24);assert.equal(context.periods[0].fromDay,1);assert.equal(context.periods.at(-1)!.toDay,100);assert.equal(context.periods.reduce((n,p)=>n+p.count,0),100);assert.ok(story.highlights.some(r=>r.text==='第 1 天经历'));
 }finally{f.close();}
});

test('AI narrative uses cited evidence, deduplicates in-flight requests, persists cache and does not mutate the world',async()=>{
 const f=setup();try{const w=f.world,a=w.actor('gardener');w.event('gift','许棠送出了一束花。',[a.id,'baker']);let calls=0;
  const service=new StoryService(w,async(_system,context:any)=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));const id=context.periods[0].evidence[0].id;return {text:JSON.stringify({title:'一束花的故事',paragraphs:[{text:'许棠送出了一束花。',ids:[id]}],highlights:[{id,reason:'一份赠礼，为普通的一天留下了记忆。'}]}),model:'test',input:100,output:50,latency:1};});
  const before=JSON.stringify(w.state),job=service.start(a.id,'observer');assert.equal(service.start(a.id,'observer').id,job.id);await complete(job);assert.equal(job.status,'complete');assert.equal(JSON.stringify(w.state),before);assert.equal(calls,1);
  const cached=new StoryService(w).start(a.id,'observer');assert.equal(cached.status,'complete');assert.equal(cached.story.narrative!.title,'一束花的故事');assert.equal(buildStory(w,a.id,'player').narrative,null);
  assert.throws(()=>service.job(job.id,'player'),/不可见/);
 }finally{f.close();}
});

test('AI errors and invalid evidence fail visibly, and a restored timeline cannot retrieve old jobs',async()=>{
 const f=setup();try{const w=f.world,a=w.actor('gardener'),save=f.store.archive(w.state,'empty');w.event('gift','后来的一份礼物',[a.id]);
  const service=new StoryService(w,async()=>({text:JSON.stringify({title:'假引用',paragraphs:[{text:'不可验证',ids:['missing']}],highlights:[]}),model:'test',input:1,output:1,latency:1}));
  const job=service.start(a.id,'observer');await complete(job);assert.equal(job.status,'failed');assert.match(job.error!,/不存在/);assert.equal(buildStory(w,a.id,'observer').narrative,null);
  w.state=f.store.restore(save);assert.throws(()=>service.job(job.id,'observer'),/世界记录已改变/);
 }finally{f.close();}
});

test('story API authenticates requests, defaults to public visibility, and handles empty and missing actors',async()=>{
 const f=setup();const app=await createApp(f.world);try{
  assert.equal((await app.inject('/api/stories/gardener')).statusCode,401);
  const bootstrap=await app.inject('/api/bootstrap'),headers={cookie:String(bootstrap.headers['set-cookie']).split(';')[0]};
  f.world.memory(f.world.actor('gardener'),'PRIVATE-STORY','unknown',true);
  const publicStory=(await app.inject({url:'/api/stories/gardener',headers})).json();assert.equal(publicStory.total,0);assert.equal(publicStory.view,'player');
  assert.equal((await app.inject({url:'/api/stories/gardener?view=observer',headers})).json().total,1);
  assert.equal((await app.inject({url:'/api/stories/missing',headers})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/stories/gardener',headers})).statusCode,400);
  assert.equal(f.store.usage().calls,0);
 }finally{await app.close();f.close();}
});
