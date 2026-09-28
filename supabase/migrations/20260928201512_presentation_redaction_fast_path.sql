-- Client-published v2 views are already redacted. Prove they contain no
-- sensitive keys, token markers or raw errors before reusing them unchanged.
-- Any suspicious content falls through to the complete recursive sanitizer.
create or replace function public.redact_town_presentation(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; clean text; serialized text;
begin
  if jsonb_typeof(value)='object' and value->>'displayVersion'='2' then
    serialized:=value::text;
    if translate(serialized,'_-','') !~* '"([^"]*apikey|[^"]*accesstoken|[^"]*refreshtoken|authorization|headers|cookie|password|servicerole|servicerolekey|secretkey|clientsecret|deepseekkey|jevkey|privatekey|credentials|config|payload|documenterrors|file|imported)"[[:space:]]*:'
      and serialized !~* '(sk-|sb_secret_|sbp_|bearer|eyJ)'
      and not jsonb_path_exists(value,'$.**.error ? (@ != null && @ != "" && @ != "请求失败，诊断详情仅管理员可见")')
      then return value;
    end if;
  end if;
  case jsonb_typeof(value)
  when 'object' then
    select coalesce(jsonb_object_agg(e.key,
      case when e.key='error' and e.value not in ('null'::jsonb,'""'::jsonb)
        then to_jsonb('请求失败，诊断详情仅管理员可见'::text)
        when jsonb_typeof(e.value) in ('object','array','string') then public.redact_town_presentation(e.value)
        else e.value end),'{}'::jsonb) into result
    from jsonb_each(value) e
    where translate(e.key,'_-','') !~* '^(.*apikey|.*accesstoken|.*refreshtoken|authorization|headers|cookie|password|servicerole|servicerolekey|secretkey|clientsecret|deepseekkey|jevkey|privatekey|credentials|config|payload|documenterrors|file|imported)$';
    return result;
  when 'array' then
    select coalesce(jsonb_agg(case when jsonb_typeof(e.item) in ('object','array','string')
      then public.redact_town_presentation(e.item) else e.item end order by e.position),'[]'::jsonb) into result
    from jsonb_array_elements(value) with ordinality e(item,position);
    return result;
  when 'string' then
    clean:=value#>>'{}';
    if position('sk-' in clean)>0 or position('sb_secret_' in clean)>0 or position('sbp_' in clean)>0 then
      clean:=regexp_replace(clean,'\m(sk-|sb_secret_|sbp_)[A-Za-z0-9_-]{8,}\M','[REDACTED]','g');
    end if;
    if position('bearer' in lower(clean))>0 then
      clean:=regexp_replace(clean,'\mBearer\s+[A-Za-z0-9._~+/-]+=*','Bearer [REDACTED]','gi');
    end if;
    if position('eyJ' in clean)>0 then
      clean:=regexp_replace(clean,'\meyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\M','[REDACTED]','g');
    end if;
    return to_jsonb(clean);
  else return value;
  end case;
end $$;
revoke all on function public.redact_town_presentation(jsonb) from public,anon,authenticated;
