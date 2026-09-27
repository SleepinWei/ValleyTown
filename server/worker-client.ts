import type { BudgetLimits } from '../shared/budget';
import { Worker } from 'node:worker_threads';
import type { Snapshot } from '../shared/types';

export class SimulationWorker {
 private worker:Worker;
 private seq=0;private pending=new Map<number,{resolve:(value:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private failed:Error|null=null;private closing=false;
 snapshots:{player:Snapshot;observer:Snapshot}|null=null;
 onSnapshot=()=>{};onFailure=(_error:Error)=>{};
 readonly ready:Promise<void>;
 constructor(options:{dir:string;mode:'live'|'demo';limits?:BudgetLimits}){
  // tsx registration must occur inside the worker before loading TypeScript modules.
  this.worker=new Worker(new URL('./simulation-worker.mjs',import.meta.url),{workerData:options,execArgv:[]});
  this.ready=new Promise((resolve,reject)=>{
   this.worker.on('message',message=>{
    if(message.type==='snapshot'){this.snapshots=message.value;resolve();this.onSnapshot();}
    if(message.type==='reply'){const p=this.pending.get(message.id);if(p){clearTimeout(p.timer);this.pending.delete(message.id);if(message.error)p.reject(new Error(message.error));else p.resolve(message.value);}}
   });
   const failure=(error:Error)=>{if(this.failed)return;this.failed=error;reject(error);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.onFailure(error);};
   this.worker.on('error',failure);this.worker.on('exit',code=>{if(!this.closing)failure(new Error(`模拟线程已停止 (${code})，请重启本地服务`));});
  });
 }
 snapshot(observer=false){if(this.failed)throw this.failed;if(!this.snapshots)throw new Error('模拟线程正在启动');return observer?this.snapshots.observer:this.snapshots.player;}
 async request(method:string,url:string,body?:unknown){await this.ready;return this.rpc('request',{method,url,body});}
 private rpc(type:string,value:unknown){
  if(this.failed)return Promise.reject(this.failed);
  const id=++this.seq;
  return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('模拟线程响应超时，请刷新状态确认结果'));},type==='close'?120000:30000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,type,value});});
 }
 async close(){if(this.closing)return;this.closing=true;try{if(!this.failed)await this.rpc('close',null);}finally{await this.worker.terminate();}}
}
