import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Store } from '../server/store';
import { World } from '../server/world';
import { planning, planningPolicy } from '../server/planning';
const dir=mkdtempSync('/private/tmp/valley-policy-three-days-'),store=new Store(dir),w=new World(store,'demo');
const calls:{actor:string;day:number;kind:string}[]=[];
const original=w.plan.bind(w);
w.plan=async a=>{const p=planning(a,w.state.clock),before=p.callsToday,kind=p.request?.kind??'daily',day=p.day;await original(a);if(p.callsToday>before)calls.push({actor:a.id,day,kind});};
try{
 w.state.clock=0;w.state.dayMinutes=5;for(const a of w.state.actors){a.nextPlan=0;a.nextDecision=0;}w.resume();
 while(w.state.clock<4320){w.tick(Math.min(.25,(4320-w.state.clock)*300/1440));await new Promise(r=>setImmediate(r));}
 w.pause();while(w.active)await new Promise(r=>setImmediate(r));
 const daily=calls.filter(c=>c.kind==='daily'&&c.day<=3),replans=calls.filter(c=>c.kind==='replan'&&c.day<=3);
 const days=[1,2,3].map(day=>({day,daily:daily.filter(c=>c.day===day).length,replans:replans.filter(c=>c.day===day).length}));
 const seen=new Set<string>();for(const c of daily){const key=`${c.actor}:${c.day}`;assert.ok(!seen.has(key));seen.add(key);}
 for(const a of w.state.actors)for(const day of [1,2,3])assert.ok(replans.filter(c=>c.actor===a.id&&c.day===day).length<=planningPolicy.maxReplansPerDay);
 assert.equal(store.usage().used,0);assert.equal(w.state.clock,4320);assert.ok(w.state.conversations.length>0);
 const report={mode:'三完整游戏日规则演示，零 API 调用；只验证调度与行为，不代表真实 token 或模型效果',days,dailyPlans:daily.length,replans:replans.length,baselinePeriodicPlanningOpportunities:24*4*3,tokens:store.usage().used,conversations:w.state.conversations.length,completedWorkEvents:(store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE json_extract(json,'$.kind')='work'").get() as {n:number}).n,finalStatus:w.state.status};
 writeFileSync('output/action-policy-three-days.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
