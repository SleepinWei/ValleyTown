import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from '../server/store';
import type { Snapshot } from '../shared/types';
import type { ActionTrace } from '../shared/telemetry';

const root=resolve('output/system-stress');
const module:typeof import('../server/worker-client')=await import(pathToFileURL(resolve(root,'code/server/worker-client.ts')).href);
const refine=process.argv.includes('--refine');
const previous=refine?JSON.parse(readFileSync(resolve(root,'results.json'),'utf8')):null;
const remaining:{Jev:number;DeepSeek:number}=previous?.remaining??{Jev:2.4,DeepSeek:.6};
const results:any[]=previous?.stages??[];
let interrupted=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{interrupted=true;});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const q=(values:number[],p:number)=>{const a=[...values].sort((x,y)=>x-y);return a.length?a[Math.max(0,Math.ceil(a.length*p)-1)]:null;};
const count=(values:string[])=>Object.fromEntries([...new Set(values)].map(v=>[v,values.filter(x=>x===v).length]));
function summarize(dir:string,start:number,startClock:number,endClock:number,seconds:number){
  const store=new Store(dir);
  try{
    const calls=store.db.prepare('SELECT provider,purpose,status,input,output,cached_input,cost_nano,reserved_nano,latency,error FROM calls WHERE created>=?').all(start) as any[];
    const traces=(store.db.prepare('SELECT json FROM action_traces WHERE created>=?').all(start) as {json:string}[]).map(r=>JSON.parse(r.json) as ActionTrace);
    const applied=traces.filter(t=>['applied','overridden'].includes(t.status));
    const events=(store.db.prepare('SELECT json FROM events').all() as {json:string}[]).map(r=>JSON.parse(r.json)).filter(e=>e.at>startClock&&e.at<=endClock);
    return {calls:count(calls.map(r=>r.status)),attempts:calls.length,providers:Object.fromEntries(['Jev','DeepSeek'].map(p=>[p,{attempts:calls.filter(r=>r.provider===p).length,costCny:calls.filter(r=>r.provider===p).reduce((s,r)=>s+r.cost_nano,0)/1e9,reservedCny:calls.filter(r=>r.provider===p).reduce((s,r)=>s+r.reserved_nano,0)/1e9}])),
      purposes:count(calls.map(r=>`${r.provider}:${r.purpose}`)),input:calls.reduce((s,r)=>s+r.input,0),output:calls.reduce((s,r)=>s+r.output,0),
      actions:{count:traces.length,statuses:count(traces.map(t=>t.status)),queueP50:q(traces.map(t=>t.queueMs),.5),queueP95:q(traces.map(t=>t.queueMs),.95),modelP50:q(traces.filter(t=>t.finishedAt).map(t=>t.modelMs),.5),modelP95:q(traces.filter(t=>t.finishedAt).map(t=>t.modelMs),.95),
        applied:applied.length,appliedPerSecond:applied.length/seconds,endToEndP50:q(applied.map(t=>t.appliedAt!-t.queuedAt),.5),endToEndP95:q(applied.map(t=>t.appliedAt!-t.queuedAt),.95),
        triggers:count(traces.map(t=>t.facts.trigger??'unknown'))},events:count(events.map(e=>e.kind))};
  }finally{store.close();}
}
for(const speed of (refine?[48,72]:[6,12,24,48,96,192])){
  if(interrupted||remaining.Jev<.04||remaining.DeepSeek<.04)break;
  const stageId=refine?`refine-x${speed}`:`x${speed}`;
  const dir=resolve(root,stageId),store=new Store(dir),usage=store.usage();
  for(const p of ['Jev','DeepSeek'] as const){const b=usage.pools[p];store.setLimit(p,Math.floor((b.spentCny+b.reservedCny+remaining[p])*100)/100);}
  const saved=store.load()!;saved.status='paused_manual';saved.mode='live';store.save(saved);store.close();
  const worker=new module.SimulationWorker({dir,mode:'live'});await worker.ready;
  const control=async(action:string,value?:number)=>{const r=await worker.request('POST','/api/control',{action,...value!==undefined?{value}:{}});if(r.status!==200)throw new Error(JSON.stringify(r.body));};
  const samples:any[]=[];let start=0,stop=0,startClock=0,endClock=0,reason='duration';let finalSnapshot:Snapshot|any;
  const initialUsed=worker.snapshot().usage.used;
  try{
    if(!worker.snapshot().configured.jev||!worker.snapshot().configured.deepseek)throw new Error('模型密钥未配置');
    await control('speed',30/speed);startClock=worker.snapshot().clock;start=Date.now();await control('resume');
    console.log(JSON.stringify({event:'stage-start',speed,startClock,remaining}));
    while(Date.now()-start<45_000&&!interrupted){
      const s=worker.snapshot() as Snapshot&{stressBenchmark:any};
      samples.push({at:Date.now(),clock:s.clock,status:s.status,timing:s.timing,performance:s.performance,metrics:s.stressBenchmark,busy:s.actors.filter(a=>a.busy).length});
      if(s.status!=='running_live'){reason=s.status;break;}
      if(Date.now()-start>15_000&&s.usage.used===initialUsed&&s.usage.recent.every(c=>c.created>=start&&c.status==='failed')){reason='network-failed';break;}
      if(samples.length%60===0)console.log(JSON.stringify({event:'progress',speed,elapsedSeconds:(Date.now()-start)/1000,actual:s.timing.actualMultiplier,active:s.performance.active}));
      await sleep(250);
    }
    if(interrupted)reason='interrupted';
  }finally{await control('pause');stop=Date.now();finalSnapshot=worker.snapshot();endClock=finalSnapshot.clock;await worker.close();}
  const seconds=(stop-start)/1000,metrics=summarize(dir,start,startClock,endClock,seconds);
  for(const p of ['Jev','DeepSeek'] as const)remaining[p]=Math.max(0,remaining[p]-metrics.providers[p].costCny-metrics.providers[p].reservedCny);
  const gameHours=(endClock-startClock)/60;
  const stage={stageId,speed,start,stop,seconds,startClock,endClock,gameHours,actualMultiplier:(endClock-startClock)/seconds/.8,reason,...metrics,
    completedLocalActivitiesPerGameHour:((metrics.events.work??0)+(metrics.events.activity??0))/gameHours,
    costPerGameHour:Object.values(metrics.providers).reduce((s:any,p:any)=>s+p.costCny,0)/gameHours,
    instrumentation:finalSnapshot.stressBenchmark,samples};
  results.push(stage);writeFileSync(resolve(root,`${stageId}-results.json`),JSON.stringify(stage,null,2));
  writeFileSync(resolve(root,'results.json'),JSON.stringify({remaining,stages:results.map(({samples,...s})=>s)},null,2));
  console.log(JSON.stringify({event:'stage-finished',...stage,samples:samples.length,remaining}));
  if(reason!=='duration')break;
}
console.log(JSON.stringify({event:'finished',remaining,stages:results.length}));
