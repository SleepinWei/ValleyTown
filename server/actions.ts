import type { World } from './world';
import type { Actor, OutdoorKind } from '../shared/types';
import { clamp, dayOf, freeAdult, relation } from '../shared/types';
import type { ActionCandidate, ActionCategory } from '../shared/actions';
import { distance, items, location, locations } from '../shared/map';
import { outdoorActivities, outdoorInterests } from '../shared/outdoors';
import { outdoorWeatherBlock, weatherInfo } from '../shared/weather';
import { canHaveChild, canMarry, canMurder } from './society';
import { completedAction, planIssue, replanEligibility } from './planning';

export const actionLimit=24;
const near=(a:Actor,place:string,radius=5)=>distance(a,location(place).door)<=radius;
const dayTime=(w:World)=>w.state.clock%1440>=360&&w.state.clock%1440<1200;
type Profession={role:string;label:string;item:string;outdoor?:boolean};
export const professions:Profession[]=[
 {role:'面包师',label:'烘焙面包',item:'bread'},{role:'园丁',label:'照料花圃',item:'flowers',outdoor:true},
 {role:'木匠',label:'加工木料',item:'wood'},{role:'杂货店主',label:'整理种子货架',item:'seeds'},
 {role:'图书管理员',label:'修补与整理图书',item:'book'},{role:'渔夫',label:'整理河岸鱼获',item:'fish',outdoor:true},
 {role:'旅店经营者',label:'准备旅店餐食',item:'soup'},{role:'画师',label:'绘制画稿',item:'paint'},
 {role:'医生',label:'整理诊疗记录与护理用品',item:'note'},{role:'教师',label:'准备自然课堂教案',item:'book'},
 {role:'护林员',label:'记录林地巡护信息',item:'note'},{role:'警务员',label:'整理公开案件记录',item:'note'},
 {role:'乐师',label:'排练集市曲目',item:'note'},{role:'陶艺师',label:'整理陶艺设计稿',item:'note'},
 {role:'农夫',label:'照料互助菜园',item:'flowers',outdoor:true},{role:'厨师',label:'准备共享厨房汤品',item:'soup'},
 {role:'矿工',label:'整理矿场作业记录',item:'note',outdoor:true},{role:'收购商',label:'整理收购合同',item:'note'},
 {role:'船员',label:'检查船具并记录维修事项',item:'note'},{role:'裁缝',label:'绘制集市服装图样',item:'note'},
 {role:'运动教练',label:'整理球队训练计划',item:'note',outdoor:true},{role:'植物学者',label:'记录湿地植物',item:'note',outdoor:true},
 {role:'记者',label:'整理已有采访记录',item:'note'},{role:'钟表匠',label:'检修钟表并记录零件',item:'note'},
];
export const professionFor=(a:Actor)=>professions.find(p=>p.role===a.role);
export function outdoorAvailable(w:World,a:Actor,kind:OutdoorKind){const spec=outdoorActivities[kind];return !outdoorWeatherBlock(w.state.weather,kind)&&a.energy>=Math.ceil(spec.energy*weatherInfo(w.state.weather).effort)&&(!spec.gear||(a.inventory[spec.gear]??0)>0)&&(!spec.consume||(a.inventory[spec.consume]??0)>0)&&(kind!=='hunting'||w.state.clock%1440>=360&&w.state.clock%1440<1140);}
interface Definition {id:string;category:ActionCategory;description:string;expand:(w:World,a:Actor)=>Record<string,ActionCandidate>}
const socialTargets=(w:World,a:Actor)=>w.state.actors.filter(b=>b.id!==a.id&&freeAdult(b)&&!b.busy&&!b.conversation&&!b.outdoor.task&&!b.localTask&&distance(a,b)<=8&&(a.socialCooldown[b.id]??0)<=w.state.clock).sort((l,r)=>distance(a,l)-distance(a,r)).slice(0,3);
export const actionRegistry:Definition[]=[
 {id:'basic',category:'common',description:'等待、休息与前往最近屋檐；始终提供安全选择',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>({rest:{label:'坐下休息、恢复精力（30 游戏分钟）',kind:'rest'},wait:{label:'观察周围，暂时等待（10 游戏分钟）',kind:'wait'},shelter:{label:`到${w.shelter(a).name}屋檐下${['雷雨','细雨'].includes(w.state.weather)?'避雨':'休息'}`,kind:'shelter',target:w.shelter(a).id}})},
 {id:'travel',category:'common',description:'只负责前往目的地；抵达后重新选择当地可行行动',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{
   const candidates:Record<string,ActionCandidate>={};
   const interests=outdoorInterests[a.id]??['jogging','fishing'];
   const preferred=interests.flatMap(kind=>outdoorActivities[kind].places).sort((l,r)=>distance(a,location(l).door)-distance(a,location(r).door)).slice(0,2);
   const errands=[...(a.inventory.rod&&(a.inventory.bait??0)<3||a.inventory.bow&&(a.inventory.arrows??0)<3?['market']:[]),...(a.energy<45?['clinic']:[]),...(dayTime(w)?['library']:[]),...((a.inventory.wood??0)>0&&!w.state.quests.find(q=>q.id==='bridge')?.completed?['bridge']:[])];
   const sites=[a.home,...errands,...preferred,'square','riverside','seapier','mountaincamp','lakecamp','huntingcamp','sports'];
   for(const place of new Set(sites)){if(near(a,place))continue;if(w.state.weather==='雷雨'&&place!==a.home)continue;if(w.state.weather==='大雾'&&['mountaincamp','huntingcamp'].includes(place))continue;
    const key=place==='square'||place==='riverside'?place:`go_${place}`;candidates[key]={label:`前往${location(place).name}，到达后再决定具体行动`,kind:'visit',target:place};}
   return candidates;
 }},
 {id:'profession-work',category:'profession',description:'本职工作：仅白天、在本人工作地点且精力足够时开放',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{
   const p=professionFor(a);return p&&near(a,a.home)&&dayTime(w)&&a.energy>=8&&!(p.outdoor&&w.state.weather==='雷雨')?{work:{label:`在${location(a.home).name}${p.label}（40 游戏分钟）`,kind:'work',item:p.item}}:{};
 }},
 {id:'clinic-care',category:'profession',description:'医生在诊所帮助附近精力不足的成年人，恢复体力',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{
   if(a.role!=='医生'||!near(a,'clinic')||!dayTime(w)||a.energy<8)return {};
   return Object.fromEntries(socialTargets(w,a).filter(b=>b.energy<55&&near(b,'clinic')).map(b=>[`care_${b.id}`,{label:`帮助${b.name}休息恢复体力（不代替疾病诊疗）`,kind:'care',target:b.id}]));
 }},
 {id:'library-read',category:'place',description:'图书馆 06:00–20:00 可阅读；需要到场',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>near(a,'library')&&dayTime(w)?{read:{label:'在图书馆阅读，平复心情（20 游戏分钟）',kind:'read',target:'library'}}:{}},
 {id:'market-buy',category:'place',description:'在杂货铺补给鱼饵或箭矢；检查库存、金币与店主状态',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{
   const merchant=w.state.actors.find(b=>b.id==='merchant');if(a.id==='merchant'||!merchant||!freeAdult(merchant)||!near(a,'market')||!near(merchant,'market')||merchant.busy||merchant.conversation||!dayTime(w))return {};
   const rows:Record<string,ActionCandidate>={};for(const item of ['bait','arrows'])if((a.inventory[item]??0)<3&&(merchant.inventory[item]??0)>0&&a.coins>=items[item].price)rows[`buy_${item}`]={label:`在杂货铺购买一份${items[item].name}（${items[item].price} 金币）`,kind:'buy',target:'market',item};return rows;
 }},
 ...Object.entries(outdoorActivities).filter(([kind])=>kind!=='rest').map(([kind,spec]):Definition=>({id:`outdoor-${kind}`,category:'place',description:`${spec.name}：到达指定地点，且满足天气、装备、耗材、体力及开放时间`,expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{
   if((a.socialCooldown.outdoor??0)>w.state.clock||!outdoorAvailable(w,a,kind as OutdoorKind))return {};
   return Object.fromEntries(spec.places.filter(place=>near(a,place,4)).map(place=>[`${kind}_${place}`,{label:`在${location(place).name}${spec.name}（${spec.duration} 游戏分钟）`,kind:'outdoor',target:place,outdoorKind:kind as OutdoorKind}]));
 }})),
 {id:'town-project',category:'place',description:'在旧桥或广场贡献实际持有的材料',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{
   if(w.state.weather==='雷雨')return {};const rows:Record<string,ActionCandidate>={};
   if(near(a,'bridge')&&(a.inventory.wood??0)>0&&!w.state.quests.find(q=>q.id==='bridge')?.completed)rows.bridge={label:'为旧桥贡献木料',kind:'contribute',target:'bridge'};
   if(near(a,'square')&&!w.state.quests.find(q=>q.id==='festival')?.completed&&((a.inventory.flowers??0)>0||(a.inventory.bread??0)>0))rows.festival={label:'为晚灯集市准备礼物',kind:'contribute',target:'festival'};return rows;
 }},
 {id:'social',category:'situation',description:'附近可用居民的交谈、赠礼、邀约和表白；对方仍可拒绝',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{
   const rows:Record<string,ActionCandidate>={};
   for(const b of socialTargets(w,a)){
     const r=a.relations[b.id]??relation();rows[`talk_${b.id}`]={label:`与附近的${b.name}聊一聊`,kind:'talk',target:b.id};
     if(distance(a,b)>5)continue;
     const gift=Object.keys(a.inventory).find(item=>items[item]&&a.inventory[item]>0);
     if(gift&&r.affection>15&&(b.relations[a.id]?.resentment??0)<60)rows[`gift_${b.id}`]={label:`送给${b.name}一份${items[gift].name}`,kind:'gift',target:b.id,item:gift};
     if(r.resentment>30)rows[`avoid_${b.id}`]={label:`与${b.name}保持距离，去别处冷静`,kind:'avoid',target:b.id};
     if(r.affection>25&&(b.socialCooldown[`invite:${a.id}`]??0)<=w.state.clock)rows[`invite_${b.id}`]={label:`邀请${b.name}明天在河岸散步，对方可以拒绝`,kind:'invite',target:b.id};
     if(r.affection>55&&r.attraction>30&&!a.partner&&!b.partner&&(b.socialCooldown[`confess:${a.id}`]??0)<=w.state.clock)rows[`confess_${b.id}`]={label:`向${b.name}表达爱意，对方可以拒绝`,kind:'confess',target:b.id};
   }return rows;
 }},
 {id:'family',category:'situation',description:'伴侣分别同意后才结婚或计划育儿；远处先见面',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{
   const b=w.state.actors.find(b=>b.id===a.partner);if(!b||!freeAdult(b)||b.busy||b.conversation)return {};
   const key=[a.id,b.id].sort().join(':');if((w.state.society.dailyFamily[key]??-1)>=dayOf(w.state.clock))return {};
   if(canMarry(a,b))return {marriage:{label:`与${b.name}讨论结婚，双方分别同意后才结婚`,kind:'marriage',target:b.id}};
   if(canHaveChild(w,a,b))return {family:{label:`与${b.name}讨论共同养育孩子，双方都可拒绝`,kind:'family',target:b.id}};
   return {};
 }},
 {id:'conflict',category:'situation',description:'已知高怨恨冲突可走近交涉、在场调解；致命冲突须满足原有资格与概率门槛',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{
   const rows:Record<string,ActionCandidate>={};
   for(const b of w.state.actors.filter(b=>b.id!==a.id&&freeAdult(b)&&(a.relations[b.id]?.resentment??0)>=85).slice(0,2)){
    if(distance(a,b)>5)rows[`dispute_${b.id}`]={label:`去找${b.name}讨论未解决的纠纷`,kind:'dispute',target:b.id};
    if(distance(a,b)<=6)rows[`mediate_${b.id}`]={label:`与${b.name}寻求调解，缓和纠纷`,kind:'mediate',target:b.id};
    if(canMurder(w,a,b)&&(a.socialCooldown.crimeOffer??-1)>w.state.clock)rows[`murder_${b.id}`]={label:`与${b.name}的冲突升级为致命事件，会被调查并可能入狱；也可离开或调解`,kind:'murder',target:b.id};
   }return rows;
 }},
 {id:'replan',category:'planning',description:'只在计划遇到新情况时请求 DS；每日最多两次，至少间隔三游戏小时与三十秒',expand:(w:World,a:Actor):Record<string,ActionCandidate>=>{const e=replanEligibility(a,w.state.clock);return e.allowed?{replan:{label:`请求重新规划今天：${e.reason.slice(0,140)}。后台处理，期间仍可行动`,kind:'replan'}}:{};}},
];
export function buildActions(w:World,a:Actor,limit=actionLimit):Record<string,ActionCandidate>{
 if(!freeAdult(a))return {};
 const rows:Record<string,ActionCandidate>={};
 for(const def of actionRegistry)for(const [key,candidate] of Object.entries(def.expand(w,a)))rows[key]={...candidate,definitionId:def.id,category:def.category};
 // Keep safety, local opportunity and replanning before distant travel intents when the set is full.
 const order=(c:ActionCandidate)=>c.kind==='shelter'||c.kind==='rest'||c.kind==='wait'||c.kind==='replan'?0:c.category==='profession'||c.category==='place'?1:c.category==='situation'?2:3;
 return Object.fromEntries(Object.entries(rows).sort(([,a],[,b])=>order(a)-order(b)).slice(0,limit));
}
export function validateAction(w:World,a:Actor,c:ActionCandidate):string|undefined{
 if(!freeAdult(a))return '角色当前不能执行成人行动';
 if(!c.definitionId)return undefined; // Existing saved pending decisions predate the registry; old execution checks still apply.
 const def=actionRegistry.find(d=>d.id===c.definitionId);if(!def)return '动作定义已不存在';
 const candidates=Object.values(def.expand(w,a));
 if(!candidates.some(x=>x.kind===c.kind&&x.target===c.target&&x.item===c.item&&x.outdoorKind===c.outdoorKind))return '位置、身份、开放时间、物品或事件条件已改变';
}
export function beginLocalAction(w:World,a:Actor,c:ActionCandidate){
 const duration=c.kind==='work'?40:c.kind==='read'?20:c.kind==='rest'?30:10;
 a.localTask={candidate:c,startedAt:w.state.clock,endsAt:w.state.clock+duration};a.path=[];a.target=null;a.actionUntil=a.localTask.endsAt;a.nextDecision=a.actionUntil;
 a.activity=c.kind==='work'?`${professionFor(a)?.label??'工作'}中`:c.kind==='read'?'在图书馆阅读':c.kind==='rest'?'坐下来休息':'看看周围';
}
export function advanceLocalActions(w:World){
 for(const a of w.state.actors){const task=a.localTask;if(!task)continue;
   if(!freeAdult(a)||a.conversation){a.localTask=null;continue;}
   const c=task.candidate;
   if(c.kind==='work'&&professionFor(a)?.outdoor&&w.state.weather==='雷雨'){
     a.localTask=null;a.activity='收好工具，准备避雨';a.nextDecision=w.state.clock;planIssue(a,w.state.clock,'weather','雷雨中断露天工作，可改做其他事情');continue;
   }
   if(w.state.clock<task.endsAt)continue;
   a.localTask=null; // Clear before awarding; resumed saves cannot finish the same task twice.
   if((c.kind==='work'&&!near(a,a.home))||(c.kind==='read'&&!near(a,'library'))){a.nextDecision=w.state.clock;continue;}
   let text:string;
   if(c.kind==='work'){const p=professionFor(a);if(!p||p.item!==c.item){a.nextDecision=w.state.clock;continue;}a.inventory[p.item]=(a.inventory[p.item]??0)+1;a.coins+=2;a.energy=clamp(a.energy-6,0,100);text=`${a.name}完成${p.label}，获得${items[p.item].name}。`;}
   else if(c.kind==='read'){a.mood='平静';a.energy=clamp(a.energy+4,0,100);text=`${a.name}在图书馆读了一会儿书，心情平静下来。`;}
   else if(c.kind==='rest'){a.energy=clamp(a.energy+18,0,100);text=`${a.name}休息后恢复了体力。`;}
   else {a.nextDecision=w.state.clock;a.activity='观察结束';continue;}
   a.activity=c.kind==='work'?'整理工作':c.kind==='read'?'合上书，准备离开':'休息结束';a.nextDecision=w.state.clock;a.decisionReason='本地行动完成';completedAction(a,w.state.clock);
   const e=w.event(c.kind==='work'?'work':'activity',text,[a.id],['public'],'本地动作执行');w.memory(a,text,e.id);
 }
}
