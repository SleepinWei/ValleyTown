import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {World} from '../server/world';
import {BrowserStore} from '../engine/browser-store';
import {publicTownSnapshot,readSharedView,playerPresentation} from '../src/runtime/shared-view';
import {publishedTownView} from '../engine/published-view';
const admin='00000000-0000-4000-8000-000000000001',viewer='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
const session='00000000-0000-4000-8000-000000000011',session2='00000000-0000-4000-8000-000000000012';
test('shared presentation retains full gameplay but strips credentials and internal state',async()=>{
 const world=new World(new BrowserStore(),'demo');
 const view=await publishedTownView(world);
 assert.equal(view.observer,true);assert.equal(view.displayVersion,2);
 assert.deepEqual(view.privateActors,world.snapshot(true).privateActors);
 assert.deepEqual(view.decisions,world.snapshot(true).decisions);
 assert.deepEqual(view.actionTraces,world.snapshot(true).actionTraces);
 assert.equal(view.actors.length,24);
 assert.ok(JSON.stringify(view).includes(world.actor('gardener').secret.core));
 assert.deepEqual(playerPresentation(view).events,world.snapshot(false).events);
 assert.equal(playerPresentation(view).privateActors,undefined);
 for(const a of view.actors){
  assert.equal((readSharedView(view,'GET',`/documents/${a.id}`) as any[]).length,4);
  assert.equal((readSharedView(view,'GET',`/stories/${a.id}?view=observer`) as any).actorId,a.id);
  assert.ok(readSharedView(view,'GET',`/action-policy/${a.id}`));
 }
 const dirty:any={...view,config:{deepseekKey:'provider-credential'},payload:{raw:'checkpoint'},auth:{email:'owner@example.com'},readViews:{...view.readViews,'/test':{api_key:'credential-a',access_token:'credential-b',service_role:'credential-c',secret_key:'credential-d',secret:{core:'fictional secret'},error:'raw provider response',text:'sk-fakecredentials123456 Bearer hiddenvalue123 eyJfake.payload.signature'}}};
 const sanitized=publicTownSnapshot(dirty),encoded=JSON.stringify(sanitized);
 for(const value of ['credential-a','credential-b','credential-c','credential-d','raw provider response','sk-fakecredentials123456','hiddenvalue123','eyJfake.payload.signature','checkpoint','owner@example.com'])assert.ok(!encoded.includes(value),value);
 assert.ok(encoded.includes('fictional secret'));
 assert.equal((sanitized as any).config,undefined);assert.equal((sanitized as any).payload,undefined);
});
test('viewer reads use isolated cached records and reject every mutation or non-view route',async()=>{
 const view=await publishedTownView(new World(new BrowserStore(),'demo'));
 const docs=readSharedView(view,'GET','/documents/gardener') as any[];docs[0].text='changed locally';
 assert.notEqual((readSharedView(view,'GET','/documents/gardener') as any[])[0].text,docs[0].text);
 for(const method of ['POST','PUT','PATCH','DELETE'])for(const path of ['/control','/commands','/documents','/stories/gardener?view=observer','/decision-lab','/decision-lab/stop','/saves','/saves/id/restore'])assert.throws(()=>readSharedView(view,method,path),/只读观看/);
 for(const path of ['/model-proxy','/control','/documents/reload?x=1','/story-jobs/id','/stories/gardener?view=observer&generate=true'])assert.throws(()=>readSharedView(view,'GET',path),/只读观看/);
});
test('shared town roles, exclusive hosting, checkpoint privacy and paid access are enforced in Postgres',async t=>{
 const db=new PGlite();const store=new BrowserStore(),world=new World(store,'demo');world.persist();
 const snapshot=await publishedTownView(world);
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to authenticated,anon,service_role;
 insert into auth.users(id,email,email_confirmed_at) values('${admin}','owner@example.com',now()),('${viewer}','viewer@example.com',now()),('${other}','other@example.com',null);`);
 for(const file of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec(`insert into public.town_admin_emails values('owner@example.com'),('other@example.com');`);
 await t.test('fast presentation scan matches recursive filtering for adversarial nested values',async()=>{
  const cases=[
   {rows:[{a_p_i_k_e_y:'hidden',ACCESS_TOKEN:'hidden',secret:{core:'game secret'}}]},
   {rows:[{text:'line\nBearer private-token',error:'raw response'}]},
   {rows:[{text:'line\nsk-fakecredentials123456 and sb_secret_private123456'}]},
   {rows:[{text:'eyJfake.payload.signature',service_role:'hidden'}]},
   {rows:[{text:'ordinary text',error:null},{error:'请求失败，诊断详情仅管理员可见'}]},
   {rows:[{error:{raw:'sensitive nested error'}},{error:['raw error']},{error:false}]},
   {rows:[{path:'"api_key": in harmless text',headers:{Authorization:'hidden'}}]},
  ];
  for(const candidate of cases){
   const fast={displayVersion:2,...candidate};
   const actual=(await db.query<{v:any}>('select public.redact_town_presentation($1) as v',[fast])).rows[0].v;
   delete actual.displayVersion;
   const expected=(await db.query<{v:any}>('select public.redact_town_presentation($1) as v',[candidate])).rows[0].v;
   assert.deepEqual(actual,expected);
  }
 });
 await t.test('guests can watch but cannot read checkpoints or mutate roles',async()=>{
  await db.exec('set role anon;');assert.equal((await db.query<{admin:boolean}>('select public.is_town_admin() as admin')).rows[0].admin,false);
  assert.equal((await db.query('select public.watch_town() as view')).rows.length,1);
  await assert.rejects(db.query('select payload from public.shared_town'),/permission denied/);
  await assert.rejects(db.query(`select public.claim_town_host('${session}')`),/permission denied/);
 });
 await t.test('ordinary and unverified accounts cannot promote themselves or publish',async()=>{
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${viewer}';`);
  await assert.rejects(db.query("insert into public.town_admin_emails values('viewer@example.com')"),/permission denied/);
  assert.equal((await db.query('select * from public.shared_town')).rows.length,0);
  await assert.rejects(db.query(`select public.claim_town_host('${session}')`),/admin_required/);
  await assert.rejects(db.query('select public.publish_town($1,0,$2,$3)',[session,store.data,snapshot]),/admin_required/);
  await assert.rejects(db.query('update public.shared_town_view set revision=999'),/permission denied/);
  await assert.rejects(db.query('select public.save_town($1,0)',[store.data]),/permission denied/);
  await db.exec(`set request.jwt.claim.sub='${other}';`);
  assert.equal((await db.query<{admin:boolean}>('select public.is_town_admin() as admin')).rows[0].admin,false);
 });
 await t.test('only one admin page may host, and public reads match the authoritative checkpoint',async()=>{
  await db.exec(`set request.jwt.claim.sub='${admin}';`);
  assert.equal((await db.query<{admin:boolean}>('select public.is_town_admin() as admin')).rows[0].admin,true);
  const results=await Promise.allSettled([session,session2].map(s=>db.query('select public.claim_town_host($1)',[s])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const current=(await db.query<{host_session:string}>('select host_session from public.shared_town')).rows[0].host_session;
  assert.equal(current,session);
  const ttl=(await db.query<{ttl:number}>('select extract(epoch from lease_until-now()) as ttl from public.shared_town')).rows[0].ttl;
  assert.ok(Number(ttl)>90,'Host lease must tolerate background timer throttling');
  await assert.rejects(db.query('select public.publish_town($1,0,$2,$3)',[session2,store.data,snapshot]),/town_host_lost/);
  await assert.rejects(db.query('select public.publish_town($1,0,$2,$3)',[session,store.data,world.snapshot(true)]),/invalid_view_version/);
  const bypass:any=structuredClone(snapshot);
  bypass.config={apiKey:'root-credential'};bypass.payload={raw:'checkpoint'};
  bypass.readViews['/security-test']={api_key:'nested-credential',service_role:'server-role',secret:{core:'fictional game secret'},error:'raw upstream error',text:'sk-fakecredentials123456 Bearer hiddenvalue123 eyJfake.payload.signature'};
  assert.equal((await db.query<{revision:number}>('select public.publish_town($1,0,$2,$3) as revision',[session,store.data,bypass])).rows[0].revision,1);
  await assert.rejects(db.query('select public.publish_town($1,0,$2,$3)',[session,store.data,snapshot]),/save_conflict/);
  await db.exec('set role anon;');
  const watched=(await db.query<{view:any}>('select public.watch_town(0) as view')).rows[0].view;
  assert.equal(watched.snapshot.observer,true);assert.equal(watched.snapshot.privateActors.length,24);
  assert.equal(watched.snapshot.privateActors[0].secret.core,world.state.actors[0].secret.core);
  const encoded=JSON.stringify(watched.snapshot);
  for(const value of ['root-credential','nested-credential','server-role','checkpoint','raw upstream error','sk-fakecredentials123456','hiddenvalue123','eyJfake.payload.signature'])assert.ok(!encoded.includes(value),value);
  assert.ok(encoded.includes('fictional game secret'));
  await assert.rejects(db.query("select public.redact_town_presentation('{}')"),/permission denied/);
  assert.equal(watched.snapshot.id,world.state.id);assert.equal(watched.snapshot.clock,world.state.clock);assert.equal(watched.online,true);
  assert.equal((await db.query<{view:any}>('select public.watch_town(1) as view')).rows[0].view.snapshot,null);
 });
 await t.test('paid proxy denies viewer grants and expired/revoked admins',async()=>{
  await db.exec(`reset role;insert into public.model_access values('${viewer}',true,10000000000,10000000000);set role service_role;`);
  await assert.rejects(db.query('select public.reserve_model_request($1,$2,$3,100)',[viewer,crypto.randomUUID(),'DeepSeek']),/access_denied/);
  await db.query('select public.reserve_model_request($1,$2,$3,100)',[admin,crypto.randomUUID(),'DeepSeek']);
  await db.exec("reset role;update public.shared_town set lease_until=now()-interval '1 second';set role service_role;");
  await assert.rejects(db.query('select public.reserve_model_request($1,$2,$3,100)',[admin,crypto.randomUUID(),'DeepSeek']),/access_denied/);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  await assert.rejects(db.query('select public.publish_town($1,1,$2,$3)',[session,store.data,snapshot]),/town_host_lost/);
  await db.query('select public.claim_town_host($1)',[session2]);
  await assert.rejects(db.query('select public.publish_town($1,1,$2,$3)',[session,store.data,snapshot]),/town_host_lost/);
  await db.query('select public.release_town_host($1)',[session]);
  assert.equal((await db.query<{host_session:string}>('select host_session from public.shared_town')).rows[0].host_session,session2);
  await db.exec("reset role;delete from public.town_admin_emails where email='owner@example.com';set role authenticated;");
  await assert.rejects(db.query('select public.publish_town($1,1,$2,$3)',[session2,store.data,snapshot]),/admin_required/);
 });
 }finally{await db.close();}
});
