-- Only the operator can nominate an admin. Signup/user_metadata never grants roles.
create table public.town_admin_emails(email text primary key check(email=lower(email)));
alter table public.town_admin_emails enable row level security;
revoke all on public.town_admin_emails from public,anon,authenticated;
grant all on public.town_admin_emails to service_role;
create function public.user_is_town_admin(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join public.town_admin_emails a on a.email=lower(u.email)
    where u.id=p_user and u.email_confirmed_at is not null)
$$;
revoke all on function public.user_is_town_admin(uuid) from public,anon,authenticated;
grant execute on function public.user_is_town_admin(uuid) to service_role;
create function public.is_town_admin() returns boolean
language sql stable security definer set search_path='' as $$ select public.user_is_town_admin(auth.uid()) $$;
revoke all on function public.is_town_admin() from public;
grant execute on function public.is_town_admin() to anon,authenticated;

-- Private checkpoint and public presentation are separate, so viewers never download
-- editable documents, model traces, resident secrets, or the complete world archive.
create table public.shared_town (
  id boolean primary key default true check(id),
  payload jsonb,
  revision bigint not null default 0,
  host_user uuid references auth.users(id) on delete set null,
  host_session uuid,
  lease_until timestamptz not null default '-infinity',
  updated_at timestamptz not null default now()
);
insert into public.shared_town(id) values(true);
alter table public.shared_town enable row level security;
revoke all on public.shared_town from public,anon,authenticated;
grant select on public.shared_town to authenticated;
grant all on public.shared_town to service_role;
create policy "admins read checkpoint" on public.shared_town for select to authenticated using ((select public.is_town_admin()));
create table public.shared_town_view (
  id boolean primary key default true check(id),
  snapshot jsonb,
  revision bigint not null default 0,
  lease_until timestamptz not null default '-infinity',
  updated_at timestamptz not null default now()
);
insert into public.shared_town_view(id) values(true);
alter table public.shared_town_view enable row level security;
revoke all on public.shared_town_view from public,anon,authenticated;
grant select on public.shared_town_view to anon,authenticated;
grant all on public.shared_town_view to service_role;
create policy "everyone watches shared town" on public.shared_town_view for select to anon,authenticated using(true);

create function public.claim_town_host(p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare town public.shared_town%rowtype; uid uuid:=auth.uid();
begin
  if not public.user_is_town_admin(uid) then raise exception 'admin_required'; end if;
  if p_session is null then raise exception 'invalid_host'; end if;
  select * into town from public.shared_town where id for update;
  if town.lease_until>now() and (town.host_session is distinct from p_session or town.host_user is distinct from uid)
    then raise exception 'town_host_busy'; end if;
  update public.shared_town set host_user=uid,host_session=p_session,lease_until=now()+interval '20 seconds' where id;
  insert into public.model_access(user_id,enabled,deepseek_limit_nano,jev_limit_nano)
    values(uid,true,10000000000,10000000000) on conflict(user_id) do nothing;
  return jsonb_build_object('payload',town.payload,'revision',town.revision);
end $$;
create function public.publish_town(p_session uuid,p_revision bigint,p_payload jsonb,p_snapshot jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare town public.shared_town%rowtype; next_revision bigint;
begin
  if not public.user_is_town_admin(auth.uid()) then raise exception 'admin_required'; end if;
  select * into town from public.shared_town where id for update;
  if town.host_user is distinct from auth.uid() or town.host_session is distinct from p_session or town.lease_until<=now()
    then raise exception 'town_host_lost'; end if;
  if p_revision is distinct from town.revision then raise exception 'save_conflict'; end if;
  if p_payload is null or p_payload->>'format' is distinct from 'valleytown-browser' or p_payload->>'version' is distinct from '1'
    or jsonb_typeof(p_payload->'world') is distinct from 'object' or octet_length(p_payload::text)>10000000
    or p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>1000000
    or p_snapshot->>'id' is distinct from p_payload->'world'->>'id'
    or p_snapshot->>'clock' is distinct from p_payload->'world'->>'clock'
    then raise exception 'invalid_town_payload'; end if;
  -- Do not let a mistakenly published observer snapshot expose private data.
  if p_snapshot ?| array['privateActors','decisions','actionTraces','documentErrors']
    or p_snapshot->>'observer' is distinct from 'false' then raise exception 'private_snapshot'; end if;
  next_revision:=town.revision+1;
  update public.shared_town set payload=p_payload,revision=next_revision,updated_at=now(),lease_until=now()+interval '20 seconds' where id;
  update public.shared_town_view set snapshot=p_snapshot,revision=next_revision,updated_at=now(),lease_until=now()+interval '20 seconds' where id;
  return next_revision;
end $$;
create function public.release_town_host(p_session uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.user_is_town_admin(auth.uid()) then raise exception 'admin_required'; end if;
  perform 1 from public.shared_town where id for update;
  update public.shared_town set host_user=null,host_session=null,lease_until=now()
    where id and host_user=auth.uid() and host_session=p_session;
  if found then update public.shared_town_view set lease_until=now() where id; end if;
end $$;
-- Return the full view only when it changed, keeping idle viewers inexpensive.
create function public.watch_town(p_revision bigint default -1) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('snapshot',case when revision<>p_revision then snapshot else null end,
    'revision',revision,'online',lease_until>now(),'updated_at',updated_at)
  from public.shared_town_view where id
$$;
revoke all on function public.claim_town_host(uuid),public.publish_town(uuid,bigint,jsonb,jsonb),public.release_town_host(uuid),public.watch_town(bigint) from public,anon,authenticated;
grant execute on function public.claim_town_host(uuid),public.publish_town(uuid,bigint,jsonb,jsonb),public.release_town_host(uuid) to authenticated;
grant execute on function public.watch_town(bigint) to anon,authenticated;
-- Retain old private saves for recovery; stop old clients publishing independent worlds.
revoke execute on function public.save_town(jsonb,bigint) from authenticated;

-- Every paid request must come from the active, verified administrator.
alter function public.reserve_model_request(uuid,uuid,text,bigint) rename to reserve_model_request_budget;
create function public.reserve_model_request(p_user uuid,p_id uuid,p_provider text,p_amount bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.user_is_town_admin(p_user) or not exists(select 1 from public.shared_town where id and host_user=p_user and lease_until>now())
    then raise exception 'model_access_denied'; end if;
  perform public.reserve_model_request_budget(p_user,p_id,p_provider,p_amount);
end $$;
revoke all on function public.reserve_model_request(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_model_request(uuid,uuid,text,bigint) to service_role;
