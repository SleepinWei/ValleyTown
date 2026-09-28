-- Allow ordinary background-tab timer throttling without losing the exclusive host.
-- Authentication remains independent of this bounded simulation lease.
create or replace function public.claim_town_host(p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare town public.shared_town%rowtype; uid uuid:=auth.uid();
begin
  if not public.user_is_town_admin(uid) then raise exception 'admin_required'; end if;
  if p_session is null then raise exception 'invalid_host'; end if;
  select * into town from public.shared_town where id for update;
  if town.lease_until>now() and (town.host_session is distinct from p_session or town.host_user is distinct from uid)
    then raise exception 'town_host_busy'; end if;
  update public.shared_town set host_user=uid,host_session=p_session,lease_until=now()+interval '120 seconds' where id;
  insert into public.model_access(user_id,enabled,deepseek_limit_nano,jev_limit_nano)
    values(uid,true,10000000000,10000000000) on conflict(user_id) do nothing;
  return jsonb_build_object('payload',town.payload,'revision',town.revision);
end $$;
create or replace function public.publish_town(p_session uuid,p_revision bigint,p_payload jsonb,p_snapshot jsonb) returns bigint
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
  update public.shared_town set payload=p_payload,revision=next_revision,updated_at=now(),lease_until=now()+interval '120 seconds' where id;
  update public.shared_town_view set snapshot=p_snapshot,revision=next_revision,updated_at=now(),lease_until=now()+interval '120 seconds' where id;
  return next_revision;
end $$;
