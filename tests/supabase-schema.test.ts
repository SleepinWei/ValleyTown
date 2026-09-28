import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002';
test('Supabase migration enforces private saves, CAS writes and service-only quota accounting',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon,service_role;insert into auth.users values('${alice}'),('${bob}');`);
  for(const file of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  const payload={format:'valleytown-browser',version:1,world:{id:'town'}};
  await t.test('users see only their own row; stale revisions cannot overwrite',async()=>{
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${alice}';`);
    assert.equal((await db.query<{r:number}>('select public.save_town($1::jsonb,0) as r',[JSON.stringify(payload)])).rows[0].r,1);
    await assert.rejects(db.query('select public.save_town($1::jsonb,0)',[JSON.stringify(payload)]),/save_conflict/);
    await assert.rejects(db.query('update public.town_saves set revision=0'),/permission denied/);
    await db.exec(`set request.jwt.claim.sub='${bob}';`);assert.equal((await db.query('select * from public.town_saves')).rows.length,0);
    await db.exec('set role anon;');await assert.rejects(db.query('select * from public.town_saves'),/permission denied/);
  });
  await t.test('browser roles cannot grant access or forge provider usage',async()=>{
    await db.exec('set role authenticated;');
    await assert.rejects(db.query('update public.model_budgets set limit_nano=999999999999'),/permission denied/);
    await assert.rejects(db.query(`insert into public.model_access(user_id,enabled) values('${bob}',true)`),/permission denied/);
    await assert.rejects(db.query(`select public.reserve_model_request('${alice}','00000000-0000-4000-8000-000000000003','DeepSeek',1)`),/permission denied/);
    await assert.rejects(db.query(`select public.settle_model_request('00000000-0000-4000-8000-000000000003',0,0,0)`),/permission denied/);
  });
  await t.test('reservations are atomic and unknown requests remain charged',async()=>{
    await db.exec(`reset role;insert into public.model_access values('${alice}',true,100,100);set role service_role;`);
    const ids=['00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012'];
    const results=await Promise.allSettled(ids.map(id=>db.query('select public.reserve_model_request($1,$2,$3,$4)',[alice,id,'DeepSeek',60])));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
    const rows=await db.query<{id:string;reserved_nano:number}>('select id,reserved_nano from public.model_requests');const id=rows.rows[0].id;
    await db.query('select public.fail_model_request($1,false)',[id]);
    await assert.rejects(db.query('select public.reserve_model_request($1,$2,$3,$4)',[alice,'00000000-0000-4000-8000-000000000013','DeepSeek',60]),/budget_exhausted/);
    await db.query('select public.settle_model_request($1,25,10,2)',[id]);
    await db.query('select public.reserve_model_request($1,$2,$3,$4)',[alice,'00000000-0000-4000-8000-000000000014','DeepSeek',60]);
    await assert.rejects(db.query('select public.reserve_model_request($1,$2,$3,$4)',[bob,'00000000-0000-4000-8000-000000000015','DeepSeek',1]),/access_denied/);
  });
  await t.test('project cap is shared across accounts and duplicate settlement cannot refund twice',async()=>{
    await db.exec(`reset role;update public.model_budgets set limit_nano=100 where provider='Jev';
      update public.model_access set jev_limit_nano=1000;
      insert into public.model_access values('${bob}',true,1000,1000);set role service_role;`);
    const id='00000000-0000-4000-8000-000000000021', other='00000000-0000-4000-8000-000000000022';
    await db.query('select public.reserve_model_request($1,$2,$3,$4)',[alice,id,'Jev',60]);
    await assert.rejects(db.query('select public.reserve_model_request($1,$2,$3,$4)',[bob,other,'Jev',60]),/budget_exhausted/);
    await db.query('select public.fail_model_request($1,false)',[id]);
    await assert.rejects(db.query('select public.reserve_model_request($1,$2,$3,$4)',[bob,other,'Jev',60]),/budget_exhausted/);
    await db.query('select public.settle_model_request($1,25,10,0)',[id]);
    await db.query('select public.settle_model_request($1,0,0,0)',[id]);
    await db.query('select public.reserve_model_request($1,$2,$3,$4)',[bob,other,'Jev',60]);
    await db.query('select public.fail_model_request($1,true)',[other]);
    await db.query('select public.fail_model_request($1,true)',[other]);
    assert.equal(Number((await db.query<{used_nano:number}>("select used_nano from public.model_budgets where provider='Jev'")).rows[0].used_nano),25);
    await db.exec(`reset role;delete from auth.users where id='${bob}';set role service_role;`);
    assert.equal(Number((await db.query<{used_nano:number}>("select used_nano from public.model_budgets where provider='Jev'")).rows[0].used_nano),25);
  });
  await t.test('unexpected supplier usage disables further spending for that provider',async()=>{
    const id='00000000-0000-4000-8000-000000000031';
    await db.query('select public.reserve_model_request($1,$2,$3,$4)',[alice,id,'Jev',10]);
    await db.query('select public.settle_model_request($1,20,10,0)',[id]);
    await assert.rejects(db.query('select public.reserve_model_request($1,$2,$3,$4)',[alice,'00000000-0000-4000-8000-000000000032','Jev',1]),/budget_exhausted/);
    const row=(await db.query<{used_nano:number;enabled:boolean}>("select * from public.model_budgets where provider='Jev'")).rows[0];
    assert.equal(Number(row.used_nano),45);assert.equal(row.enabled,false);
  });
 }finally{await db.close();}
});
