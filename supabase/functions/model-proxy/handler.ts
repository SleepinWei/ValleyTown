// Platform-independent handler so authorization, budgets and upstream failures can be tested locally.
export type Provider='DeepSeek'|'Jev';
interface Access {enabled:boolean;deepseek_limit_nano:number;jev_limit_nano:number}
export interface ProxyDeps {
  authenticate(token:string):Promise<string|null>;
  access(user:string):Promise<Access|null>;
  reserve(user:string,id:string,provider:Provider,amount:number):Promise<void>;
  settle(id:string,cost:number,input:number,output:number):Promise<void>;
  fail(id:string,knownNotExecuted:boolean):Promise<void>;
  fetch:typeof fetch;
  config:{origins:string[];deepseekKey?:string;jevKey?:string;usdCny:number};
}
const estimate=(body:unknown)=>{const text=JSON.stringify(body),wide=(text.match(/[^\x00-\x7f]/g)||[]).length;return Math.ceil((text.length-wide)/3+wide*1.5)+256;};
const cost=(provider:Provider,input:number,output:number,cached:number,usdCny:number)=>Math.ceil(provider==='Jev'?input*.042*usdCny*1000:((input-cached)*2+cached*.04+output*8)*1000);
function payload(provider:Provider,raw:any){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_payload');
  if(provider==='DeepSeek'){
    if(!Array.isArray(raw.messages)||raw.messages.length<1||raw.messages.length>8||raw.messages.some((m:any)=>!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>80000))throw new Error('invalid_messages');
    if(!Number.isInteger(raw.max_tokens)||raw.max_tokens<1||raw.max_tokens>2200)throw new Error('invalid_max_tokens');
    return {model:'deepseek-flash',messages:raw.messages.map((m:any)=>({role:m.role,content:m.content})),max_tokens:raw.max_tokens,thinking:{type:'disabled'},stream:false,...raw.response_format?.type==='json_object'?{response_format:{type:'json_object'}}:{}};
  }
  const questions=raw.questions;
  if(!questions||typeof questions!=='object'||Array.isArray(questions)||Object.keys(questions).length<1||Object.keys(questions).length>8||raw.state===undefined)throw new Error('invalid_questions');
  for(const q of Object.values(questions) as any[]){
    if(!q||!['choice','score','noul'].includes(q.type)||typeof q.instructions!=='string'||q.instructions.length>8000)throw new Error('invalid_question');
    if(q.type==='choice'&&(!q.criteria||Array.isArray(q.criteria)||typeof q.criteria!=='object'||Object.keys(q.criteria).length<1||Object.keys(q.criteria).length>100||Object.values(q.criteria).some(v=>typeof v!=='string')))throw new Error('invalid_choices');
    if(q.type==='score'&&(!Array.isArray(q.criteria)||q.criteria.length<2||q.criteria.length>20||q.criteria.some((v:unknown)=>typeof v!=='string')))throw new Error('invalid_scores');
  }
  return {model:'jev-1.13.0',state:raw.state,questions:Object.fromEntries(Object.entries(questions).map(([id,q]:[string,any])=>[id,{type:q.type,instructions:q.instructions,...q.type==='noul'?{}:{criteria:q.criteria}}]))};
}
async function readJson(req:Request){
  const reader=req.body?.getReader();if(!reader)throw new Error('empty_body');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>128000){await reader.cancel();throw new Error('payload_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export function createModelHandler(deps:ProxyDeps){return async(req:Request):Promise<Response>=>{
  const origin=req.headers.get('origin');const allowed=!!origin&&deps.config.origins.includes(origin);
  const headers:Record<string,string>={'Content-Type':'application/json','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  if(allowed)headers['Access-Control-Allow-Origin']=origin!;
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!allowed)return reply({error:'origin_not_allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
  const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token)return reply({error:'authentication_required'},401);
  let user:string|null;
  try{user=await deps.authenticate(token);}catch{return reply({error:'authentication_unavailable'},503);}
  if(!user)return reply({error:'invalid_session'},401);
  let input:any;try{input=await readJson(req);}catch{return reply({error:'invalid_request_body'},400);}
  let access:Access|null;
  try{access=await deps.access(user);}catch{return reply({error:'access_check_failed'},503);}
  if(input?.action==='status')return reply({jev:!!access?.enabled&&access.jev_limit_nano>0&&!!deps.config.jevKey,deepseek:!!access?.enabled&&access.deepseek_limit_nano>0&&!!deps.config.deepseekKey,quota:access});
  if(!access?.enabled)return reply({error:'model_access_denied'},403);
  const provider=input?.provider as Provider;if(!['Jev','DeepSeek'].includes(provider))return reply({error:'invalid_provider'},400);
  const key=provider==='Jev'?deps.config.jevKey:deps.config.deepseekKey;if(!key)return reply({error:'model_not_configured'},503);
  if(!Number.isFinite(deps.config.usdCny)||deps.config.usdCny<=0||deps.config.usdCny>100)return reply({error:'invalid_server_pricing'},503);
  let body:ReturnType<typeof payload>;try{body=payload(provider,input.body);}catch{return reply({error:'invalid_model_payload'},400);}
  const id=crypto.randomUUID(),reservation=cost(provider,estimate(body),'max_tokens' in body?body.max_tokens:768,0,deps.config.usdCny);
  try{await deps.reserve(user,id,provider,reservation);}catch(e){const text=(e as Error).message;return reply({code:text.includes('budget')?'model_budget_exhausted':text.includes('rate')?'model_rate_limit':'model_access_denied',error:text.includes('budget')?'云端模型额度不足，请联系部署者调整':text.includes('rate')?'云端请求过于频繁，请稍后再试':'云端模型权限或账本不可用'},text.includes('budget')||text.includes('rate')?429:403);}
  try{
    const upstream=await deps.fetch(provider==='Jev'?'https://api.typesafe.ai/v1/systemone':'https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(40000)});
    if(!upstream.ok){await deps.fail(id,[400,401,403,404,422,429].includes(upstream.status));return reply({error:`${provider} HTTP ${upstream.status}`},upstream.status);}
    const data=await upstream.json(),usage=data.usage,tokens=provider==='Jev'?usage?.input_tokens:usage?.prompt_tokens,output=provider==='Jev'?usage?.output_tokens:usage?.completion_tokens,cached=provider==='Jev'?0:(usage?.prompt_cache_hit_tokens??usage?.prompt_tokens_details?.cached_tokens??0);
    if(![tokens,output,cached].every(n=>Number.isSafeInteger(n)&&n>=0)||cached>tokens)throw new Error('invalid_usage');
    await deps.settle(id,cost(provider,tokens,output,cached,deps.config.usdCny),tokens,output);
    return reply({...data,request_id:id});
  }catch{
    try{await deps.fail(id,false);}catch{/* Reservation remains pending and cannot silently become free. */}
    return reply({error:'模型请求未完成或用量待核对，云端已保留额度',request_id:id},502);
  }
};}
