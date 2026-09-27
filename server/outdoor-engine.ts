import { completedAction } from './planning';
import { randomUUID } from 'node:crypto';
import type { World } from './world';
import type { OutdoorKind } from '../shared/types';
import { outdoorWeatherBlock, weatherInfo } from '../shared/weather';
import { outdoorActivities, skillLevel } from '../shared/outdoors';
import { distance, items, location, pathfind } from '../shared/map';

function available(world:World,who:string,kind:OutdoorKind){
  const person=world.person(who),spec=outdoorActivities[kind];
  const blocked=outdoorWeatherBlock(world.state.weather,kind);if(blocked)throw new Error(blocked);
  if(person.energy<Math.ceil(spec.energy*weatherInfo(world.state.weather).effort))throw new Error('体力不足，先到广场或营地休息');
  if(spec.gear&&!(person.inventory[spec.gear]>0))throw new Error(`需要${items[spec.gear].name}，可在杂货铺购买`);
  if(spec.consume&&!(person.inventory[spec.consume]>0))throw new Error(`${items[spec.consume].name}不足，去杂货铺补给吧`);
  const hour=world.state.clock%1440/60;
  if(kind==='hunting'&&(hour<6||hour>=19))throw new Error('林区狩猎开放时间为 06:00–19:00，请白天再来');
}
export function cancelOutdoor(world:World,who:string){
  const person=world.person(who),task=person.outdoor.task;if(!task)return;
  person.outdoor.task=null;person.path=[];
  if(who!=='player'){const a=world.actor(who);a.target=null;a.activity='结束户外活动';a.nextDecision=world.state.clock+15;}
}
export function startOutdoor(world:World,who:string,kind:OutdoorKind,place:string){
  world.requireRunning();world.requireAvailable(who,true);const person=world.person(who),spec=outdoorActivities[kind];
  if(!spec||!spec.places.includes(place))throw new Error('这个地点不支持该活动');
  if(person.conversation)throw new Error('请先结束交谈，再出发');
  if(person.outdoor.task)throw new Error('已经有一项户外活动，先结束它再开始');
  available(world,who,kind);const site=location(place),path=pathfind(person,site.door);
  if(distance(person,site.door)>4&&!path.length)throw new Error('暂时没有前往该地点的道路');
  person.path=path;person.outdoor.task={id:randomUUID(),kind,place,phase:'travel',startedAt:world.state.clock,endsAt:null};
  if(who!=='player'){const a=world.actor(who);a.target=null;a.activity=`去${site.name}${spec.name}`;a.nextDecision=world.state.clock+spec.duration;}
  world.event('outdoor',`${world.name(who)}出发前往${site.name}，准备${spec.name}。`,[who],['public'],'世界规则');
  world.persist();
}
function random(world:World){world.state.rng=((world.state.rng??81927)*1664525+1013904223)>>>0;return world.state.rng/4294967296;}
export function advanceOutdoor(world:World){
  if(world.state.status.startsWith('paused'))return;
  for(const who of ['player',...world.state.actors.map(a=>a.id)]){
    const p=world.person(who),task=p.outdoor.task;if(!task)continue;
    const blocked=outdoorWeatherBlock(world.state.weather,task.kind);if(blocked){
      const text=`${world.name(who)}因${world.state.weather}中止${outdoorActivities[task.kind].name}：${blocked}。`;
      cancelOutdoor(world,who);p.outdoor.lastResult={text,at:world.state.clock,success:false};
      const event=world.event('outdoor',text,[who],['public'],'天气规则');
      if(who!=='player'){const a=world.actor(who);world.memory(a,text,event.id);a.nextDecision=world.state.clock;}
      world.persist();continue;
    }
    const spec=outdoorActivities[task.kind],site=location(task.place);
    if(task.phase==='travel'){
      if(p.path.length)continue;
      if(distance(p,site.door)>4){cancelOutdoor(world,who);continue;}
      try{available(world,who,task.kind);}catch(e){p.outdoor.lastResult={text:(e as Error).message,at:world.state.clock,success:false};cancelOutdoor(world,who);continue;}
      task.phase='active';task.startedAt=world.state.clock;task.endsAt=world.state.clock+spec.duration;
      p.energy-=Math.ceil(spec.energy*weatherInfo(world.state.weather).effort);if(spec.consume)p.inventory[spec.consume]--;
      if(who!=='player')world.actor(who).activity=spec.verb;
      world.event('outdoor',`${world.name(who)}在${site.name}开始${spec.name}。`,[who],['public'],'世界规则');
      world.persist();
      continue;
    }
    if(world.state.clock<task.endsAt!)continue;
    // Clear first: a restored checkpoint or another tick cannot award twice.
    p.outdoor.task=null;let success=true,item:string|undefined,text:string;
    if(task.kind==='rest'){p.energy=Math.min(100,p.energy+32);text=`${world.name(who)}在${site.name}休息了一会儿，恢复了体力。`;}
    else if(spec.skill==='fitness'){p.outdoor.xp.fitness+=10;text=`${world.name(who)}完成了${site.name}的${spec.name}训练，体能经验 +10。`;}
    else {
      const skill=task.kind==='fishing'?'fishing':'hunting';const xp=p.outdoor.xp[skill],level=skillLevel(xp);const chance=task.kind==='fishing'?.64+level*.025+weatherInfo(world.state.weather).fishBonus:.5+level*.035;
      success=random(world)<Math.min(.92,chance);p.outdoor.xp[skill]+=success?8:3;
      if(success){item=task.kind==='hunting'?'rabbit':task.place==='seapier'?'seafish':task.place==='lakepier'?'lakefish':'fish';p.inventory[item]=(p.inventory[item]??0)+1;}
      text=success?`${world.name(who)}在${site.name}${task.kind==='hunting'?'追踪成功，收获':'钓到了'}${items[item!].name}，${spec.skill==='fishing'?'钓鱼':'狩猎'}经验 +8。`:`${world.name(who)}在${site.name}这次${spec.name}没有收获，但学到了一点经验（+3）。`;
    }
    p.outdoor.lastResult={text,at:world.state.clock,success,item};const event=world.event('outdoor',text,[who],['public'],'世界规则');
    if(who!=='player'){const a=world.actor(who);a.activity=task.kind==='rest'?'精神恢复了':`完成${spec.name}`;a.nextDecision=world.state.clock;a.decisionReason='户外活动完成';completedAction(a,world.state.clock);a.socialCooldown.outdoor=world.state.clock+180;world.memory(a,text,event.id,true);}
    for(const a of world.state.actors.filter(a=>a.id!==who&&a.life.status==='alive'&&!a.life.custody&&distance(a,p)<7)){
      world.memory(a,`在现场看到：${text}`,event.id);
      if(spec.skill==='fitness'){world.relationship(a,who,{familiarity:1,affection:1});}
    }
    world.persist();
  }
}
