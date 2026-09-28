import 'dotenv/config';
import { ModelGateway as PortableGateway } from '../engine/model-gateway';
import { postNative } from './http';
import { modelAttempts } from './telemetry';
import type { Ledger } from '../engine/ports';
export type { Question, Answer, JevResult } from '../engine/model-gateway';
export { estimateTokens } from '../engine/model-gateway';
// Legacy Node tools and migration tests retain their native transport.
export class ModelGateway extends PortableGateway {
  constructor(store:Ledger,canRun:()=>boolean=()=>true,onBudget:()=>void=()=>{}) {
    super(store,canRun,onBudget,{
      config:()=>({jevKey:process.env.VALLEYTOWN_JEV_API_KEY,deepseekKey:process.env.DEEPSEEK_API_KEY,
        jevModel:process.env.JEV_MODEL,jevEndpoint:process.env.JEV_ENDPOINT,deepseekBaseUrl:process.env.DEEPSEEK_BASE_URL,
        thinking:process.env.DEEPSEEK_BACKGROUND_THINKING==='true'}),
      send:async(_provider,url,key,body,retry)=>retry||process.env.MODEL_HTTP_TRANSPORT==='curl'
        ?postNative(url,key,body)
        :fetch(url,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}),
      attempts:()=>modelAttempts.getStore(),
    });
  }
}
