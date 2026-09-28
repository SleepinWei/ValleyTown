import { useEffect, useState, useSyncExternalStore } from 'react';
import { Clock3, Eye, Leaf, Maximize2, Minimize2, Radio, Shield, Users, X } from 'lucide-react';
import { runtime } from './runtime/client';
import { CloudSettings } from './CloudSettings';
import { TownCanvas } from './TownCanvas';
import { useImmersive } from './useImmersive';
import { dayOf,timeOf } from '../shared/types';
import './viewer.css';
const noop=()=>{};
export function ViewerApp(){
  const info=useSyncExternalStore(runtime.subscribe,()=>runtime.info);
  const [selected,setSelected]=useState('gardener'),[account,setAccount]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const {root,button,immersive,toggle}=useImmersive();
  const snapshot=runtime.snapshot(false);
  const world=snapshot&&(!info.online?{...snapshot,status:'paused_manual' as const}:snapshot);
  const actor=world?.actors.find(a=>a.id===selected)??world?.actors[0];
  useEffect(()=>{if(!account)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setAccount(false);};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[account]);
  const takeControl=async()=>{setBusy(true);setMessage('');try{await runtime.takeControl();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
  return <div className={`app-shell viewer-shell ${immersive?'immersive':''}`} ref={root}>
    <header className="topbar"><a className="brand" href={import.meta.env.BASE_URL}><div className="brand-mark"><Leaf size={23}/></div><div><strong>溪谷镇<span>VALLEYTOWN</span></strong><small>同一个小镇，一起看故事发生。</small></div></a>
      <span className="viewer-mode"><Eye size={15}/> 共享小镇 · 只读观看</span>
      <div className="header-right">{info.role==='admin'&&<button className="primary" disabled={busy||!info.ready} onClick={()=>void takeControl()}><Shield size={15}/>{busy?'正在连接…':'进入管理'}</button>}<button className="outline" onClick={()=>setAccount(true)}>{info.email?'我的账号':'登录 / 注册'}</button></div>
    </header>
    <div className="world-toolbar"><div className="season"><div className="season-icon"><Leaf size={21}/></div><div><strong>{world?`春 · 第 ${dayOf(world.clock)} 天`:'溪谷镇直播间'}</strong><small>所有人观看同一份世界</small></div>{world&&<><span className="divider"/><span className="world-time"><Clock3 size={17}/>{timeOf(world.clock)}</span><span className="weather">{world.weather}</span></>}</div>
      <span className={`connection ${info.online?'online':''}`}><i/>{info.error?'连接中断 · 保留最后画面':info.online?(world?.status==='running_live'?'管理员正在运行':'管理员在线 · 已暂停'):'管理员离线 · 小镇已暂停'}</span>
    </div>
    {(message||info.error)&&<p className="viewer-notice" role="alert">{message||info.error}</p>}
    {world?<main className="workspace viewer-workspace">
      <aside className="residents-panel"><div className="panel-title"><h2><Users size={16}/> 小镇居民</h2><span className="count">{world.actors.length}</span></div><p className="panel-caption">选择居民，看看 TA 的日常</p><div className="resident-list" aria-label="小镇居民列表">{world.actors.map(a=><button className={`resident ${actor?.id===a.id?'selected':''}`} key={a.id} onClick={()=>setSelected(a.id)}><span className="viewer-avatar" style={{background:a.color}}>{a.name.slice(-1)}</span><span className="resident-copy"><strong>{a.name}<small>{a.role}</small></strong><span>{a.activity}</span></span></button>)}</div></aside>
      <section className="center-column"><div className="map-frame"><div className="map-topline"><span><Radio size={13}/> {info.online?'共享画面 · 每几秒同步':'最后保存的画面'}</span><div className="view-actions"><button ref={button} onClick={()=>void toggle()} aria-label={immersive?'退出全屏':'全屏观看'}>{immersive?<Minimize2 size={14}/>:<Maximize2 size={14}/>} {immersive?'退出全屏':'全屏观看'}</button></div></div>
        <TownCanvas snapshot={world} selected={actor?.id??selected} onSelect={setSelected} onMove={noop} onInteract={noop} readOnly/>
        {world.status!=='running_live'&&<div className="pause-tag">小镇已暂停<span>故事保存在这里，等待管理员继续</span></div>}
        <div className="map-bottomline"><span>拖动、缩放、旋转镜头，或点击居民查看近况。</span><span>观看不会产生模型调用</span></div></div>
        <section className="viewer-events"><div className="panel-title"><h2>小镇见闻</h2><span>公开事件</span></div>{world.events.slice(-12).reverse().map(event=><article key={event.id}><time>第 {dayOf(event.at)} 天 · {timeOf(event.at)}</time><p>{event.text}</p></article>)}{!world.events.length&&<p className="muted">新的一天还很安静，故事正在酝酿。</p>}</section>
      </section>
      <aside className="inspector viewer-inspector">{actor&&<><span className="viewer-avatar large" style={{background:actor.color}}>{actor.name.slice(-1)}</span><h2>{actor.name}</h2><p className="muted">{actor.role}</p><div className="cloud-status"><strong>此刻正在</strong><span>{actor.activity}</span></div><p>{actor.life.status==='dead'?'TA 的故事留在了小镇里。':actor.life.custody?'正在司法所服刑。':'每一次相遇，都可能成为新的故事。'}</p></>}<div className="viewer-about"><Eye size={18}/><h3>一起看小镇生活</h3><p>大家看到的是同一个模拟。你可以自由浏览画面；运行、设置和世界编辑由管理员负责。</p><small>{info.lastSaved?`最近同步 ${new Date(info.lastSaved).toLocaleTimeString()}`:'等待首次同步'}</small></div></aside>
    </main>:<main className="viewer-empty"><Leaf size={40}/><h1>{info.ready?'等待小镇开场':'正在连接共享小镇'}</h1><p>{info.ready?'管理员首次进入管理后，共享画面会出现在这里。':'正在读取大家共同的小镇。'}</p><button className="outline" onClick={()=>setAccount(true)}>账号与登录</button>{info.error&&<button className="outline" onClick={()=>window.location.reload()}>重新连接</button>}</main>}
    <footer className="statusbar"><span><Leaf size={12}/> 一个小镇，所有人共同见证。</span><span>{info.role==='admin'?'管理员账号 · 当前为观看模式':info.email?'已登录 · 观看账号':'访客 · 只读观看'}</span></footer>
    {account&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setAccount(false);}}><div className="modal" role="dialog" aria-modal="true" aria-label="账号与登录"><header><h2>账号与登录</h2><button className="icon-button" autoFocus aria-label="关闭" onClick={()=>setAccount(false)}><X size={20}/></button></header><CloudSettings/></div></div>}
  </div>;
}
