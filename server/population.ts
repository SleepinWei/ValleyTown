import { freshLife, relation, type Actor, type WorldState } from '../shared/types';
import { emptyOutdoor } from '../shared/outdoors';
import { location } from '../shared/map';

// Each arrival has an individual private history; none of these secrets is public context.
const arrivals = [
 ['doctor','苏眠','医生',32,'clinic','沉稳，珍惜坦诚','开设社区诊室','曾在一次救治中犹豫，至今偷偷资助病人家属。'],
 ['teacher','程书','教师',30,'school','耐心，重视边界','为小镇孩子开办自然课堂','曾放弃一份名校聘书，家人一直以为自己被辞退。'],
 ['ranger','唐野','护林员',33,'ranger','谨慎，爱护自然','记录林区动物足迹','私下收养了违反迁移规定留下的受伤鹿。'],
 ['guard','罗宁','警务员',35,'prison','公正，讲究证据','维护秩序并帮助服刑者回归生活','曾替亲人隐瞒一次逃票，一直担心自己的原则不够坚定。'],
 ['musician','叶弦','乐师',26,'inn','浪漫，善于倾听','筹备广场音乐会','一首代表作其实源于母亲未公开的旋律。'],
 ['potter','陶溪','陶艺师',28,'cottages','慢热，重视承诺','建立共享陶坊','曾偷偷卖掉师父赠送的陶碗来支付房租。'],
 ['farmer','麦秋','农夫',29,'garden','爽朗，有些固执','建立居民互助菜园','丰收那年借用过邻居的灌溉水却没有告知。'],
 ['chef','季舟','厨师',31,'inn','热情，珍惜家庭','开设周末共享厨房','正在学习识字，菜单一直靠朋友帮忙。'],
 ['miner','石川','矿工',34,'mountaincamp','急躁，记仇，也渴望被尊重','追回被拖欠的矿石货款','藏着一张自己签字却不敢公开的旧矿场事故记录。'],
 ['broker','裴衡','收购商',36,'market','强势，善于谈判，容易被冒犯','赢得新的矿石运输合同','曾借别人的名字取得第一笔启动资金。'],
 ['sailor','海生','船员',28,'lighthouse','豪爽，冲动，讨厌欺骗','修复旧船重新出海','留下了伙伴寄来的信，却一直没有勇气回复。'],
 ['tailor','锦枝','裁缝',27,'cottages','温柔，独立，有审美','设计集市礼服','想离开家族生意，偷偷积攒了三年学费。'],
 ['athlete','齐跃','运动教练',25,'sports','积极，公平，珍惜伙伴','组织镇民篮球联赛','旧伤仍然疼痛，怕大家不再需要自己。'],
 ['botanist','岑苒','植物学者',29,'lakecamp','好奇，严谨，愿意照料他人','完成镜湖植物图鉴','论文里一条重要记录来自一位未署名的老人。'],
 ['reporter','闻夏','记者',30,'library','敏锐，重视核实，尊重隐私','记录镇民口述历史','曾刊出一条未核实的报道，正在寻找受影响的人道歉。'],
 ['clockmaker','时安','钟表匠',38,'workshop','安静，守时，重视公正','修好广场的旧钟','保存着一封失去的朋友最后寄来的求助信。'],
] as const;
export function newResident(id:string,name:string,role:string,age:number,home:string,index:number):Actor {
 const door=location(home).door;
 return {id,name,role,age,home,x:door.x+(index%3)-1,y:door.y+1+Math.floor(index%4/2),color:['#788d97','#b18385','#afa26a','#798b72','#aa8066','#9685a0'][index%6],hair:['#564337','#3e3936','#71513d'][index%3],skin:'#e9ba8d',life:freshLife(),outdoor:emptyOutdoor(),persona:'有自己的节奏，重视真诚与边界。',goal:'在小镇建立自己的生活。',plan:'先完成手头的工作，再与邻居交流。',activity:'熟悉小镇',energy:90,mood:'期待',actionUntil:0,nextDecision:0,nextPlan:0,revision:1,target:null,path:[],conversation:null,busy:false,inventory:{bread:2,flowers:2,note:2,rod:1,bait:8,bow:role==='护林员'?1:0,arrows:6},coins:35,relations:{},memories:[],secret:{title:'心底的秘密',core:'独自收藏着一件有特别意义的小物件，不愿别人拿走。',fragments:['有一件很珍惜的小东西。','它与一段不愿公开的往事有关。','独自收藏着一件有特别意义的小物件，不愿别人拿走。'],disclosed:{}},knowledge:[],partner:null,trustedEvents:{},giftCounts:{},socialCooldown:{}};
}
export function expandPopulation(w:WorldState){
 const added=new Set<string>();
 for(const [i,s]of arrivals.entries()){
  if(w.actors.some(a=>a.id===s[0]))continue;
  const a=newResident(s[0],s[1],s[2],s[3],s[4],i);a.persona=s[5];a.goal=s[6];a.secret={title:'心底的秘密',core:s[7],fragments:['过去有一件很在意的事情。',`对${s[2]}这份工作，有不愿轻易说出的回忆。`,s[7]],disclosed:{}};a.life.aggressive=['miner','broker','sailor'].includes(a.id);a.nextDecision=w.clock+i*2;a.nextPlan=w.clock+i*4;w.actors.push(a);added.add(a.id);
 }
 for(const a of w.actors){a.life??=freshLife();for(const id of [...w.actors.map(b=>b.id),'player'])if(id!==a.id)a.relations[id]??=relation();}
 // New arrivals carry established relationships, without rewriting saved residents' histories.
 for(const [aId,bId]of [['doctor','teacher'],['musician','potter'],['farmer','chef']] as const){
  if(!added.has(aId)||!added.has(bId))continue;
  const a=w.actors.find(a=>a.id===aId)!,b=w.actors.find(a=>a.id===bId)!;a.partner=b.id;b.partner=a.id;
  for(const [from,to]of [[a,b],[b,a]]){Object.assign(from.relations[to.id],{affection:82,trust:80,attraction:70,familiarity:85});from.memories.push({id:`arrival-${from.id}`,day:Math.floor(w.clock/1440)+1,minute:w.clock,text:`我与${to.name}已交往一段时间，愿意认真考虑共同生活，但未来仍需双方同意。`,source:'居民背景',kind:'experience',important:true});}
 }
 if(added.has('miner')&&added.has('broker'))for(const [aId,bId]of [['miner','broker'],['broker','miner']]){const a=w.actors.find(a=>a.id===aId)!;Object.assign(a.relations[bId],{affection:-65,trust:8,resentment:88,familiarity:75});a.memories.push({id:`dispute-${aId}`,day:Math.floor(w.clock/1440)+1,minute:w.clock,text:'矿石货款纠纷尚未解决，我很生气，也可以选择调解或离开。',source:'居民背景',kind:'experience',important:true});}
}
