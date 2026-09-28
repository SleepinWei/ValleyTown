-- Shared observer presentation is public; host checkpoints and model credentials remain private.
create or replace function public.redact_town_presentation(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; pair record; item jsonb; clean text;
begin
  if jsonb_typeof(value)='object' then
    result:='{}'::jsonb;
    for pair in select * from jsonb_each(value) loop
      if regexp_replace(pair.key,'[_-]','','g') ~* '^(.*apikey|.*accesstoken|.*refreshtoken|authorization|headers|cookie|password|servicerole|servicerolekey|secretkey|clientsecret|deepseekkey|jevkey|privatekey|credentials|config|payload|documenterrors|file|imported)$' then continue; end if;
      if pair.key='error' and pair.value <> 'null'::jsonb and pair.value <> '""'::jsonb then
        result:=result||jsonb_build_object(pair.key,'请求失败，诊断详情仅管理员可见');
      else result:=result||jsonb_build_object(pair.key,public.redact_town_presentation(pair.value)); end if;
    end loop;
    return result;
  elsif jsonb_typeof(value)='array' then
    result:='[]'::jsonb;
    for item in select * from jsonb_array_elements(value) loop result:=result||jsonb_build_array(public.redact_town_presentation(item)); end loop;
    return result;
  elsif jsonb_typeof(value)='string' then
    clean:=value#>>'{}';
    clean:=regexp_replace(clean,'\m(sk-|sb_secret_|sbp_)[A-Za-z0-9_-]{8,}\M','[REDACTED]','g');
    clean:=regexp_replace(clean,'\mBearer\s+[A-Za-z0-9._~+/-]+=*','Bearer [REDACTED]','gi');
    clean:=regexp_replace(clean,'\meyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\M','[REDACTED]','g');
    return to_jsonb(clean);
  end if;
  return value;
end $$;
revoke all on function public.redact_town_presentation(jsonb) from public,anon,authenticated;

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
    or p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>8000000
    or p_snapshot->>'id' is distinct from p_payload->'world'->>'id'
    or p_snapshot->>'clock' is distinct from p_payload->'world'->>'clock'
    then raise exception 'invalid_town_payload'; end if;
  if p_snapshot->>'observer'='true' and p_snapshot->>'displayVersion' is distinct from '2'
    then raise exception 'invalid_view_version'; end if;
  -- Allowlist the root contract, then redact credentials/errors recursively.
  select public.redact_town_presentation(jsonb_object_agg(key,value)) into p_snapshot
    from jsonb_each(p_snapshot) where key=any(array['id','clock','dayMinutes','status','mode','weather','actors','player','events','conversations','appointments','quests','usage','configured','notice','observer','society','runtime','incidents','timing','bubbles','performance','laboratory','privateActors','decisions','actionTraces','readViews','playerView','displayVersion']);
  next_revision:=town.revision+1;
  update public.shared_town set payload=p_payload,revision=next_revision,updated_at=now(),lease_until=now()+interval '120 seconds' where id;
  update public.shared_town_view set snapshot=p_snapshot,revision=next_revision,updated_at=now(),lease_until=now()+interval '120 seconds' where id;
  return next_revision;
end $$;

revoke all on function public.publish_town(uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.publish_town(uuid,bigint,jsonb,jsonb) to authenticated;
