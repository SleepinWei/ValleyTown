import type { Snapshot } from '../../shared/types';
import { cloud, currentSession, cloudConfigured, loadCloudTown, saveCloudTown, modelStatus, proxyModel } from './cloud';
import { openTownDatabase, readLocal } from './database';
import { validateTownData, type TownData } from '../../engine/browser-store';

export interface RuntimeInfo {email:string|null;configured:boolean;ready:boolean;dirty:boolean;syncing:boolean;lastSaved:number|null;error:string;conflict:boolean;models:{jev:boolean;deepseek:boolean}}
export class RuntimeClient {
  info:RuntimeInfo={email:null,configured:cloudConfigured,ready:false,dirty:false,syncing:false,lastSaved:null,error:'',conflict:false,models:{jev:false,deepseek:false}};
  private listeners=new Set<()=>void>();private snapshots?:{player:Snapshot;observer:Snapshot};
  private startPromise?:Promise<void>;private worker?:Worker;private sequence=0;
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private heartbeat?:ReturnType<typeof setInterval>;private syncTimer?:ReturnType<typeof setInterval>;private releaseLock?:()=>void;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(){for(const fn of this.listeners)fn();}
  private patch(patch:Partial<RuntimeInfo>){this.info={...this.info,...patch};this.emit();}
  snapshot(observer:boolean){return this.snapshots?.[observer?'observer':'player'];}
  start(){return this.startPromise??=this.initialize();}
  private async lock(key:string){
    if(!navigator.locks)throw new Error('浏览器需要支持 Web Locks（Chrome、Edge、Firefox 或 Safari 新版），以避免多页面覆盖存档。');
    await new Promise<void>((resolve,reject)=>{void navigator.locks.request(`valleytown:${key}`,{ifAvailable:true},async lock=>{if(!lock){reject(new Error('这个小镇已在另一个标签页运行。请先关闭另一个页面，再刷新此页。'));return;}await new Promise<void>(release=>{this.releaseLock=release;resolve();});}).catch(reject);});
  }
  private async initialize(){
    try {
      const session=await currentSession(),key=session?`user:${session.user.id}`:'guest';
      // Auth sessions also change across tabs. Never keep an old account's world attached to a new session.
      cloud?.auth.onAuthStateChange((_event,next)=>{
        if((next?.user.id??null)!==(session?.user.id??null)){
          this.fail(new Error('账号已切换，正在载入对应存档。'));
          window.location.reload();
        }
      });
      this.patch({email:session?.user.email??null});await this.lock(key);
      const db=await openTownDatabase();const local=await readLocal(db,key);db.close();
      let data=local?.data,revision=local?.revision??0;
      if(session){
        try {
        const remote=await loadCloudTown();
        if(local?.dirty&&revision!==(remote?.revision??0))this.patch({conflict:true,error:'云端存在另一份更新。请先导出本机备份，再载入云端存档。'});
        else if(remote&&(!local||!local.dirty)){data=remote.data;revision=remote.revision;}
        } catch(error) {
          if(!local)throw error;
          this.patch({error:'云存档暂不可用，已载入本机进度：'+(error as Error).message});
        }
      }
      this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
      const ready=new Promise<void>((resolve,reject)=>{
        const startup=setTimeout(()=>reject(new Error('浏览器世界启动超时，请刷新页面重试。')),30000);
        this.worker!.onerror=event=>{clearTimeout(startup);const error=new Error(event.message||'模拟线程停止');reject(error);this.fail(error);};
        this.worker!.onmessage=({data:m})=>{
          if(m.type==='ready'){clearTimeout(startup);resolve();}
          if(m.type==='snapshot'){this.snapshots=m.value;this.emit();}
          if(m.type==='error'){clearTimeout(startup);const error=new Error(m.error);reject(error);this.fail(error);}
          if(m.type==='saved')this.patch({lastSaved:m.updated,dirty:m.dirty});
          if(m.type==='reply'){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);if(m.error)p.reject(new Error(m.error));else p.resolve(m.value);}}
          if(m.type==='model')void this.model(m);
        };
      });
      this.worker.postMessage({type:'init',key,data,revision,visible:!document.hidden});await ready;
      const pulse=()=>this.worker?.postMessage({type:'heartbeat',visible:!document.hidden});
      this.heartbeat=setInterval(pulse,1000);document.addEventListener('visibilitychange',pulse);
      // pagehide covers navigation and back/forward cache; pageshow resets the heartbeat without resuming.
      window.addEventListener('pagehide',()=>this.worker?.postMessage({type:'heartbeat',visible:false}));window.addEventListener('pageshow',pulse);
      this.patch({ready:true});
      if(session){await this.refreshModels();this.syncTimer=setInterval(()=>{if(!document.hidden&&!this.info.conflict&&this.info.dirty)void this.sync().catch(()=>{});},30000);}
    }catch(e){this.fail(e as Error);throw e;}
  }
  private fail(error:Error){this.patch({error:error.message,ready:false});for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.worker?.terminate();this.worker=undefined;clearInterval(this.heartbeat);clearInterval(this.syncTimer);this.releaseLock?.();}
  private async model(m:{id:number;provider:string;body:unknown}){
    let dispatched=false;
    try{if(document.hidden)throw new Error('页面不可见，已停止新模型请求');if(this.info.conflict)throw new Error('请先处理云存档冲突');dispatched=true;const response=await proxyModel(m.provider,m.body);this.worker?.postMessage({type:'model-result',id:m.id,...response});}
    catch(e){this.worker?.postMessage({type:'model-result',id:m.id,error:(e as Error).message,knownNotExecuted:!dispatched});}
  }
  private rpc<T=any>(type:string,value:Record<string,unknown>={}):Promise<T>{
    if(!this.worker)return Promise.reject(new Error('小镇尚未加载'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('操作超时，请查看当前状态后重试'));},30000);this.pending.set(id,{resolve,reject,timer});this.worker!.postMessage({id,type,...value});});
  }
  async request<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
    await this.start();
    if(this.info.conflict&&method==='POST'&&path==='/control'&&(body as any)?.action==='resume')throw new Error('请先处理云存档冲突后再继续模拟。');
    return this.rpc('request',{path,body,method});
  }
  async refreshModels(){
    try{const models=await modelStatus();this.patch({models:{jev:models.jev,deepseek:models.deepseek}});this.worker?.postMessage({type:'configure',config:{jevKey:models.jev?'proxy':undefined,deepseekKey:models.deepseek?'proxy':undefined}});}
    catch(e){this.patch({error:(e as Error).message});}
  }
  async sync(){
    if(!this.info.email)throw new Error('请先登录云存档账号');if(this.info.conflict)throw new Error(this.info.error);if(this.info.syncing)return;
    this.patch({syncing:true});
    try{const dump=await this.rpc<{data:TownData;revision:number;generation:number}>('export');const revision=await saveCloudTown(dump.data,dump.revision);await this.rpc('synced',{revision,generation:dump.generation});this.patch({error:''});}
    catch(e){const error=(e as Error).message,conflict=/另一设备|另一份/.test(error);this.patch({error,conflict});if(conflict)await this.rpc('suspend');throw e;}
    finally{this.patch({syncing:false});}
  }
  async download(){const dump=await this.rpc<{data:TownData}>('export');const url=URL.createObjectURL(new Blob([JSON.stringify(dump.data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`valleytown-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async importFile(file:File){if(file.size>10_000_000)throw new Error('存档文件不能超过 10 MB');const data=validateTownData(JSON.parse(await file.text()));await this.rpc('replace',{data,visible:!document.hidden});}
  async useCloud(){
    if(this.info.syncing)throw new Error('正在同步，请稍后再试');
    const remote=await loadCloudTown();if(!remote)throw new Error('云端尚无存档');
    await this.rpc('replace',{data:remote.data,revision:remote.revision,visible:!document.hidden});this.patch({conflict:false,error:''});
  }
  async suspend(){await this.start();await this.rpc('suspend');}
}
export const runtime=new RuntimeClient();
export function api<T=any>(path:string,body?:unknown):Promise<T>{return runtime.request<T>(path,body);}
