/// <reference lib="webworker" />
import { World } from '../../server/world';
import { BrowserStore, emptyTownData, validateTownData, type TownData } from '../../engine/browser-store';
import { createWorldRequests } from '../../engine/requests';
import { openTownDatabase, readLocal, writeLocal } from './database';
import { PageLifecycle } from './lifecycle';
import type { ModelConfig } from '../../engine/ports';

const worker=self as unknown as DedicatedWorkerGlobalScope;
let world:World,store:BrowserStore,lifecycle:PageLifecycle,request:ReturnType<typeof createWorldRequests>;
let db:IDBDatabase,key:string,revision=0,dirty=false,generation=0,persisted=0,config:ModelConfig={};
let writes:Promise<void>=Promise.resolve(),saveTimer:ReturnType<typeof setTimeout>|undefined,modelId=0;
const models=new Map<number,{resolve:(r:Response)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function report(error:unknown){worker.postMessage({type:'error',error:error instanceof Error?error.message:String(error)});}
function flush(){
  clearTimeout(saveTimer);saveTimer=undefined;
  const captured=generation,value={data:structuredClone(store.data),revision,dirty,updated:Date.now()};
  writes=writes.then(()=>writeLocal(db,key,value)).then(()=>{persisted=captured;worker.postMessage({type:'saved',dirty,updated:value.updated});}).catch(error=>{world.pause();report(new Error('本地存档失败，模拟已停止。请释放浏览器存储空间后刷新：'+(error as Error).message));throw error;});
  return writes;
}
function changed(){generation++;dirty=true;if(!saveTimer)saveTimer=setTimeout(()=>{void flush().catch(e=>{world.pause();report(new Error('本地存档失败，模拟已暂停：'+(e as Error).message));});},250);}
function snapshot(){if(world)worker.postMessage({type:'snapshot',value:{player:{...world.snapshot(false),runtime:{simulation:'worker',threadId:0}},observer:{...world.snapshot(true),runtime:{simulation:'worker',threadId:0}}}});}
function initialize(data:TownData){
  const nextStore=new BrowserStore(data,{
    config:()=>config,
    send:async(provider,_url,_key,body)=>{
      try {
        lifecycle.requireActive();
        await flush(); // Persist reservations before dispatch; a page close cannot make an attempt free.
        lifecycle.requireActive();
      } catch(error) {throw new Error((error as Error).message,{cause:{preflight:true}});}
      const id=++modelId;
      return new Promise<Response>((resolve,reject)=>{const timer=setTimeout(()=>{models.delete(id);reject(new Error('模型网络请求未完成：云端响应超时'));},55000);models.set(id,{resolve,reject,timer});worker.postMessage({type:'model',id,provider,body});});
    },
  });
  const nextWorld=new World(nextStore,'demo');
  store=nextStore;world=nextWorld;
  world.state.status='paused_manual'; // A persisted running flag never resumes an unopened page.
  world.persist();lifecycle=new PageLifecycle(world);world.onChange=snapshot;
  store.onDirty=changed;request=createWorldRequests(world);changed();
}
worker.onmessage=async({data:m})=>{
  try {
    if(m.type==='init'){
      if(world)throw new Error('小镇已初始化');
      db=await openTownDatabase();key=m.key;
      const local=m.shared?undefined:await readLocal(db,key);
      revision=m.revision??local?.revision??0;dirty=local?.dirty??false;
      initialize(validateTownData(m.data??local?.data??emptyTownData()));
      lifecycle.heartbeat(m.active===true,m.validForMs);await flush();snapshot();worker.postMessage({type:'ready'});return;
    }
    // IndexedDB startup yields to the event loop. A heartbeat can arrive before
    // init completes; it is not a world operation and must not abort startup.
    if(m.type==='heartbeat'&&!world)return;
    if(!world)throw new Error('小镇尚未加载');
    if(m.type==='heartbeat'){lifecycle.heartbeat(m.active===true,m.validForMs);if(!m.active&&generation!==persisted){await flush();snapshot();}return;}
    if(m.type==='configure'){config=m.config??{};snapshot();return;}
    if(m.type==='model-result'){
      const pending=models.get(m.id);if(pending){models.delete(m.id);clearTimeout(pending.timer);if(m.body?.code==='model_budget_exhausted'){world.pause('paused_budget_limit');world.state.notice='云端模型额度不足，请联系部署者调整 Supabase 中的模型额度。';world.persist();snapshot();}if(m.error)pending.reject(new Error(m.error,{cause:{preflight:m.knownNotExecuted===true}}));else pending.resolve(new Response(JSON.stringify(m.body),{status:m.status}));}return;
    }
    let result:unknown;
    if(m.type==='request'){
      if(m.method==='POST'&&!(m.path==='/control'&&m.body?.action==='pause'))lifecycle.requireActive();
      result=await request(m.method,m.path,m.body);world.persist();await flush();snapshot();
    }else if(m.type==='export'){
      world.persist();await flush();result={data:structuredClone(store.data),snapshot:world.snapshot(false),revision,generation};
    }else if(m.type==='synced'){
      revision=m.revision;if(generation===m.generation)dirty=false;await flush();result={ok:true};
    }else if(m.type==='suspend'){
      lifecycle.suspend();await flush();snapshot();result={ok:true};
    }else if(m.type==='replace'){
      if(world.state.status==='running_live'||world.active)throw new Error('请先暂停并等待模型请求结算后再载入存档');
      const next=validateTownData(m.data);
      // Local costs survive imported worlds just as they survive in-game restore.
      for(const [id,call] of Object.entries(store.data.calls))next.calls[id]=call;
      initialize(next);revision=m.revision??revision;lifecycle.heartbeat(m.active===true,m.validForMs);await flush();snapshot();result={ok:true};
    }else throw new Error('未知运行消息');
    worker.postMessage({type:'reply',id:m.id,value:result});
  }catch(e){const error=e instanceof Error?e.message:String(e);if(m.id)worker.postMessage({type:'reply',id:m.id,error});else report(e);}
};
setInterval(()=>{if(!world)return;try{lifecycle.step();}catch(e){world.pause();report(e);}},100);
setInterval(snapshot,500);

// Worker messages keep the host heartbeat/sync independent of main-thread timer throttling.
setInterval(()=>{if(world)worker.postMessage({type:'pulse'});},1000);
