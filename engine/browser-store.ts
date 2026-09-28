import { budgetProviders, type BudgetLimits, type BudgetProvider } from '../shared/budget';
import type { WorldState, TownEvent, Usage, CallRecord, DocumentView } from '../shared/types';
import type { ActionTrace, LabRun } from '../shared/telemetry';
import { dayOf } from '../shared/types';
import { MONEY_SCALE, DEFAULT_LIMITS, costNano, pricing, validateLimit, type CallPricing } from '../server/pricing';
import { BudgetError, type WorldStore, type DocumentChanged, type ModelTransport } from './ports';
import { ModelGateway } from './model-gateway';
import { randomUUID } from './crypto';

export interface BrowserCall extends CallRecord {cost_nano:number;reserved_nano:number;cached_input:number;pricing:CallPricing;legacy_cost?:number}
export interface TownData {
  format: 'valleytown-browser'; version: 1; world: WorldState|null;
  events: Record<string,TownEvent>; calls: Record<string,BrowserCall>;
  saves: {id:string;label:string;created:number;world:WorldState}[];
  documents: Record<string,DocumentView>; summaries: Record<string,any>;
  traces: Record<string,ActionTrace>; labs: Record<string,LabRun>;
  limits: BudgetLimits; usdCny: number;
}
export const emptyTownData = ():TownData => ({format:'valleytown-browser',version:1,world:null,events:{},calls:{},saves:[],documents:{},summaries:{},traces:{},labs:{},limits:{...DEFAULT_LIMITS},usdCny:7});
export function validateTownData(value:unknown):TownData {
  const d=value as TownData;
  if(!d||d.format!=='valleytown-browser'||d.version!==1||!Array.isArray(d.saves)||!d.limits||!Number.isFinite(d.usdCny)||d.usdCny<=0||d.usdCny>100)throw new Error('不是有效的溪谷镇浏览器存档');
  for(const key of ['events','calls','documents','summaries','traces','labs'] as const)if(!d[key]||typeof d[key]!=='object'||Array.isArray(d[key]))throw new Error('存档缺少记录：'+key);
  for(const provider of budgetProviders)validateLimit(d.limits[provider]);
  const count=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
  for(const [id,c] of Object.entries(d.calls)) {
    if(!c||c.id!==id||!budgetProviders.includes(c.provider as BudgetProvider)||!['pending','unknown','complete','failed'].includes(c.status)||typeof c.purpose!=='string'||typeof c.model!=='string'||![c.input,c.output,c.reserved,c.created,c.cost_nano,c.reserved_nano,c.cached_input].every(count)||c.cached_input>c.input||!Number.isFinite(c.latency)||c.latency<0)throw new Error('存档费用记录无效');
    if(!c.pricing||typeof c.pricing.version!=='string'||![c.pricing.input,c.pricing.cachedInput,c.pricing.output].every(n=>Number.isFinite(n)&&n>=0))throw new Error('存档计费单价无效');
  }
  for(const [id,row] of Object.entries(d.documents))if(!row||row.id!==id||typeof row.actorId!=='string'||typeof row.text!=='string'||!count(row.revision)||row.revision<1)throw new Error('存档文档记录无效');
  for(const save of d.saves)if(!save||typeof save.id!=='string'||typeof save.label!=='string'||!count(save.created)||!save.world)throw new Error('手动存档记录无效');
  for(const w of [d.world,...d.saves.map(s=>s.world)]) {
    if(!w)continue;
    if(![1,2,3].includes(w.version)||typeof w.id!=='string'||!Number.isFinite(w.clock)||w.clock<0||!Number.isFinite(w.dayMinutes)||w.dayMinutes<5||w.dayMinutes>120||!['live','demo'].includes(w.mode))throw new Error('存档世界参数无效');
    for(const key of ['actors','events','conversations','appointments','quests','decisions','pending','speechQueue','reflectionQueue'] as const)if(!Array.isArray(w[key]))throw new Error('存档世界记录不完整');
    if(w.actors.length<1||w.actors.length>100||!w.player||!w.society)throw new Error('存档居民记录不完整');
    for(const a of w.actors)if(typeof a.id!=='string'||typeof a.name!=='string'||!Array.isArray(a.memories)||!a.secret||!a.life||!a.outdoor||!Array.isArray(a.path)||!Number.isFinite(a.x)||!Number.isFinite(a.y))throw new Error('存档居民数据无效');
  }
  return structuredClone(d);
}

