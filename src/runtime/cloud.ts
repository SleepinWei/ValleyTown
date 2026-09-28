import { createClient, type Session } from '@supabase/supabase-js';
import { validateTownData, type TownData } from '../../engine/browser-store';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloud=url&&key?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
export const cloudConfigured=!!cloud;
export async function currentSession(){if(!cloud)return null;const {data,error}=await cloud.auth.getSession();if(error)throw error;return data.session;}
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

export async function isTownAdmin(){
  if(!cloud)return true;
  const {data,error}=await cloud.rpc('is_town_admin');if(error)throw error;return data===true;
}
export async function claimTownHost(session:string){
  const {data,error}=await cloud!.rpc('claim_town_host',{p_session:session});if(error)throw error;
  return {data:data.payload?validateTownData(data.payload):undefined,revision:Number(data.revision)};
}
export async function publishTown(session:string,revision:number,data:TownData,snapshot:import('../../shared/types').Snapshot){
  const {data:next,error}=await cloud!.rpc('publish_town',{p_session:session,p_revision:revision,p_payload:data,p_snapshot:snapshot});
  if(error)throw error;return Number(next);
}
export async function releaseTownHost(session:string){
  const {error}=await cloud!.rpc('release_town_host',{p_session:session});if(error)throw error;
}
export async function watchTown(revision:number){
  const {data,error}=await cloud!.rpc('watch_town',{p_revision:revision});if(error)throw error;
  return data as {snapshot:import('../../shared/types').Snapshot|null;revision:number;online:boolean;updated_at:string};
}
