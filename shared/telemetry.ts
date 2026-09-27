import type { ActionCategory } from './actions';
import type { CallRecord } from './types';
export interface ActionTrace {
  id:string; worldId:string; actorId:string; source:string; mode:'live'|'demo';
  queuedAt:number; startedAt:number; finishedAt?:number; appliedAt?:number;
  queueMs:number; modelMs:number; totalMs?:number; deferredMs?:number;
  status:'requesting'|'deferred'|'applied'|'overridden'|'rejected'|'failed'|'interrupted';
  candidateCategories?:Record<string,ActionCategory>; candidates:Record<string,string>; facts:{weather:string;energy:number;plan:string;region:string;trigger?:string};
  selected?:string; effective?:string; probabilities:Record<string,number>; confidence?:number;
  reason?:string; activity?:string; events:{id:string;text:string}[]; attempts:CallRecord[];
}
export type LabScenario='baseline'|'rain'|'tired'|'enemy'|'lover';
export interface LabSample {
  id:string; pair:number; variant:'before'|'after'; provider:'Jev'|'DeepSeek'; inputHash:string;
  queuedAt:number; startedAt?:number; finishedAt?:number; queueMs?:number; totalMs?:number; modelMs?:number;
  status:'queued'|'running'|'complete'|'failed'|'cancelled'|'interrupted'; choice?:string; probabilities?:Record<string,number>;
  attempts:CallRecord[]; error?:string;
}
export interface LabRun {
  id:string; actorId:string; actorName:string; profile?:'synthetic'|'resident'; scenario:LabScenario; repeats:number; paired:boolean;
  status:'running'|'stopping'|'complete'|'cancelled'|'interrupted'; created:number; finished?:number;
  inputs:{before:{state:unknown;candidates:Record<string,string>;instructions:string;hash:string};after:{state:unknown;candidates:Record<string,string>;instructions:string;hash:string}};
  samples:LabSample[];
}
export function percentile(values:number[],p:number):number|null {if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];}
export function labStats(run:LabRun,provider:LabSample['provider']) {
  const rows=run.samples.filter(s=>s.provider===provider),done=rows.filter(s=>s.status==='complete'||s.status==='failed'),success=done.filter(s=>s.status==='complete');
  const attempts=rows.flatMap(s=>s.attempts),duration=done.reduce((sum,s)=>sum+(s.modelMs??0),0);
  return {count:done.length,success:success.length,rate:done.length?success.length/done.length:null,
    p50:percentile(done.map(s=>s.modelMs??0),.5),p95:percentile(done.map(s=>s.modelMs??0),.95),
    successP50:percentile(success.map(s=>s.modelMs??0),.5),queueP50:percentile(done.map(s=>s.queueMs??0),.5),
    totalP95:percentile(done.map(s=>s.totalMs??0),.95),perMinute:duration?success.length*60000/duration:null,
    attempts:attempts.length,retries:rows.reduce((sum,s)=>sum+Math.max(0,s.attempts.length-1),0),
    tokens:attempts.reduce((sum,a)=>sum+a.input+a.output,0),reserved:attempts.reduce((sum,a)=>sum+a.reserved,0)};
}
