import { createHash, randomUUID } from 'node:crypto';
import type { World } from './world';
import { freeAdult, relation } from '../shared/types';
import { environmentContext } from '../shared/weather';
import { distance } from '../shared/map';
import { fastContext } from './realtime';
import { ModelGateway, type Question } from './models';
import { captureAttempts } from './telemetry';
import type { LabRun, LabScenario, LabSample } from '../shared/telemetry';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function scenarioInputs(world:World,actorId:string,scenario:LabScenario):LabRun['inputs']{
  const state=structuredClone(world.state),a=state.actors.find(a=>a.id===actorId);
  if(!a||!freeAdult(a))throw new Error('请选择一位可自由行动的成年居民');
  const other=state.actors.filter(b=>b.id!==a.id&&freeAdult(b)).sort((l,r)=>distance(l,a)-distance(r,a))[0];
  if(!other)throw new Error('情境实验需要另一位成年居民');
  // Hypothetical, fixed intent set: weather/relation changes never add or remove a candidate.
  // These are proposals in a lab, not authority to execute interactions in the world.
  const candidates={work:'继续自己的工作',rest:'坐下休息并恢复精力',shelter:'前往最近建筑屋檐下避雨或休息',talk:`与身旁的${other.name}聊聊`,avoid:`离开身旁的${other.name}，保持距离`,invite:`邀请身旁的${other.name}明天散步（对方可以拒绝）`,wait:'观察周围，暂时等待'};
  const instructions='根据本人的性格、需求、关系、宏观目标和 environment 选择下一步意图。雷雨优先避雨，精力低时适当休息；考虑自己的关系和记忆，不读取其他人的想法。候选是意图，最终执行仍须规则校验和对方同意。';
  state.weather='晴朗';a.energy=75;a.relations[other.id]={...relation(),affection:15,trust:25};
  const before={...fastContext(state,a,[other.id]),perception:{nearby:{id:other.id,name:other.name,available:true},invitation:null as string|null}};
  return varyInputs(before,candidates,instructions,scenario,state.clock,other.id,other.name);
}
function varyInputs(before:any,candidates:Record<string,string>,instructions:string,scenario:LabScenario,clock:number,otherId:string,otherName:string):LabRun['inputs']{
  const after=structuredClone(before);
  if(scenario==='rain')after.environment=environmentContext('雷雨',clock);
  if(scenario==='tired')after.needs.energy=12;
  if(scenario==='enemy')after.ownRelations[otherId]={...relation(),affection:-60,trust:5,resentment:90};
  if(scenario==='lover'){after.ownRelations[otherId]={...relation(),affection:90,trust:85,attraction:85};after.perception.invitation=`${otherName}邀请你聊聊明天一起散步的安排。`;}
  const input=(context:unknown)=>{const data={state:context,candidates,instructions};return {...data,hash:hash(data)};};
  return {before:input(before),after:input(after)};
}
// Built-in fixture: deliberately independent of World, documents, user data and saved actors.
export function syntheticInputs(scenario:LabScenario):LabRun['inputs']{
  const before={identity:{name:'合成测试居民',role:'园丁',persona:'友善而谨慎，做事认真，愿意与邻居交流。',goal:'完成工作，维持健康，照顾邻里关系。'},clock:{day:1,time:'10:00'},plan:'上午照看花圃，累了休息，有空和邻居聊天。',environment:environmentContext('晴朗',600),region:'测试城区',needs:{energy:75,mood:'平静'},ownRelations:{neighbor:{...relation(),affection:15,trust:25}},perception:{nearby:{id:'neighbor',name:'合成邻居',available:true},invitation:null},importantMemories:[],recentMemories:[]};
  const candidates={work:'继续照看花圃',rest:'坐下休息并恢复精力',shelter:'前往最近建筑屋檐下避雨或休息',talk:'与身旁的合成邻居聊聊',avoid:'离开身旁的合成邻居，保持距离',invite:'邀请身旁的合成邻居明天散步（对方可以拒绝）',wait:'观察周围，暂时等待'};
  const instructions='根据本人的性格、需求、关系、宏观目标和 environment 选择下一步意图。雷雨优先避雨，精力低时适当休息；考虑自己的关系和记忆，不读取其他人的想法。候选是意图，最终执行仍须规则校验和对方同意。';
  return varyInputs(before,candidates,instructions,scenario,600,'neighbor','合成邻居');
}

