import { planning, replanEligibility } from './planning';
import type { Actor, WorldState } from '../shared/types';
import { dayOf, timeOf } from '../shared/types';
import { environmentContext } from '../shared/weather';
import { regionAt } from '../shared/map';

export const realtimeLimits={action:12,dialogue:3,background:4};
// Full memories remain in SQLite / Markdown. Only the fast call's working set is bounded.
export function fastContext(state:WorldState,a:Actor,targets:string[]=[]){
 const relevant=new Set(targets);
 return {
  decision:{trigger:a.decisionReason??'当前行动完成或等待到期',planningInProgress:!!planning(a,state.clock).request,canReplan:replanEligibility(a,state.clock).allowed,issues:planning(a,state.clock).issues.slice(-3).map(i=>({code:i.code,detail:i.detail.slice(0,100)}))},
  identity:{name:a.name,role:a.role,persona:a.persona.slice(0,600),goal:a.goal.slice(0,240)},
  clock:{day:dayOf(state.clock),time:timeOf(state.clock)},plan:a.plan.slice(0,320),
  environment:environmentContext(state.weather,state.clock),region:regionAt(a.x,a.y).name,
  needs:{energy:Math.round(a.energy),mood:a.mood},family:{spouse:a.life.spouse,children:a.life.children,parents:a.life.parents},
  ownMotivation:a.secret.core.slice(0,240),
  longTermNotes:(a.longTermNotes??'').slice(0,800),dailyNotes:a.dailyNotes?.day===dayOf(state.clock)?a.dailyNotes.text.slice(0,800):'',
  importantMemories:a.memories.filter(m=>m.important&&m.kind!=='editor').slice(-4).map(m=>({text:m.text.slice(0,240),kind:m.kind})),
  recentMemories:a.memories.filter(m=>m.day===dayOf(state.clock)&&m.kind!=='editor').slice(-4).map(m=>({text:m.text.slice(0,240),kind:m.kind})),
  ownRelations:Object.fromEntries(Object.entries(a.relations).filter(([id])=>relevant.has(id))),
  inventory:Object.fromEntries(Object.entries(a.inventory).filter(([,count])=>count>0)),
 };
}