// The engine remains synchronous. IndexedDB commits the complete envelope atomically outside the tick.
export class BrowserStore implements WorldStore {
  readonly reflectionEnabled=false;
  onDirty=()=>{};
  private cache?:Usage;
  constructor(public data:TownData=emptyTownData(),private transport:ModelTransport={config:()=>({}),send:async()=>{throw new Error('请先登录并配置云端模型');}}) {
    for(const c of Object.values(data.calls))if(c.status==='pending'){c.status='unknown';c.error='页面关闭前的请求尚未确认用量';}
  }
  private changed(){this.cache=undefined;this.onDirty();}
  createGateway(canRun:()=>boolean,onBudget:()=>void){return new ModelGateway(this,canRun,onBudget,this.transport);}
  createDocuments(world:()=>WorldState,changed:DocumentChanged){return new BrowserDocuments(this,world,changed);}
  load(){return this.data.world?structuredClone(this.data.world):null;}
  save(world:WorldState){this.data.world=structuredClone(world);for(const e of world.events)this.data.events[e.id]=structuredClone(e);this.changed();}
  recordEvent(e:TownEvent){this.data.events[e.id]=structuredClone(e);this.changed();}
  eventsByIds(ids:string[]){return ids.flatMap(id=>this.data.events[id]?[structuredClone(this.data.events[id])]:[]);}
  storySummary(key:string){return this.data.summaries[key]?structuredClone(this.data.summaries[key]):null;}
  saveStorySummary(key:string,value:unknown){this.data.summaries[key]=structuredClone(value);this.changed();}
  putTrace(trace:ActionTrace){this.data.traces[trace.id]=structuredClone(trace);const rows=this.traces(2001);if(rows.length>2000)delete this.data.traces[rows.at(-1)!.id];this.changed();}
  traces(limit=120){return Object.values(this.data.traces).sort((a,b)=>b.queuedAt-a.queuedAt).slice(0,limit).map(x=>structuredClone(x));}
  putLab(run:LabRun){this.data.labs[run.id]=structuredClone(run);this.changed();}
  labs(limit=5){return Object.values(this.data.labs).sort((a,b)=>b.created-a.created).slice(0,limit).map(x=>structuredClone(x));}
  archive(world:WorldState,label:string){const id=randomUUID();this.data.saves.unshift({id,label,created:Date.now(),world:structuredClone(world)});this.data.saves=this.data.saves.slice(0,30);this.changed();return id;}
  saves(){return this.data.saves.map(({id,label,created})=>({id,label,created}));}
  restore(id:string){const row=this.data.saves.find(s=>s.id===id);if(!row)throw new Error('存档不存在');return structuredClone(row.world);}
  get usdCny(){return this.data.usdCny;}
  setExchange(value:number){if(!Number.isFinite(value)||value<=0||value>100)throw new Error('请输入有效的美元兑人民币汇率（0–100）');this.data.usdCny=value;this.changed();}
  setLimit(provider:BudgetProvider,value:number){if(!budgetProviders.includes(provider))throw new Error('未知模型供应商');validateLimit(value);this.data.limits[provider]=value;this.changed();}
  exhaustedProvider(providers:readonly BudgetProvider[]=budgetProviders){const u=this.usage();return providers.find(p=>u.pools[p].remainingCny<=0);}
  reserve(provider:BudgetProvider,purpose:string,model:string,input:number,output=0){
    if(!budgetProviders.includes(provider)||![input,output].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('无效的预留用量');
    const rate=pricing(provider,this.usdCny),amount=costNano(rate,input,output),remaining=this.usage().pools[provider].remainingCny*MONEY_SCALE;
    if(remaining<=0||amount>Math.round(remaining))throw new BudgetError(provider);
    const id=randomUUID();this.data.calls[id]={id,provider,purpose,model,input:0,output:0,reserved:input+output,status:'pending',created:Date.now(),latency:0,error:null,cost_nano:0,reserved_nano:amount,cached_input:0,pricing:rate};this.changed();return id;
  }
  settle(id:string,input:number,output:number,latency:number,model?:string,cachedInput=0){
    if(![input,output,cachedInput].every(n=>Number.isSafeInteger(n)&&n>=0)||cachedInput>input)throw new Error('接口未返回有效用量');
    const c=this.data.calls[id];if(!c)throw new Error('调用记录不存在');if(!['pending','unknown'].includes(c.status))return;
    Object.assign(c,{input,output,latency,model:model??c.model,cached_input:cachedInput,cost_nano:costNano(c.pricing,input,output,cachedInput),reserved:0,reserved_nano:0,status:'complete'});this.changed();
  }
  fail(id:string,error:string,knownNotExecuted:boolean,latency=0){const c=this.data.calls[id];if(!c||c.status!=='pending')return;Object.assign(c,{status:knownNotExecuted?'failed':'unknown',error,latency});if(knownNotExecuted)c.reserved=c.reserved_nano=0;this.changed();}
  call(id:string){return structuredClone(this.data.calls[id]);}
  callSummary(){const result=new Map<string,{purpose:string;calls:number;input:number;output:number}>();for(const c of Object.values(this.data.calls).filter(c=>c.provider==='DeepSeek')){const r=result.get(c.purpose)??{purpose:c.purpose,calls:0,input:0,output:0};r.calls++;r.input+=c.input;r.output+=c.output;result.set(c.purpose,r);}return [...result.values()];}
  usage():Usage {
    if(this.cache)return this.cache;
    const rows=Object.values(this.data.calls),pools={} as Usage['pools'],byProvider:Usage['byProvider']={};
    for(const provider of budgetProviders){const calls=rows.filter(c=>c.provider===provider),spent=calls.reduce((n,c)=>n+c.cost_nano,0),reserved=calls.reduce((n,c)=>n+c.reserved_nano,0);pools[provider]={limitCny:this.data.limits[provider],spentCny:spent/MONEY_SCALE,reservedCny:reserved/MONEY_SCALE,remainingCny:Math.max(0,validateLimit(this.data.limits[provider])-spent-reserved)/MONEY_SCALE,legacyCalls:calls.filter(c=>c.legacy_cost).length};if(calls.length)byProvider[provider]={calls:calls.length,input:calls.reduce((n,c)=>n+c.input,0),output:calls.reduce((n,c)=>n+c.output,0),latency:Math.round(calls.reduce((n,c)=>n+c.latency,0)/calls.length)};}
    const input=rows.reduce((n,c)=>n+c.input,0),output=rows.reduce((n,c)=>n+c.output,0);
    return this.cache={currency:'CNY',pools,byProvider,input,output,used:input+output,calls:rows.length,reserved:rows.reduce((n,c)=>n+c.reserved,0),unknown:rows.filter(c=>c.status==='unknown').length,usdCny:this.usdCny,recent:rows.sort((a,b)=>b.created-a.created).slice(0,12).map(x=>structuredClone(x))};
  }
  documentChanged(){this.changed();}
}
const kinds=['persona','secret','notes','today'] as const;
class BrowserDocuments {
  constructor(private store:BrowserStore,private world:()=>WorldState,private changed:DocumentChanged){this.initialize();}
  private wrap(id:string,revision:number,body:string){return `---\ndocument_id: ${id}\nbase_revision: ${revision}\n---\n${body}\n`;}
  private body(a:WorldState['actors'][number],kind:string){return kind==='persona'?a.persona:kind==='secret'?a.secret.core:kind==='notes'?(a.longTermNotes??'尚无补充长期设定。'):(a.dailyNotes?.day===dayOf(this.world().clock)?a.dailyNotes.text:'尚无当日补充记忆。');}
  initialize(){for(const a of this.world().actors)for(const kind of kinds){const id=`${a.id}:${kind}`;if(!this.store.data.documents[id])this.store.data.documents[id]={id,actorId:a.id,revision:1,text:this.wrap(id,1,this.body(a,kind)),file:`浏览器存档 / ${a.name} / ${kind}.md`};}this.store.documentChanged();}
  restoreFromWorld(){this.initialize();for(const a of this.world().actors)for(const kind of kinds){const row=this.store.data.documents[`${a.id}:${kind}`];row.revision++;row.text=this.wrap(row.id,row.revision,this.body(a,kind));row.imported=new Date().toISOString();}this.store.documentChanged();}
  list(actorId:string){return kinds.map(k=>{const row=this.store.data.documents[`${actorId}:${k}`];if(!row)throw new Error('文档不存在');return structuredClone(row);});}
  errors(){return [] as string[];}
  import(id:string,text:string,expectedRevision:number){
    const [actorId,kind]=id.split(':'),a=this.world().actors.find(a=>a.id===actorId),row=this.store.data.documents[id];
    if(!a||!kinds.includes(kind as any)||!row)throw new Error('未知文档');
    if(text.length>16000)throw new Error('文档最多 16000 个字符');
    if(expectedRevision!==row.revision)throw new Error('版本冲突：先载入最新版本，再合并你的修改');
    const match=text.match(/^---\r?\ndocument_id: ([^\r\n]+)\r?\nbase_revision: (\d+)\r?\n---\r?\n([\s\S]*)$/);
    if(!match||match[1]!==id||Number(match[2])!==expectedRevision)throw new Error('请保留 document_id 与 base_revision 头部，或重新载入文档');
    const body=match[3].trim();if(!body)throw new Error('文档内容不能为空');
    this.changed(a,kind,body);row.revision++;row.text=this.wrap(id,row.revision,body);row.imported=new Date().toISOString();this.store.save(this.world());return this.list(actorId);
  }
  scan(){/* Browser edits are applied immediately; there is no filesystem watcher. */}
  project(){/* Markdown remains available through the editor and story export. */}
}