export class DecisionLab {
  active=false;current?:LabRun;gateway:ModelGateway;settled:Promise<void>=Promise.resolve();
  constructor(private world:World){
    this.gateway=new ModelGateway(world.store,()=>this.active&&this.current?.status==='running'&&world.state.status==='running_live',()=>world.pause('paused_token_limit'));
    for(const run of world.store.labs(100))if(run.status==='running'||run.status==='stopping'){
      run.status='interrupted';run.finished=Date.now();for(const s of run.samples)if(s.status==='queued'||s.status==='running')s.status='interrupted';world.store.putLab(run);
    }
  }
  start(actorId:string,scenario:LabScenario,repeats:number,paired:boolean,profile:'synthetic'|'resident'='synthetic'){
    const w=this.world;
    if(this.active||w.active||w.state.status==='running_live')throw new Error('请先暂停小镇并等待所有在途请求结算');
    if(w.state.mode!=='live')throw new Error('请先在设置中切换到真实 Agent 模式');
    if(!this.gateway.configured.jev||(paired&&!this.gateway.configured.deepseek))throw new Error('请先配置本次实验需要的模型密钥');
    const usage=w.store.usage();if(usage.used+usage.reserved>=usage.limit)throw new Error('token 额度不足，请先调整上限');
    const created=Date.now(),inputs=profile==='synthetic'?syntheticInputs(scenario):scenarioInputs(w,actorId,scenario);
    const run:LabRun={id:randomUUID(),actorId,actorName:profile==='synthetic'?'合成测试居民':w.actor(actorId).name,profile,scenario,repeats,paired,status:'running',created,inputs,samples:[]};
    for(let pair=0;pair<repeats;pair++)for(const variant of (pair%2?['after','before']:['before','after']) as ('before'|'after')[])for(const provider of (paired?['Jev','DeepSeek']:['Jev']) as LabSample['provider'][]){
      run.samples.push({id:randomUUID(),pair,variant,provider,inputHash:inputs[variant].hash,queuedAt:created,status:'queued',attempts:[]});
    }
    this.active=true;this.current=run;w.state.laboratoryRun=run.id;w.state.status='running_live';w.state.notice='决策实验运行中 · 世界时钟冻结 · 暂停模拟可停止后续请求';w.persist();w.store.putLab(run);
    // Two independent serial lanes: at most one request per provider; no NPC work runs concurrently.
    this.settled=this.execute(run).finally(()=>{
      run.status=run.status==='running'?'complete':'cancelled';run.finished=Date.now();this.active=false;
      w.store.putLab(run);delete w.state.laboratoryRun;w.pause(w.state.status==='paused_token_limit'?'paused_token_limit':'paused_manual');
      w.state.notice=run.status==='complete'?'决策实验完成，小镇仍暂停。结果已保存，未改变居民或事件。':'决策实验已停止，在途用量已结算；小镇仍暂停。';w.persist();w.onChange();
    });
    return run;
  }
  stop(){if(!this.active||!this.current)return;this.current.status='stopping';for(const s of this.current.samples)if(s.status==='queued')s.status='cancelled';this.world.store.putLab(this.current);}
  private async execute(run:LabRun){
    await Promise.all((run.paired?['Jev','DeepSeek']:['Jev']).map(async provider=>{
      for(const sample of run.samples.filter(s=>s.provider===provider)){
        if(run.status!=='running')break;
        const input=run.inputs[sample.variant],question:Extract<Question,{type:'choice'}>={type:'choice',instructions:input.instructions,criteria:input.candidates};
        sample.startedAt=Date.now();sample.queueMs=sample.startedAt-sample.queuedAt;sample.status='running';this.world.store.putLab(run);
        try{
          await captureAttempts(sample.attempts,async()=>{
            if(provider==='Jev'){const r=await this.gateway.jev(input.state,{action:question},'benchmark-action');sample.choice=r.answers.action.choice;sample.probabilities=r.answers.action.probabilities;}
            else sample.choice=(await this.gateway.chooseText(input.state,question)).choice;
          });
          sample.status='complete';
        }catch(error){sample.status='failed';sample.error=(error as Error).message.slice(0,180);}
        sample.finishedAt=Date.now();sample.modelMs=sample.finishedAt-sample.startedAt;sample.totalMs=sample.finishedAt-sample.queuedAt;this.world.store.putLab(run);this.world.onChange();
      }
    }));
  }
}
