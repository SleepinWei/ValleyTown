import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelHandler, type ProxyDeps } from '../supabase/functions/model-proxy/handler';
function setup(overrides:Partial<ProxyDeps>={}){
  const events:string[]=[],requests:any[]=[];
  const deps:ProxyDeps={authenticate:async token=>token==='valid'?'owner':null,access:async()=>({enabled:true,deepseek_limit_nano:1e10,jev_limit_nano:1e10}),reserve:async(user,_id,provider,amount)=>{events.push(`reserve:${user}:${provider}`);assert.ok(amount>0);},settle:async()=>{events.push('settle');},fail:async(_id,known)=>{events.push(`fail:${known}`);},fetch:async(_url,options)=>{events.push('upstream');requests.push(JSON.parse(options!.body as string));return new Response(JSON.stringify({model:'deepseek-flash',usage:{prompt_tokens:100,completion_tokens:10},choices:[{message:{content:'你好'}}]}));},config:{origins:['https://town.example'],deepseekKey:'server-secret',jevKey:'server-jev',usdCny:7},...overrides};
  const handler=createModelHandler(deps),call=(body:unknown,token='valid',origin='https://town.example')=>handler(new Request('https://proxy.example',{method:'POST',headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  return {events,requests,call,handler};
}
const request={provider:'DeepSeek',body:{model:'untrusted-model',messages:[{role:'user',content:'你好'}],max_tokens:20,stream:true,tools:[{name:'bad'}]}};
test('proxy rejects missing/invalid auth and unknown origins before any paid request',async()=>{
  const f=setup();assert.equal((await f.call(request,'invalid')).status,401);assert.equal((await f.call(request,'valid','https://attacker.example')).status,403);assert.equal((await f.handler(new Request('https://proxy.example',{method:'POST',body:'{}'}))).status,401);assert.deepEqual(f.events,[]);
});
test('only enabled accounts can use proxy; status exposes no keys',async()=>{
  const f=setup({access:async()=>null});assert.equal((await f.call(request)).status,403);const status=await f.call({action:'status'});assert.deepEqual((await status.json()).deepseek,false);assert.deepEqual(f.events,[]);
});
test('proxy reserves before dispatch, fixes model and rejects client tools/stream settings',async()=>{
  const f=setup();const result=await f.call(request);assert.equal(result.status,200);assert.deepEqual(f.events,['reserve:owner:DeepSeek','upstream','settle']);assert.equal(f.requests[0].model,'deepseek-flash');assert.equal(f.requests[0].stream,false);assert.equal(f.requests[0].tools,undefined);assert.ok(!(await result.text()).includes('server-secret'));
});
test('quota exhaustion never reaches supplier',async()=>{
  const f=setup({reserve:async()=>{throw new Error('model_budget_exhausted');}});const response=await f.call(request);assert.equal(response.status,429);assert.equal((await response.json()).code,'model_budget_exhausted');assert.deepEqual(f.events,[]);
});
test('unknown network/usage failures retain quota; explicit rejections release it',async()=>{
  const network=setup({fetch:async()=>{throw new Error('network');}});assert.equal((await network.call(request)).status,502);assert.ok(network.events.includes('fail:false'));
  const rejected=setup({fetch:async()=>new Response('{}',{status:401})});assert.equal((await rejected.call(request)).status,401);assert.ok(rejected.events.includes('fail:true'));
  const malformed=setup({fetch:async()=>new Response('{}')});assert.equal((await malformed.call(request)).status,502);assert.ok(malformed.events.includes('fail:false'));
});
test('oversized and malformed payloads do not consume quota',async()=>{
  const f=setup();assert.equal((await f.call({provider:'DeepSeek',body:{messages:[],max_tokens:999999}})).status,400);assert.equal((await f.call({value:'x'.repeat(130000)})).status,400);assert.deepEqual(f.events,[]);
});
