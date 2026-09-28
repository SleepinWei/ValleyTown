import { useRef, useState, useSyncExternalStore } from 'react';
import { Cloud, Download, Upload, RefreshCw, LogOut } from 'lucide-react';
import { cloud } from './runtime/cloud';
import { runtime } from './runtime/client';
import './cloud.css';

export function CloudSettings(){
  const info=useSyncExternalStore(runtime.subscribe,()=>runtime.info);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const file=useRef<HTMLInputElement>(null);
  const run=async(task:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{await task();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
  const login=async()=>{if(!cloud)return;await runtime.suspend();const {error}=await cloud.auth.signInWithPassword({email,password});if(error)throw error;window.location.reload();};
  const signup=async()=>{if(!cloud)return;const {data,error}=await cloud.auth.signUp({email,password});if(error)throw error;if(data.session){await runtime.suspend();window.location.reload();}else setMessage('请查收确认邮件，确认后回到这里登录。');};
  return <section className="settings-section cloud-settings" aria-label="云存档与账号">
    <h3><Cloud size={18}/> 小镇的存档</h3>
    <p className="muted">模拟只在当前页面可见时推进。隐藏、关闭或刷新后暂停，回来后点击「继续模拟」。</p>
    <div className="cloud-status"><strong>{info.email?`云存档 · ${info.email}`:'本机存档 · 无需登录'}</strong><span>{info.syncing?'正在同步云端…':info.lastSaved?`本机已保存 ${new Date(info.lastSaved).toLocaleTimeString()}`:'正在准备存档'}</span>{info.email&&<small>{info.dirty?'有尚未同步的本机修改':'已同步到云端'}</small>}</div>
    {info.error&&<p className="warning" role="alert">{info.error}</p>}
    {info.email?<div className="button-row">
      <button disabled={busy||info.syncing||info.conflict} className="outline" onClick={()=>void run(()=>runtime.sync())}><Cloud size={14}/> 立即同步</button>
      <button disabled={busy} className="outline" onClick={()=>void run(()=>runtime.refreshModels())}><RefreshCw size={14}/> 检查模型连接</button>
      <button disabled={busy} className="outline" onClick={()=>void run(async()=>{await runtime.suspend();const {error}=await cloud!.auth.signOut();if(error)throw error;window.location.reload();})}><LogOut size={14}/> 退出账号</button>
    </div>:cloud?<form className="cloud-auth" onSubmit={e=>{e.preventDefault();void run(login);}}>
      <label>邮箱<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>密码<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <div className="button-row"><button className="primary" disabled={busy}>登录云存档</button><button type="button" className="outline" disabled={busy||!email||password.length<8} onClick={()=>void run(signup)}>创建账号</button></div>
      <p className="hint">每个账号有独立存档。登录不会覆盖或自动上传访客小镇；可先导出，再登录导入。</p>
    </form>:<p className="hint">此部署未接入云存档，可完整体验本地规则演示。浏览器数据保存在当前设备，请定期导出备份。</p>}
    <div className="button-row">
      <button className="outline" disabled={busy} onClick={()=>void run(()=>runtime.download())}><Download size={14}/> 导出备份</button>
      <button className="outline" disabled={busy} onClick={()=>file.current?.click()}><Upload size={14}/> 导入备份</button>
      <input ref={file} type="file" accept="application/json,.json" className="sr-only" aria-label="选择小镇备份" onChange={e=>{const f=e.target.files?.[0];if(f)void run(async()=>{await runtime.importFile(f);setMessage('备份已导入，小镇保持暂停。');});e.target.value='';}}/>
    </div>
    {info.email&&<details className="cloud-recovery"><summary>从云端重新载入</summary><p className="hint">会替换当前设备的小镇，请先导出本机备份，暂停模拟并等待模型任务结束。</p><button className="outline" disabled={busy||info.syncing} onClick={()=>void run(()=>runtime.useCloud())}>使用云端存档</button></details>}
    {info.email&&<p className="hint">可见页面每 30 秒自动同步。模型使用需要部署者授予云端额度；页面里的预算是本机额外限制。</p>}
    {message&&<p role="status" className="hint">{message}</p>}
  </section>;
}
