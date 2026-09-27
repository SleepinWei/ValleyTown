import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from '../server/store';

const replacement=process.argv.includes('--deepseek-replacement');
const name=replacement?'replacement':'current';
const dir=resolve(`output/system-measure/${name}`);
const file=resolve(`output/system-measure/${name}-results.json`);
const workerModule:typeof import('../server/worker-client')=replacement
  ?await import(pathToFileURL(resolve('output/system-measure/replacement-code/server/worker-client.ts')).href)
  :await import('../server/worker-client');
const {SimulationWorker}=workerModule;
const durationMs=90_000;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const store=new Store(dir);
const before=store.usage();
for(const provider of ['Jev','DeepSeek'] as const){
  if(replacement&&provider==='Jev')continue;
  const pool=before.pools[provider];
  // Round down so reserved calls share the same incremental test cap.
  store.setLimit(provider,Math.floor((pool.spentCny+pool.reservedCny+(replacement?.60:.30))*100)/100);
}
const saved=store.load()!;saved.status='paused_manual';saved.mode='live';store.save(saved);store.close();
const worker=new SimulationWorker({dir,mode:'live'});
await worker.ready;
const configured=worker.snapshot().configured;
if(!configured.jev||!configured.deepseek){await worker.close();throw new Error('真实模型密钥未配置');}
const initialUsed=worker.snapshot().usage.used;
async function control(action:string,value?:number){const r=await worker.request('POST','/api/control',{action,...value!==undefined?{value}:{}});if(r.status!==200)throw new Error(JSON.stringify(r.body));}
const samples:any[]=[];
let start=0,stop=0,startClock=0,endClock=0,reason='duration',settledAt=0;
try{
  await control('speed',5);
  startClock=worker.snapshot().clock;start=Date.now();
  await control('resume');
  while(Date.now()-start<durationMs){
    const s=worker.snapshot();
    samples.push({at:Date.now(),clock:s.clock,status:s.status,timing:s.timing,performance:s.performance,
      pools:s.usage.pools,used:s.usage.used,
      actors:{busy:s.actors.filter(a=>a.busy).length}});
    if(s.status!=='running_live'){reason=s.status;break;}
    if(Date.now()-start>15_000&&s.usage.used===initialUsed&&s.usage.recent.length>=8
      &&s.usage.recent.every(c=>c.created>=start&&c.status==='failed')){
      reason='no_successful_requests';break;
    }
    if(samples.length%15===0)console.log(JSON.stringify({elapsed:Math.round((Date.now()-start)/1000),clock:s.clock,timing:s.timing,active:s.performance?.active}));
    await sleep(1000);
  }
}finally{
  await control('pause');stop=Date.now();endClock=worker.snapshot().clock;
  await worker.close();settledAt=Date.now();
}
const result={kind:replacement?'deepseek-replacement-live':'current-system-live',start,stop,settledAt,startClock,endClock,reason,seconds:(stop-start)/1000,
  validPerformanceMeasurement:worker.snapshots!.player.usage.used>initialUsed,
  gameMinutes:endClock-startClock,actualMultiplier:(endClock-startClock)/((stop-start)/1000)/.8,
  protocol:{durationMs,targetMultiplier:6,extraBudgetsCny:replacement?{DeepSeek:.60,Jev:0}:{DeepSeek:.30,Jev:.30},isolated:true,realModels:true,productionWorker:true},samples};
writeFileSync(file,JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,samples:result.samples.length}));
