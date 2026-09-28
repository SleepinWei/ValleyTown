-- Cumulative project-wide budgets, retained even if an account is removed.
-- 1 CNY = 1,000,000,000 nano-CNY; no automatic daily/monthly reset.
create table public.model_budgets (
  provider text primary key check(provider in ('DeepSeek','Jev')),
  enabled boolean not null default true,
  limit_nano bigint not null check(limit_nano>=0),
  used_nano bigint not null default 0 check(used_nano>=0)
);
alter table public.model_budgets enable row level security;
revoke all on public.model_budgets from public,anon,authenticated;
grant all on public.model_budgets to service_role;
insert into public.model_budgets(provider,limit_nano,used_nano)
select provider,10000000000,coalesce((select sum(cost_nano+reserved_nano)
  from public.model_requests r where r.provider=p.provider),0)
from (values ('DeepSeek'),('Jev')) as p(provider);

create or replace function public.reserve_model_request(p_user uuid,p_id uuid,p_provider text,p_amount bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare access public.model_access%rowtype; spent bigint; cap bigint; active_count bigint; minute_count bigint; budget public.model_budgets%rowtype;
begin
  if p_provider is null or p_provider not in ('DeepSeek','Jev') or p_amount is null or p_amount<0 then raise exception 'invalid_reservation'; end if;
  -- One provider row serializes reservations across ALL accounts.
  select * into budget from public.model_budgets where provider=p_provider for update;
  if not found or not budget.enabled or budget.used_nano+p_amount>budget.limit_nano
    or budget.used_nano>=budget.limit_nano then raise exception 'model_budget_exhausted'; end if;
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
  update public.model_budgets set used_nano=used_nano+p_amount where provider=p_provider;
  insert into public.model_requests(id,user_id,provider,reserved_nano) values(p_id,p_user,p_provider,p_amount);
end $$;
create or replace function public.settle_model_request(p_id uuid,p_cost bigint,p_input bigint,p_output bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare request public.model_requests%rowtype; supplier text;
begin
  if p_cost is null or p_input is null or p_output is null or p_cost<0 or p_input<0 or p_output<0 then raise exception 'invalid_usage'; end if;
  select provider into supplier from public.model_requests where id=p_id;
  if not found then return; end if;
  -- Same lock order as reserve/fail; duplicate callbacks cannot release twice.
  perform 1 from public.model_budgets where provider=supplier for update;
  select * into request from public.model_requests where id=p_id for update;
  if not found or request.status not in ('pending','unknown') then return; end if;
  update public.model_budgets set used_nano=used_nano-request.reserved_nano+p_cost,
    enabled=enabled and p_cost<=request.reserved_nano where provider=supplier;
  update public.model_requests set status='complete',reserved_nano=0,cost_nano=p_cost,
    input_tokens=p_input,output_tokens=p_output where id=p_id;
end $$;
create or replace function public.fail_model_request(p_id uuid,p_known_not_executed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare request public.model_requests%rowtype; supplier text;
begin
  select provider into supplier from public.model_requests where id=p_id;
  if not found then return; end if;
  perform 1 from public.model_budgets where provider=supplier for update;
  select * into request from public.model_requests where id=p_id for update;
  if not found or request.status<>'pending' then return; end if;
  if p_known_not_executed is true then
    update public.model_budgets set used_nano=used_nano-request.reserved_nano where provider=supplier;
    update public.model_requests set status='failed',reserved_nano=0 where id=p_id;
  else
    update public.model_requests set status='unknown' where id=p_id;
  end if;
end $$;
revoke all on function public.reserve_model_request(uuid,uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.settle_model_request(uuid,bigint,bigint,bigint) from public,anon,authenticated;
revoke all on function public.fail_model_request(uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_model_request(uuid,uuid,text,bigint) to service_role;
grant execute on function public.settle_model_request(uuid,bigint,bigint,bigint) to service_role;
grant execute on function public.fail_model_request(uuid,boolean) to service_role;
