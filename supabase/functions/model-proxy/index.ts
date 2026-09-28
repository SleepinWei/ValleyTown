import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createModelHandler } from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(name:string,args:Record<string,unknown>){const {error}=await admin.rpc(name,args);if(error)throw error;}
Deno.serve(createModelHandler({
  authenticate:async token=>{const {data,error}=await admin.auth.getUser(token);return error?null:data.user?.id??null;},
  access:async user=>{const role=await admin.rpc('user_is_town_admin',{p_user:user});if(role.error)throw role.error;if(role.data!==true)return null;const {data,error}=await admin.from('model_access').select('enabled,deepseek_limit_nano,jev_limit_nano').eq('user_id',user).maybeSingle();if(error)throw error;return data;},
  reserve:(user,id,provider,amount)=>rpc('reserve_model_request',{p_user:user,p_id:id,p_provider:provider,p_amount:amount}),
  settle:(id,cost,input,output)=>rpc('settle_model_request',{p_id:id,p_cost:cost,p_input:input,p_output:output}),
  fail:(id,known)=>rpc('fail_model_request',{p_id:id,p_known_not_executed:known}),
  fetch,
  config:{origins:(Deno.env.get('ALLOWED_ORIGINS')??'').split(',').map(x=>x.trim()).filter(Boolean),deepseekKey:Deno.env.get('DEEPSEEK_API_KEY'),jevKey:Deno.env.get('VALLEYTOWN_JEV_API_KEY'),usdCny:Number(Deno.env.get('JEV_USD_CNY')??7)},
}));
