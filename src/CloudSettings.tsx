import { useRef,useState,useSyncExternalStore } from 'react';
import { Cloud,Download,Upload,RefreshCw,LogOut,Shield,Eye } from 'lucide-react';
import { cloud } from './runtime/cloud';
import { runtime } from './runtime/client';
import './cloud.css';

export function CloudSettings(){
  const info=useSyncExternalStore(runtime.subscribe,()=>runtime.info);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const file=useRef<HTMLInputElement>(null);
  const run=async(task:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{await task();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
  const login=async()=>{if(!cloud)return;await runtime.suspend();const {error}=await cloud.auth.signInWithPassword({email:email.trim(),password});if(error)throw error;window.location.reload();};
  const signup=async()=>{if(!cloud)return;const {data,error}=await cloud.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:window.location.origin+import.meta.env.BASE_URL}});if(error)throw error;if(data.session){await runtime.suspend();window.location.reload();}else setMessage('请查收确认邮件，验证邮箱后回到这里登录。');};
  return <section className="settings-section cloud-settings" aria-label="共享小镇与账号">
    <h3>{info.role==='admin'?<Shield size={18}/>:<Eye size={18}/>} {info.role==='admin'?'管理员账号':'观看账号'}</h3>
    <p className="muted">所有人观看同一个小镇。只有管理员可以运行模拟、修改设置和编辑世界。</p>
    <div className="cloud-status"><strong>{(info.email?`已登录 · ${info.email}`:null)??(cloud?'访客 · 无需登录即可观看':'本地演示')}</strong><span>{info.hosting?'当前页面正在管理小镇':info.online?'已连接共享画面':'模拟连接未开启，小镇保持最后状态'}</span>{info.lastSaved&&<small>最近保存 {new Date(info.lastSaved).toLocaleTimeString()}</small>}</div>
    {info.error&&<p className="warning" role="alert">{info.error}</p>}
    {info.email?<div className="button-row">
      {info.hosting&&<><button disabled={busy||info.syncing} className="outline" onClick={()=>void run(()=>runtime.sync())}><Cloud size={14}/> 发布并保存</button><button disabled={busy} className="outline" onClick={()=>void run(()=>runtime.refreshModels())}><RefreshCw size={14}/> 检查模型连接</button><button disabled={busy} className="outline" onClick={()=>void run(()=>runtime.stopHosting())}><Eye size={14}/> 停止管理并观看</button></>}
      <button disabled={busy} className="outline" onClick={()=>void run(async()=>{await runtime.suspend();const {error}=await cloud!.auth.signOut();if(error)throw error;window.location.reload();})}><LogOut size={14}/> 退出账号</button>
    </div>:cloud?<form className="cloud-auth" onSubmit={e=>{e.preventDefault();void run(login);}}>
      <label>邮箱<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>密码<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <div className="button-row"><button className="primary" disabled={busy}>登录</button><button type="button" className="outline" disabled={busy||!email||password.length<8} onClick={()=>void run(signup)}>创建账号</button></div>
      <p className="hint">新账号默认为观看权限。管理员由部署者指定，并须完成邮箱验证；注册不会生成新的小镇。</p>
    </form>:<p className="hint">本地演示未连接 Supabase。线上共享站点需要配置公开连接参数。</p>}
    {info.hosting&&<><div className="button-row"><button className="outline" disabled={busy} onClick={()=>void run(()=>runtime.download())}><Download size={14}/> 导出备份</button><button className="outline" disabled={busy} onClick={()=>file.current?.click()}><Upload size={14}/> 导入备份</button><input ref={file} type="file" accept="application/json,.json" className="sr-only" aria-label="选择小镇备份" onChange={e=>{const f=e.target.files?.[0];if(f)void run(async()=>{await runtime.importFile(f);setMessage('备份已导入并发布，小镇保持暂停。');});e.target.value='';}}/></div><p className="hint">共享世界每 3 秒发布并保存。切换标签页保持登录与模拟运行。退出账号或关闭管理页面后停止模拟；浏览器休眠或网络中断时可能暂停，账号仍保持登录。</p></>}
    {message&&<p role="status" className="hint">{message}</p>}
  </section>;
}
