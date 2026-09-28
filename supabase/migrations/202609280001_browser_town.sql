-- One private town per authenticated account. No anonymous or cross-account reads.
create table public.town_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.town_saves enable row level security;
create policy "read own town" on public.town_saves for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.town_saves from anon, authenticated;
grant select on public.town_saves to authenticated;
grant all on public.town_saves to service_role;

create or replace function public.save_town(p_payload jsonb, p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); current_revision bigint; next_revision bigint;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_payload is null or p_payload->>'format' is distinct from 'valleytown-browser'
    or p_payload->>'version' is distinct from '1' or octet_length(p_payload::text)>10000000
    or jsonb_typeof(p_payload->'world') is distinct from 'object' then
    raise exception 'invalid_town_payload';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'invalid_revision'; end if;
  -- Serialize even the first insert; two new devices cannot both create revision 1.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select revision into current_revision from public.town_saves where user_id=uid for update;
  if coalesce(current_revision,0)<>p_expected_revision then raise exception 'save_conflict'; end if;
  next_revision:=coalesce(current_revision,0)+1;
  insert into public.town_saves(user_id,payload,revision) values(uid,p_payload,next_revision)
    on conflict(user_id) do update set payload=excluded.payload,revision=excluded.revision,updated_at=now();
  return next_revision;
end $$;
revoke all on function public.save_town(jsonb,bigint) from public,anon;
grant execute on function public.save_town(jsonb,bigint) to authenticated;

-- Only the project operator may grant model access or increase these hard spending limits.
-- There is intentionally no default free model quota for public signups.
create table public.model_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  deepseek_limit_nano bigint not null default 0 check(deepseek_limit_nano >= 0),
  jev_limit_nano bigint not null default 0 check(jev_limit_nano >= 0)
);
create table public.model_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check(provider in ('DeepSeek','Jev')),
  status text not null default 'pending' check(status in ('pending','complete','failed','unknown')),
  reserved_nano bigint not null check(reserved_nano >= 0),
  cost_nano bigint not null default 0 check(cost_nano >= 0),
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  created_at timestamptz not null default now()
);
create index model_requests_user_created on public.model_requests(user_id,created_at);
alter table public.model_access enable row level security;
alter table public.model_requests enable row level security;
create policy "read own model access" on public.model_access for select to authenticated using ((select auth.uid())=user_id);
create policy "read own model usage" on public.model_requests for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.model_access, public.model_requests from anon,authenticated;
grant select on public.model_access, public.model_requests to authenticated;
grant all on public.model_access, public.model_requests to service_role;

create or replace function public.reserve_model_request(p_user uuid,p_id uuid,p_provider text,p_amount bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare access public.model_access%rowtype; spent bigint; cap bigint; active_count bigint; minute_count bigint;
begin
  if p_provider not in ('DeepSeek','Jev') or p_amount is null or p_amount<0 then raise exception 'invalid_reservation'; end if;
  select * into access from public.model_access where user_id=p_user for update;
  if not found or not access.enabled then raise exception 'model_access_denied'; end if;
  -- Unfinished requests retain their reservations after tab closure or an Edge Function crash.
  update public.model_requests set status='unknown' where user_id=p_user and status='pending' and created_at<now()-interval '90 seconds';
  select count(*) filter(where status='pending'),count(*) filter(where created_at>now()-interval '1 minute')
    into active_count,minute_count from public.model_requests where user_id=p_user;
  if active_count>=20 or minute_count>=240 then raise exception 'model_rate_limit'; end if;
  cap:=case when p_provider='DeepSeek' then access.deepseek_limit_nano else access.jev_limit_nano end;
  select coalesce(sum(cost_nano+reserved_nano),0) into spent from public.model_requests where user_id=p_user and provider=p_provider;
  if spent>=cap or spent+p_amount>cap then raise exception 'model_budget_exhausted'; end if;
  insert into public.model_requests(id,user_id,provider,reserved_nano) values(p_id,p_user,p_provider,p_amount);
end $$;
create or replace function public.settle_model_request(p_id uuid,p_cost bigint,p_input bigint,p_output bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_cost<0 or p_input<0 or p_output<0 then raise exception 'invalid_usage'; end if;
  update public.model_requests set status='complete',reserved_nano=0,cost_nano=p_cost,input_tokens=p_input,output_tokens=p_output where id=p_id and status in ('pending','unknown');
end $$;
create or replace function public.fail_model_request(p_id uuid,p_known_not_executed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.model_requests set status=case when p_known_not_executed then 'failed' else 'unknown' end,
    reserved_nano=case when p_known_not_executed then 0 else reserved_nano end where id=p_id and status='pending';
end $$;
revoke all on function public.reserve_model_request(uuid,uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.settle_model_request(uuid,bigint,bigint,bigint) from public,anon,authenticated;
revoke all on function public.fail_model_request(uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_model_request(uuid,uuid,text,bigint) to service_role;
grant execute on function public.settle_model_request(uuid,bigint,bigint,bigint) to service_role;
grant execute on function public.fail_model_request(uuid,boolean) to service_role;
