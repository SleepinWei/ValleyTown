import 'dotenv/config';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Store } from '../server/store';
import { ModelGateway } from '../server/models';
// This bounded check uses the same persistent ledger as the application.
const store=new Store(resolve(process.env.DATA_DIR||'data'),Number(process.env.TOKEN_LIMIT)||5_000_000);
const gateway=new ModelGateway(store);const results:Record<string,unknown>={at:new Date().toISOString(),scope:'一次中文 Jev 判断与一次短 DeepSeek 表达，不代表 3 游戏日实测'};
const provider=process.argv[2]||'all';
if(provider!=='deepseek')
try{const r=await gateway.jev({person:'许棠',task:'花圃还有二十分钟的工作',message:'现在去散步吗？'},{intent:{type:'choice',instructions:'选出不放弃当前承诺、又友好回应邀请的做法。',criteria:{later:'提议完成工作后散步',leave:'立即放下未完成的工作离开',refuse:'不解释地拒绝'}}},'smoke');results.jev={model:r.model,answers:r.answers,input:r.input,output:r.output,latency:r.latency};}catch(e){results.jev={error:(e as Error).message};}
if(provider!=='jev')
try{const r=await gateway.text('用一句中文表达给定意图，不改变意思，不新增事实。',{intent:'建议二十分钟后一起散步，先完成花圃工作'},'smoke',128);results.deepseek=r;}catch(e){const cause=(e as Error).cause as {code?:string;message?:string}|undefined;results.deepseek={error:(e as Error).message,cause:cause?{code:cause.code,message:cause.message}:undefined};}
results.usage=store.usage();mkdirSync('output',{recursive:true});writeFileSync('output/model-smoke.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));store.close();
