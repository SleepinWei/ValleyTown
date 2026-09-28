import { createClient, type Session } from '@supabase/supabase-js';
import { validateTownData, type TownData } from '../../engine/browser-store';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloud=url&&key?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
export const cloudConfigured=!!cloud;
export async function currentSession(){if(!cloud)return null;const {data,error}=await cloud.auth.getSession();if(error)throw error;return data.session;}
export async function loadCloudTown(){
  if(!cloud)throw new Error('未配置 Supabase');
  const {data,error}=await cloud.from('town_saves').select('payload,revision,updated_at').maybeSingle();if(error)throw error;
  return data?{data:validateTownData(data.payload),revision:Number(data.revision),updated:Date.parse(data.updated_at)}:null;
}
export async function saveCloudTown(data:TownData,revision:number){
  if(!cloud)throw new Error('未配置 Supabase');
  if(new TextEncoder().encode(JSON.stringify(data)).length>10_000_000)throw new Error('云存档超过 10 MB，请先导出备份；本地存档仍保留。');
  const {data:next,error}=await cloud.rpc('save_town',{p_payload:data,p_expected_revision:revision});
  if(error){if(error.message.includes('save_conflict'))throw new Error('云存档已被另一设备更新。已停止同步，请先导出本机备份，再载入云端版本。');throw error;}
  return Number(next);
}
export async function modelStatus(){
  if(!cloud)return {jev:false,deepseek:false};
  const {data,error}=await cloud.functions.invoke('model-proxy',{body:{action:'status'}});if(error)throw new Error('模型代理未就绪：请检查 Edge Function、登录与云端模型权限');return data as {jev:boolean;deepseek:boolean;quota?:unknown};
}
export async function proxyModel(provider:string,body:unknown){
  if(!cloud)throw new Error('未配置 Supabase');
  const session=await currentSession();if(!session)throw new Error('请先登录云存档账号');
  // Use fetch here to preserve HTTP status (especially 429 and ambiguous network failures) for the ledger.
  const response=await fetch(`${url}/functions/v1/model-proxy`,{method:'POST',headers:{'Content-Type':'application/json',apikey:key,Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({provider,body}),signal:AbortSignal.timeout(50000)});
  return {status:response.status,body:await response.json()};
}
export type { Session };
