import { randomUUID } from '../engine/crypto';
import { dayOf, freeAdult, relation, type Actor, type Decision } from '../shared/types';
import { distance, location, pathfind } from '../shared/map';
import type { World } from './world';
import { newResident } from './population';
export const societyRules={birthChance:.20,birthDelay:2*1440,maxChildren:2,populationCap:48,sentenceDays:5};
export function random(w:World){w.state.rng=((w.state.rng??81927)*1664525+1013904223)>>>0;return w.state.rng/4294967296;}
export function canMarry(a:Actor,b:Actor){return a.id!==b.id&&freeAdult(a)&&freeAdult(b)&&a.partner===b.id&&b.partner===a.id&&!a.life.spouse&&!b.life.spouse&&[a.relations[b.id],b.relations[a.id]].every(r=>r&&r.affection>=65&&r.trust>=60&&r.attraction>=35&&r.resentment<25);}
export function canHaveChild(w:World,a:Actor,b:Actor){return freeAdult(a)&&freeAdult(b)&&a.life.spouse===b.id&&b.life.spouse===a.id&&a.life.children.length<societyRules.maxChildren&&b.life.children.length<societyRules.maxChildren&&w.state.actors.length+w.state.society.births.length<societyRules.populationCap&&!w.state.society.births.some(p=>p.parents.includes(a.id)||p.parents.includes(b.id))&&[a.relations[b.id],b.relations[a.id]].every(r=>r.trust>=55&&r.resentment<30);}
export type FamilyDecision={other:string;otherRevision:number;type:'marriage'|'family';accepted:boolean;decisions:Decision[]};
export async function considerFamily(w:World,a:Actor,b:Actor,type:'marriage'|'family'):Promise<FamilyDecision>{
 const data:FamilyDecision={other:b.id,otherRevision:b.revision,type,accepted:true,decisions:[]};
 for(const [self,other]of [[a,b],[b,a]]){
  if(!w.state.status.startsWith('running')||!freeAdult(self)||!freeAdult(other)){data.accepted=false;break;}
  const result=await w.evaluate(self,{...w.privateContext(self),proposal:{type,from:other.name}}, {action:{type:'choice',instructions:type==='marriage'?'独立决定是否愿意与现有恋人结婚，可以拒绝或等待。':'独立决定是否愿意与配偶共同抚养一个孩子，可以拒绝或等待。',criteria:{accept:'我自愿同意',wait:'目前还没准备好',decline:'我不愿意'}}},type,'accept');
  data.decisions.push(w.decideRecord(self,result,result.answers.action.choice??'wait',type==='marriage'?'婚姻意愿':'共同育儿意愿'));
  if(result.answers.action.choice!=='accept'||(result.answers.action.confidence??0)<.5){data.accepted=false;break;}
 }
 return data;
}
export function commitFamily(w:World,a:Actor,d:FamilyDecision){
 if(!w.state.status.startsWith('running'))return;
 const b=w.actor(d.other);if(b.revision!==d.otherRevision||!freeAdult(a)||!freeAdult(b))return;
 d.decisions.forEach(decision=>w.record(decision));
 if(!d.accepted){const e=w.event('relationship',`${a.name}和${b.name}决定暂缓${d.type==='marriage'?'婚姻':'育儿'}计划。`,[a.id,b.id],[a.id,b.id]);for(const p of [a,b])w.memory(p,e.text,e.id,true);return;}
 if(d.type==='marriage'){
  if(!canMarry(a,b)||distance(a,b)>6)return;
  a.life.spouse=b.id;b.life.spouse=a.id;a.life.marriedAt=b.life.marriedAt=w.state.clock;
  a.revision++;b.revision++;const e=w.event('marriage',`${a.name}与${b.name}在双方同意后结为伴侣，向小镇公布了婚讯。`,[a.id,b.id],['public'],'双方独立意愿');
  for(const p of [a,b]){w.memory(p,e.text,e.id,true,'commitment');p.mood='幸福';}
 }else if(canHaveChild(w,a,b)){
  w.state.society.births.push({id:randomUUID(),parents:[a.id,b.id],dueAt:w.state.clock+societyRules.birthDelay});
  const e=w.event('family',`${a.name}与${b.name}共同决定迎接孩子，预计两天后加入家庭。`,[a.id,b.id],['public'],'抽象家庭模拟');
  for(const p of [a,b])w.memory(p,e.text,e.id,true,'commitment');
 }
 w.persist();
}
function stopActor(w:World,a:Actor){
 if(a.conversation)w.endConversation(a.conversation);w.cancelOutdoor(a.id);a.path=[];a.target=null;a.localTask=null;a.revision++;
 w.state.pending=w.state.pending.filter(p=>p.actorId!==a.id);w.state.speechQueue=w.state.speechQueue.filter(p=>p.speaker!==a.id);
 for(const p of w.state.appointments)if(p.status==='accepted'&&(p.from===a.id||p.to===a.id))p.status='declined';
}
export function canMurder(w:World,a:Actor,b:Actor){return a.id!==b.id&&freeAdult(a)&&freeAdult(b)&&a.life.aggressive&&(a.relations[b.id]?.resentment??0)>=85&&distance(a,b)<=5&&w.state.society.lastMurderDay<dayOf(w.state.clock)&&w.state.actors.filter(freeAdult).length>12;}
export function commitMurder(w:World,a:Actor,b:Actor){
 if(!w.state.status.startsWith('running')||!canMurder(w,a,b))return false;
 const witnesses=w.state.actors.filter(p=>p.id!==a.id&&p.id!==b.id&&freeAdult(p)&&distance(p,b)<9);
 stopActor(w,b);b.life.status='dead';b.life.diedAt=w.state.clock;b.activity='已故 · 留存档案';b.mood='—';b.energy=0;
 if(b.partner){const partner=w.state.actors.find(p=>p.id===b.partner);if(partner){partner.partner=null;partner.revision++;partner.mood='悲伤';}b.partner=null;}
 w.state.reflectionQueue=w.state.reflectionQueue.filter(p=>p.actorId!==b.id);
 const c={id:randomUUID(),victim:b.id,perpetrator:a.id,at:w.state.clock,position:{x:b.x,y:b.y},status:'investigating' as const,evidence:[{kind:'现场记录',at:w.state.clock},...witnesses.map(p=>({kind:'目击证词',witness:p.id,at:w.state.clock}))],nextInvestigation:w.state.clock+180,sentenceAt:null,releaseAt:null};
 w.state.society.cases.push(c);w.state.society.lastMurderDay=dayOf(w.state.clock);
 const e=w.event('murder',`${b.name}在一起凶案中离世，司法所已经立案调查。`,[b.id],['public'],'剧情事件 · 无血腥表现');
 w.memory(a,`我导致${b.name}死亡，案件正在调查。`,e.id,true);a.mood='不安';a.socialCooldown.crime=w.state.clock+1440;
 for(const p of w.state.actors.filter(p=>p.life.status==='alive')){w.memory(p,e.text,e.id,true,'belief');if(witnesses.includes(p))w.memory(p,`亲眼目击${a.name}与${b.name}的致命冲突，已提供证词。`,c.id,true);}
 w.persist();return true;
}
export function advanceSociety(w:World){
 if(!w.state.status.startsWith('running'))return;
 const now=w.state.clock,s=w.state.society;
 for(const birth of [...s.births])if(now>=birth.dueAt){
  const parents=birth.parents.map(id=>w.actor(id));s.births=s.births.filter(b=>b.id!==birth.id);
  if(parents.some(p=>!freeAdult(p))||parents[0].life.spouse!==parents[1].id||parents[1].life.spouse!==parents[0].id){const e=w.event('family','家庭照护条件发生变化，原定迎接孩子的计划已取消。',birth.parents,birth.parents);parents.filter(p=>p.life.status==='alive').forEach(p=>w.memory(p,e.text,e.id,true));continue;}
  if(w.state.actors.length>=societyRules.populationCap)continue;
  const n=s.nextChild++,id=`child-${n}-${birth.id.slice(0,8)}`,child=newResident(id,`${parents[0].name.slice(0,1)}${['星芽','小满','知夏','初晴','云朵','安禾'][n%6]}${n>6?n:''}`,'幼年居民',0,parents[0].home,n);
  child.life.stage='child';child.life.bornAt=now;child.life.parents=birth.parents;child.persona='好奇、依恋照护者，用简单的话表达需要；不参与成人恋爱、工作和冲突。';child.goal='在家人的照顾下平安长大。';child.plan='休息、与家人玩耍，听故事。';child.activity='依偎在家人身边';child.inventory={};child.coins=0;child.secret={title:'小小的秘密',core:`偷偷把一颗${parents[0].color}的小石头当成守护星，只有自己知道。`,fragments:['有一件小小的宝贝。','睡前想把它放在枕头旁。',`偷偷把一颗${parents[0].color}的小石头当成守护星，只有自己知道。`],disclosed:{}};
  for(const p of w.state.actors){p.relations[id]=relation();child.relations[p.id]=relation();}child.relations.player=relation();
  w.state.actors.push(child);for(const p of parents){p.life.children.push(id);Object.assign(p.relations[id],{affection:90,trust:85});Object.assign(child.relations[p.id],{affection:90,trust:90});}
  const e=w.event('birth',`${parents[0].name}与${parents[1].name}的孩子${child.name}来到溪谷镇。`,[...birth.parents,id],['public'],'家庭规则');for(const p of [...parents,child])w.memory(p,e.text,e.id,true);w.documents.initialize();w.persist();
 }
 for(const c of s.cases){
  if(['investigating','unresolved'].includes(c.status)&&now>=c.nextInvestigation){
   c.nextInvestigation=now+1440;
   // Corroboration comes from simulated evidence, never from private memories or an LLM accusation.
   if(!c.evidence.some(e=>e.kind==='交叉核实的现场物证')&&random(w)<.65)c.evidence.push({kind:'交叉核实的现场物证',at:now});
   const accused=w.actor(c.perpetrator);
   if(c.evidence.length>=2&&freeAdult(accused)){
    stopActor(w,accused);c.status='sentenced';c.sentenceAt=now;c.releaseAt=now+societyRules.sentenceDays*1440;accused.life.custody={caseId:c.id,releaseAt:c.releaseAt};Object.assign(accused,{x:155,y:99});accused.activity='入监登记';
    const e=w.event('justice',`案件证据已交叉核实，${accused.name}因${w.name(c.victim)}遇害案被判处 ${societyRules.sentenceDays} 个游戏日监禁。`,[accused.id,c.victim],['public'],'抽象司法规则');for(const p of w.state.actors.filter(p=>p.life.status==='alive'))w.memory(p,e.text,e.id,true,'belief');
   }else if(c.status==='investigating'){c.status='unresolved';w.event('justice',`${w.name(c.victim)}遇害案证据尚不足，调查继续，暂不拘押。`,[c.victim],['public']);}
  }
  if(c.status==='sentenced'&&c.releaseAt!==null&&now>=c.releaseAt){const a=w.actor(c.perpetrator);if(a.life.custody?.caseId===c.id){a.life.custody=null;a.path=[];a.target=null;a.localTask=null;a.revision++;Object.assign(a,location('prison').door);a.activity='刑满离开司法所';a.nextDecision=now+30;const e=w.event('release',`${a.name}服刑期满，开始重新融入小镇。`,[a.id],['public']);w.memory(a,e.text,e.id,true);}c.status='released';}
 }
 if(now<s.nextPulse)return;s.nextPulse=now+60;
 for(const a of w.state.actors){
  if(a.life.status==='dead')continue;
  if(a.life.custody){const hour=now%1440/60,place=hour<7||hour>=21?{x:153,y:97}:hour<9||hour>=18?{x:162,y:99}:{x:157,y:103};a.path=pathfind(a,place);a.target=null;a.activity=hour<7||hour>=21?'监室休息':hour<9||hour>=18?'监内用餐':'院内放风与阅读';a.energy=Math.min(100,a.energy+8);continue;}
  if(a.life.stage==='child'){
   const guardian=a.life.parents.map(id=>w.actor(id)).find(freeAdult)??w.state.actors.find(p=>p.id==='teacher'&&freeAdult(p))??w.state.actors.find(freeAdult);
   const p=guardian??location('school').door;a.path=pathfind(a,{x:Math.round(p.x),y:Math.round(p.y)+1});a.activity=now%1440<420||now%1440>=1200?'在照护者身边休息':'与照护者散步、听故事';continue;
  }
 }
}
