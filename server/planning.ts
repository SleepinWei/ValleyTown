import { randomUUID } from 'node:crypto';
import type { Actor } from '../shared/types';
import { dayOf } from '../shared/types';
import type { PlanRequest, PlanningState } from '../shared/actions';
export const planningPolicy={maxReplansPerDay:2,replanCooldownMinutes:180,replanCooldownMs:30000,maxAttempts:2,retryMinutes:60,retryMs:10000};
export function planning(a:Actor,clock:number):PlanningState {
  const day=dayOf(clock);
  a.planning??={day,dailyIssuedDay:-1,plannedDay:-1,lastPlannedAt:-1,lastReason:'尚未进行每日规划',replanCount:0,callsToday:0,nextReplanAt:0,nextReplanWallAt:0,contextVersion:0,failures:0,completedActions:0,issues:[],request:null,inFlight:null};
  const p=a.planning;
  if(p.day!==day){p.day=day;p.replanCount=0;p.callsToday=0;p.completedActions=0;p.request=null;p.issues=[];p.failures=0;}
  return p;
}
export function planIssue(a:Actor,clock:number,code:string,detail:string){const p=planning(a,clock);p.issues=p.issues.filter(i=>i.code!==code);p.issues.push({code,detail:detail.slice(0,160),at:clock});p.issues=p.issues.slice(-6);}
export function replanEligibility(a:Actor,clock:number):{allowed:boolean;reason:string}{
  const p=planning(a,clock);
  if(p.request||p.inFlight)return {allowed:false,reason:'已有规划请求，继续执行可行行动'};
  if(p.dailyIssuedDay!==dayOf(clock))return {allowed:false,reason:'等待当天首次规划，不重复请求'};
  if(p.replanCount>=planningPolicy.maxReplansPerDay)return {allowed:false,reason:'已达到每日 2 次重规划上限'};
  if(clock<p.nextReplanAt||Date.now()<p.nextReplanWallAt)return {allowed:false,reason:'重规划冷却中（3 游戏小时且至少 30 秒）'};
  if(!p.issues.length)return {allowed:false,reason:'当前没有需要重规划的新情况'};
  return {allowed:true,reason:p.issues.map(i=>i.detail).join('；')};
}
export function requestPlan(a:Actor,clock:number,kind:PlanRequest['kind'],reason:string):PlanRequest {
  const p=planning(a,clock);if(p.request||p.inFlight)throw new Error('已有规划请求');
  if(kind==='replan'){const eligibility=replanEligibility(a,clock);if(!eligibility.allowed)throw new Error(eligibility.reason);p.replanCount++;}
  else {if(p.dailyIssuedDay===dayOf(clock))throw new Error('当天首次规划已经请求过');p.dailyIssuedDay=dayOf(clock);}
  p.request={id:randomUUID(),day:dayOf(clock),kind,reason,attempts:0,retryAt:clock,retryWallAt:0};
  p.nextReplanAt=clock+planningPolicy.replanCooldownMinutes;p.nextReplanWallAt=Date.now()+planningPolicy.replanCooldownMs;
  a.nextPlan=Math.floor(clock/1440+1)*1440;
  return p.request;
}
export function failPlan(a:Actor,clock:number,requestId:string,reason:string){
  const p=planning(a,clock),r=p.request;if(r?.id!==requestId)return;
  if(r.attempts>=planningPolicy.maxAttempts){p.request=null;planIssue(a,clock,'plan_failed',`规划未更新：${reason.slice(0,80)}。保留原目标，Jev 仍可行动`);}
  else {r.retryAt=clock+planningPolicy.retryMinutes;r.retryWallAt=Date.now()+planningPolicy.retryMs;}
}
export function completedAction(a:Actor,clock:number){const p=planning(a,clock);p.failures=0;p.completedActions++;if(p.completedActions%3===0)planIssue(a,clock,'progress','已完成多项行动，可以复核当天剩余目标');}
export function failedAction(a:Actor,clock:number,reason:string){const p=planning(a,clock);p.failures++;if(p.failures>=2)planIssue(a,clock,'action_failed',`连续行动失败：${reason.slice(0,80)}`);}
