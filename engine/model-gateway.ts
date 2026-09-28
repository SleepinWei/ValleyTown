import type { BudgetProvider } from '../shared/budget';
import { BudgetError, type Ledger, type ModelTransport } from './ports';
import type { CallRecord } from '../shared/types';

export type Question = {type:'choice';instructions:string;criteria:Record<string,string>}|{type:'score';instructions:string;criteria:string[]}|{type:'noul';instructions:string};
export interface Answer {type:string;choice?:string;score?:number;noul?:number;confidence?:number;probabilities?:Record<string,number>}
export interface JevResult {answers:Record<string,Answer>;model:string;input:number;output:number;latency:number}
export const estimateTokens=(value:unknown)=>{const s=typeof value==='string'?value:JSON.stringify(value);const wide=(s.match(/[^\x00-\x7F]/g)||[]).length;return Math.ceil((s.length-wide)/3+wide*1.5)+256;};
export class ModelGateway {
  get configured(){const c=this.transport.config();return {jev:!!c.jevKey,deepseek:!!c.deepseekKey};}
  constructor(public store:Ledger,public canRun:()=>boolean,public onBudget:()=>void,private transport:ModelTransport){}
  private async post(provider:BudgetProvider,purpose:string,model:string,url:string,key:string|undefined,body:unknown,reservation:{input:number;output:number},attempts?:CallRecord[]):Promise<{data:any;latency:number}> {
    for(let attempt=0;;attempt++){
      try{return await this.postOnce(provider,purpose,model,url,key,body,reservation,attempt>0,attempts);}
      catch(error){const e=error as Error;const transient=e.message==='fetch failed'||e.message.startsWith('模型网络请求未完成')||/HTTP (429|5\d\d)/.test(e.message);if(attempt>=1||!transient||!this.canRun())throw error;await new Promise(resolve=>setTimeout(resolve,1000));}
    }
  }
  private async postOnce(provider:BudgetProvider,purpose:string,model:string,url:string,key:string|undefined,body:unknown,reservation:{input:number;output:number},nativeFallback=false,attempts?:CallRecord[]):Promise<{data:any;latency:number}> {
    if(!this.canRun())throw new Error('模拟已暂停');
    if(!key)throw new Error(`${provider} 尚未配置 API 密钥`);
    let id:string;
    try{id=this.store.reserve(provider,purpose,model,reservation.input,reservation.output);}catch(e){if(e instanceof BudgetError)this.onBudget();throw e;}
    const start=Date.now();
    try {
      const response=await this.transport.send(provider,url,key,body,nativeFallback);
      if(!response.ok){const safe=`${provider} HTTP ${response.status}${response.status===429?'，请稍后重试':''}`;this.store.fail(id,safe,[400,401,403,404,422,429].includes(response.status),Date.now()-start);throw new Error(safe);}
      const data:any=await response.json();
      const usage=data.usage;
      const input=provider==='Jev'?usage?.input_tokens:usage?.prompt_tokens;
      const output=provider==='Jev'?usage?.output_tokens:usage?.completion_tokens;
      this.store.settle(id,input,output,Date.now()-start,data.model,provider==='DeepSeek'?(usage?.prompt_cache_hit_tokens??usage?.prompt_tokens_details?.cached_tokens??0):0);
      if(this.store.exhaustedProvider([provider]))this.onBudget();
      return {data,latency:Date.now()-start};
    }catch(e){
      const cause=(e as Error).cause as {code?:string;message?:string;preflight?:boolean}|undefined;
      const preflight=!!cause&&(cause.preflight===true||['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT'].includes(cause.code??'')||cause.message?.includes('before secure TLS connection was established')===true);
      this.store.fail(id,preflight?'连接建立失败，请求尚未发出':'调用未完成；用量待核对',preflight,Date.now()-start);throw e;
    }finally{(attempts??this.transport.attempts?.())?.push(this.store.call(id));}
  }
  async jev(state:unknown,questions:Record<string,Question>,purpose='decision',attempts?:CallRecord[]):Promise<JevResult>{
    const config=this.transport.config(),model=config.jevModel||'jev-1.13.0';
    const body={model,state,questions};
    const {data,latency}=await this.post('Jev',purpose,model,config.jevEndpoint||'https://api.typesafe.ai/v1/systemone',config.jevKey,body,{input:estimateTokens(body),output:768},attempts);
    for(const [id,q] of Object.entries(questions)){
      const a:Answer=data.answers?.[id];
      if(!a||a.type!==q.type)throw new Error('Jev 返回的题目类型不匹配');
      if(q.type==='choice'&&(!a.choice||!(a.choice in q.criteria)))throw new Error('Jev 选择不在合法候选中');
      if(q.type==='score'&&(!Number.isFinite(a.score)||a.score!<0||a.score!>q.criteria.length-1))throw new Error('Jev 评分范围无效');
      if(q.type==='noul'&&(!Number.isFinite(a.noul)||a.noul!<0||a.noul!>1))throw new Error('Jev Noul 无效');
      if(q.type!=='noul'&&(!Number.isFinite(a.confidence)||a.confidence!<0||a.confidence!>1))throw new Error('Jev 置信度无效');
    }
    return {answers:data.answers,model:data.model,input:data.usage.input_tokens,output:data.usage.output_tokens,latency};
  }
  async chooseText(state:unknown,question:Extract<Question,{type:'choice'}>,purpose='benchmark-action',attempts?:CallRecord[]){
    const result=await this.text('根据给定 state、instructions 和 candidates 选择一个动作。只返回 JSON 对象 {"choice":"候选键"}，不得新增候选，不要解释。',{state,instructions:question.instructions,candidates:question.criteria},purpose,64,attempts);
    let parsed:any;try{parsed=JSON.parse(result.text);}catch{throw new Error('DeepSeek 未返回合法 JSON 选择');}
    if(typeof parsed?.choice!=='string'||!Object.hasOwn(question.criteria,parsed.choice))throw new Error('DeepSeek 选择不在合法候选中');
    return {...result,choice:parsed.choice as string};
  }
  async text(system:string,state:unknown,purpose:string,maxTokens=768,attempts?:CallRecord[]):Promise<{text:string;input:number;output:number;latency:number;model:string}>{
    const config=this.transport.config(),model='deepseek-flash';
    const body={model,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(state)}],thinking:{type:(['plan','daily-plan','replan','reflection'].includes(purpose))&&config.thinking?'enabled':'disabled'},max_tokens:maxTokens,stream:false,...purpose==='benchmark-action'?{response_format:{type:'json_object'}}:{}};
    const {data,latency}=await this.post('DeepSeek',purpose,model,`${(config.deepseekBaseUrl||'https://api.deepseek.com').replace(/\/$/,'')}/chat/completions`,config.deepseekKey,body,{input:estimateTokens(body),output:maxTokens},attempts);
    const text=data.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text.trim())throw new Error('DeepSeek 未返回可用文本');
    return {text:text.trim(),input:data.usage.prompt_tokens,output:data.usage.completion_tokens,latency,model:data.model};
  }
}
