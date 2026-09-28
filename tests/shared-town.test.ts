import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {World} from '../server/world';
import {BrowserStore} from '../engine/browser-store';
import {publicTownSnapshot} from '../src/runtime/shared-view';
const admin='00000000-0000-4000-8000-000000000001',viewer='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
const session='00000000-0000-4000-8000-000000000011',session2='00000000-0000-4000-8000-000000000012';
test('public view excludes editable/private simulation data',()=>{
 const world=new World(new BrowserStore(),'demo');
 const view=publicTownSnapshot(world.snapshot(false));
 assert.equal(view.privateActors,undefined);assert.equal(view.actionTraces,undefined);assert.equal(view.observer,false);
 assert.deepEqual(view.conversations,[]);assert.deepEqual(view.usage.recent,[]);
 assert.ok(view.events.every(e=>e.audience.includes('public')));
 assert.equal(view.actors.length,24);assert.equal(JSON.stringify(view).includes(world.actor('gardener').secret.core),false);
});
test('shared town roles, exclusive hosting, checkpoint privacy and paid access are enforced in Postgres',async t=>{
 const db=new PGlite();const store=new BrowserStore(),world=new World(store,'demo');world.persist();
 const snapshot=publicTownSnapshot(world.snapshot(false));
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to authenticated,anon,service_role;
 insert into auth.users(id,email,email_confirmed_at) values('${admin}','owner@example.com',now()),('${viewer}','viewer@example.com',now()),('${other}','other@example.com',null);`);
 for(const file of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec(`insert into public.town_admin_emails values('owner@example.com'),('other@example.com');`);
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
  await assert.rejects(db.query('select public.publish_town($1,0,$2,$3)',[session,store.data,world.snapshot(true)]),/private_snapshot/);
  assert.equal((await db.query<{revision:number}>('select public.publish_town($1,0,$2,$3) as revision',[session,store.data,snapshot])).rows[0].revision,1);
  await assert.rejects(db.query('select public.publish_town($1,0,$2,$3)',[session,store.data,snapshot]),/save_conflict/);
  await db.exec('set role anon;');
  const watched=(await db.query<{view:any}>('select public.watch_town(0) as view')).rows[0].view;
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
