import type { OutdoorKind } from './types';
export type ActionCategory='common'|'place'|'profession'|'situation'|'planning';
export const actionCategoryNames:Record<ActionCategory,string>={common:'通用行动',place:'场所行动',profession:'身份行动',situation:'情境行动',planning:'重新规划'};
export interface ActionCandidate {label:string;kind:string;definitionId?:string;category?:ActionCategory;target?:string;item?:string;outdoorKind?:OutdoorKind}
export interface LocalAction {candidate:ActionCandidate;startedAt:number;endsAt:number}
export interface PlanRequest {id:string;day:number;kind:'daily'|'replan';reason:string;attempts:number;retryAt:number;retryWallAt:number}
export interface PlanningState {
  day:number;dailyIssuedDay:number;plannedDay:number;lastPlannedAt:number;lastReason:string;
  replanCount:number;callsToday:number;nextReplanAt:number;nextReplanWallAt:number;
  contextVersion:number;failures:number;completedActions:number;
  issues:{code:string;detail:string;at:number}[];request:PlanRequest|null;inFlight:string|null;
}
export interface ActionPolicyView {
  catalog:{id:string;category:ActionCategory;description:string}[];
  candidates:Record<string,ActionCandidate>;planning:PlanningState;canReplan:boolean;replanReason:string;
  usage:{purpose:string;calls:number;input:number;output:number}[];localTask:LocalAction|null;mode:'live'|'demo';reflection:'local'|'model';
}
