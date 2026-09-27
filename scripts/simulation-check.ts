import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../server/store';
import { World } from '../server/world';
const dir=mkdtempSync(join(tmpdir(),'valleytown-three-days-'));
const store=new Store(dir);const world=new World(store,'demo');
try{
 const start=world.state.clock,target=start+3*1440;world.state.dayMinutes=5;world.resume();
 let ticks=0;
 while(world.state.clock<target&&ticks++<20000){world.tick(Math.min(.25,(target-world.state.clock)*world.state.dayMinutes*60/1440));await new Promise(resolve=>setImmediate(resolve));}
 world.pause();while(world.active)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(world.state.clock,target);assert.equal(world.state.status,'paused_manual');
 assert.ok(world.state.actors.every(a=>a.memories.length>5));assert.ok(world.state.conversations.length>0);
 assert.equal(store.usage().used,0);
 const report={mode:'规则演示，不代表真实模型效果或 token 测量',days:3,ticks,eventCount:(store.db.prepare('SELECT COUNT(*) AS n FROM events').get()as{n:number}).n,marriages:world.state.actors.filter(a=>a.life.spouse&&a.id<a.life.spouse).length,children:world.state.actors.filter(a=>a.life.stage==='child').length,pendingBirths:world.state.society.births.length,cases:world.state.society.cases.length,conversations:world.state.conversations.length,appointments:world.state.appointments.length,quests:world.state.quests.map(q=>({title:q.title,progress:q.progress,completed:q.completed})),residents:world.state.actors.map(a=>({name:a.name,memories:a.memories.length,reflections:a.memories.filter(m=>m.kind==='reflection').length})),tokens:store.usage().used};
 mkdirSync('output',{recursive:true});writeFileSync('output/simulation-three-days.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
