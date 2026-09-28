import type { Snapshot } from '../../shared/types';
import { cloud, currentSession, cloudConfigured, isTownAdmin, claimTownHost, publishTown, releaseTownHost, watchTown, modelStatus, proxyModel } from './cloud';
import { validateTownData, type TownData } from '../../engine/browser-store';
import { publicTownSnapshot } from './shared-view';

export interface RuntimeInfo {email:string|null;configured:boolean;role:'viewer'|'admin';hosting:boolean;online:boolean;ready:boolean;dirty:boolean;syncing:boolean;lastSaved:number|null;error:string;conflict:boolean;models:{jev:boolean;deepseek:boolean}}
export class RuntimeClient {
  info:RuntimeInfo={email:null,configured:cloudConfigured,role:'viewer',hosting:false,online:false,ready:false,dirty:false,syncing:false,lastSaved:null,error:'',conflict:false,models:{jev:false,deepseek:false}};
  private listeners=new Set<()=>void>();private snapshots?:{player:Snapshot;observer:Snapshot};
  private startPromise?:Promise<void>;private worker?:Worker;private workerReady=false;private sequence=0;
  private hostSession=crypto.randomUUID();private leaseDeadline=0;private viewRevision=-1;private hostRevision=0;
  private lastPublishAttempt=0;private pageOpen=true;
  private polling=false;private claiming=false;private stopping=false;
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private heartbeat?:ReturnType<typeof setInterval>;private syncTimer?:ReturnType<typeof setInterval>;private releaseLock?:()=>void;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(){for(const fn of this.listeners)fn();}
  private patch(patch:Partial<RuntimeInfo>){this.info={...this.info,...patch};this.emit();}
  snapshot(observer:boolean){return this.snapshots?.[observer?'observer':'player'];}
  start(){return this.startPromise??=this.initialize();}
  private async lock(key:string){
    if(!navigator.locks)throw new Error('浏览器需要支持 Web Locks，请使用新版浏览器。');
    await new Promise<void>((resolve,reject)=>{void navigator.locks.request(`valleytown:${key}`,{ifAvailable:true},async lock=>{if(!lock){reject(new Error('另一个标签页正在管理小镇。'));return;}await new Promise<void>(release=>{this.releaseLock=release;resolve();});}).catch(reject);});
  }
  private async initialize(){
    try {
      const session=await currentSession();
      cloud?.auth.onAuthStateChange((_event,next)=>{
        if((next?.user.id??null)!==(session?.user.id??null)){
          this.stopWorker();window.location.reload();
        }
      });
      this.patch({email:session?.user.email??null,role:await isTownAdmin()?'admin':'viewer'});
      if(!cloud){await this.lock('guest');await this.boot('guest');this.patch({hosting:true,ready:true});}
      else {await this.poll();this.patch({ready:true});}
      this.heartbeat=setInterval(()=>this.pulse(),1000);
      document.addEventListener('visibilitychange',()=>{
        // Switching tabs does not sign out, release hosting, or pause the worker.
        this.pulse();if(!document.hidden&&cloud&&!this.info.hosting)void this.poll();
      });
      window.addEventListener('pagehide',()=>{
        this.pageOpen=false;this.worker?.postMessage({type:'heartbeat',active:false});
        if(cloud&&this.info.hosting)void this.stopHosting();
      });
      window.addEventListener('pageshow',()=>{this.pageOpen=true;this.pulse();});
      this.syncTimer=setInterval(()=>{
        if(this.info.hosting&&cloud)void this.sync().catch(()=>{});
        else if(cloud&&!document.hidden)void this.poll();
      },3000);
    }catch(e){this.patch({error:(e as Error).message,ready:false});throw e;}
  }
  private pulse(){
    if(!this.worker||!this.workerReady)return;
    const remaining=cloud?this.leaseDeadline-performance.now():90000;
    const active=this.pageOpen&&remaining>0&&!this.stopping;
    this.worker.postMessage({type:'heartbeat',active,validForMs:Math.max(0,remaining)});
    if(remaining<=0&&!this.stopping)void this.stopHosting('模拟连接已中断，账号仍保持登录。重新进入管理即可载入共享存档。');
    else if(active&&cloud&&this.info.hosting&&performance.now()-this.lastPublishAttempt>=3000)void this.sync().catch(()=>{});
  }
  private async poll(){
    if(this.polling||this.info.hosting)return;this.polling=true;
    try{const state=await watchTown(this.viewRevision);if(this.info.hosting)return;
      if(state.snapshot){this.snapshots={player:state.snapshot,observer:state.snapshot};this.viewRevision=state.revision;}
      this.patch({online:state.online,lastSaved:Date.parse(state.updated_at),error:'',ready:true});
    }catch(e){this.patch({online:false,error:'共享画面连接中断：'+(e as Error).message});}
    finally{this.polling=false;}
  }
  async takeControl(){
    await this.start();if(this.info.role!=='admin')throw new Error('只有管理员可以运行小镇');
    if(this.info.hosting||this.claiming)return;if(document.hidden)throw new Error('请回到可见页面');
    this.claiming=true;
    try{
      await this.lock('shared-town');const started=performance.now();
      const remote=await claimTownHost(this.hostSession);this.leaseDeadline=started+90000;this.hostRevision=remote.revision;
      // The shared checkpoint is authoritative. Old private/guest worlds are never auto-published.
      await this.boot('shared-town',remote.data,remote.revision,true);
      this.patch({hosting:true,online:true,error:'',conflict:false});await this.refreshModels();await this.sync();
    }catch(e){this.stopWorker();this.patch({hosting:false,error:(e as Error).message.includes('town_host_busy')?'另一位管理员或另一个页面正在运行小镇，请稍后重试。':(e as Error).message});throw new Error(this.info.error);}
    finally{this.claiming=false;}
  }
  private async boot(key:string,data?:TownData,revision?:number,shared=false){
    this.workerReady=false;
    this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
    const ready=new Promise<void>((resolve,reject)=>{
      const startup=setTimeout(()=>reject(new Error('浏览器世界启动超时')),30000);
      this.worker!.onerror=event=>{clearTimeout(startup);const error=new Error(event.message||'模拟线程停止');reject(error);void this.stopHosting(error.message);};
      this.worker!.onmessage=({data:m})=>{
        if(m.type==='pulse')this.pulse();
        if(m.type==='ready'){clearTimeout(startup);this.workerReady=true;this.pulse();resolve();}
        if(m.type==='snapshot'){this.snapshots=m.value;this.emit();}
        if(m.type==='error'){clearTimeout(startup);reject(new Error(m.error));void this.stopHosting(m.error);}
        if(m.type==='saved')this.patch({dirty:m.dirty,...!cloud?{lastSaved:m.updated}:{}});
        if(m.type==='reply'){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);if(m.error)p.reject(new Error(m.error));else p.resolve(m.value);}}
        if(m.type==='model')void this.model(m);
      };
    });
    this.worker.postMessage({type:'init',key,data,revision,shared,active:this.pageOpen,validForMs:cloud?Math.max(0,this.leaseDeadline-performance.now()):90000});await ready;
  }
  private stopWorker(){
    this.workerReady=false;this.worker?.terminate();this.worker=undefined;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('模拟已停止'));}this.pending.clear();
    this.releaseLock?.();this.releaseLock=undefined;
  }
  async stopHosting(message=''){
    if(this.stopping)return;this.stopping=true;
    try{
      if(this.worker){await this.rpc('suspend');if(cloud&&this.info.hosting)await this.sync();}
    }catch{/* Last acknowledged checkpoint remains authoritative. */}
    finally{
      this.stopWorker();this.leaseDeadline=0;
      if(cloud){try{await releaseTownHost(this.hostSession);}catch{/* A server-side lease expires after 120 seconds. */}}
      this.snapshots=undefined;this.viewRevision=-1;this.patch({hosting:false,online:false,error:message});this.stopping=false;
      if(cloud){await this.poll();if(message)this.patch({error:message});}
    }
  }
  private async model(m:{id:number;provider:string;body:unknown}){
    let dispatched=false;
    try{if(!this.info.hosting||this.info.role!=='admin'||!this.pageOpen||this.stopping||(cloud&&performance.now()>=this.leaseDeadline))throw new Error('管理员未连接，已停止新模型请求');
      dispatched=true;const response=await proxyModel(m.provider,m.body);this.worker?.postMessage({type:'model-result',id:m.id,...response});}
    catch(e){this.worker?.postMessage({type:'model-result',id:m.id,error:(e as Error).message,knownNotExecuted:!dispatched});}
  }
  private rpc<T=any>(type:string,value:Record<string,unknown>={}):Promise<T>{
    if(!this.worker)return Promise.reject(new Error('小镇未在此页面运行'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('操作超时，请查看当前状态后重试'));},30000);this.pending.set(id,{resolve,reject,timer});this.worker!.postMessage({id,type,...value});});
  }
  private requireHost(){if(this.info.role!=='admin'||!this.info.hosting||this.stopping||(cloud&&performance.now()>=this.leaseDeadline))throw new Error('只有当前管理页面可以操作小镇');}
  async request<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
    await this.start();this.requireHost();const result=await this.rpc<T>('request',{path,body,method});
    if(cloud&&method==='POST')await this.sync();return result;
  }
  async refreshModels(){
    this.requireHost();try{const models=await modelStatus();this.patch({models:{jev:models.jev,deepseek:models.deepseek}});this.worker?.postMessage({type:'configure',config:{jevKey:models.jev?'proxy':undefined,deepseekKey:models.deepseek?'proxy':undefined}});}
    catch(e){this.patch({error:(e as Error).message});}
  }
  private syncPromise?:Promise<void>;
  async sync(){
    if(!cloud)return;if(this.syncPromise)return this.syncPromise;
    if(!this.info.hosting||this.info.role!=='admin')throw new Error('只有管理员可以发布共享小镇');
    this.syncPromise=this.publish();try{await this.syncPromise;}finally{this.syncPromise=undefined;}
  }
  private async publish(){
    this.patch({syncing:true});const started=performance.now();this.lastPublishAttempt=started;
    try{const dump=await this.rpc<{data:TownData;snapshot:Snapshot;generation:number}>('export');
      const revision=await publishTown(this.hostSession,this.hostRevision,dump.data,publicTownSnapshot(dump.snapshot));
      this.hostRevision=revision;this.leaseDeadline=started+90000;
      await this.rpc('synced',{revision,generation:dump.generation});this.patch({error:'',lastSaved:Date.now(),online:true});
    }catch(e){this.worker?.postMessage({type:'heartbeat',active:false});this.leaseDeadline=0;this.patch({error:'共享同步失败，模拟已暂停：'+(e as Error).message,online:false});throw e;}
    finally{this.patch({syncing:false});}
  }
  async download(){this.requireHost();const dump=await this.rpc<{data:TownData}>('export');const url=URL.createObjectURL(new Blob([JSON.stringify(dump.data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`valleytown-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async importFile(file:File){this.requireHost();if(file.size>10_000_000)throw new Error('存档文件不能超过 10 MB');const data=validateTownData(JSON.parse(await file.text()));await this.rpc('replace',{data,active:this.pageOpen,validForMs:cloud?Math.max(0,this.leaseDeadline-performance.now()):90000});await this.sync();}
  async useCloud(){this.requireHost();await this.stopHosting();await this.takeControl();}
  async suspend(){await this.start();if(this.worker){await this.rpc('suspend');if(cloud)await this.stopHosting();}}
}
export const runtime=new RuntimeClient();
export function api<T=any>(path:string,body?:unknown):Promise<T>{return runtime.request<T>(path,body);}
