import { useEffect, useId, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { Snapshot } from '../shared/types';

export function SimulationSpeed({world,onChange}:{world:Snapshot;onChange:(dayMinutes:number)=>Promise<unknown>}){
  const id=useId();
  const target=30/world.dayMinutes;
  const [draft,setDraft]=useState<number|null>(null);
  const [error,setError]=useState('');
  const value=draft??target;
  useEffect(()=>{
    if(draft!==null&&Math.abs(draft-target)<.001)setDraft(null);
  },[draft,target]);
  useEffect(()=>{
    if(draft===null||Math.abs(draft-target)<.001)return;
    let active=true;
    const timer=setTimeout(()=>{
      void onChange(30/draft).catch(e=>{if(active){setError((e as Error).message);setDraft(null);}});
    },200);
    return()=>{active=false;clearTimeout(timer);};
  },[draft,onChange,target]);
  const paused=world.status!=='running_live';
  const actual=paused?0:world.timing?.actualMultiplier??0;
  const status=paused?'已暂停':world.laboratory?.active?'实验中，时间冻结':world.timing?.waitingForApi?'关键节点同步中':Object.values(world.performance?.active??{}).some(n=>n>0)?'异步决策，行动继续':'按目标推进';
  return <div className="speed-control" aria-label="模拟速率">
    <div className="speed-label"><label htmlFor={id}><Clock3 size={14}/> 目标速率</label><output htmlFor={id}>{value.toFixed(2)}×</output></div>
    <input id={id} type="range" min="0.25" max="6" step="0.25" value={value}
      aria-valuetext={`${value.toFixed(2)} 倍，目标每游戏日 ${(30/value).toFixed(1)} 分钟`}
      aria-describedby={`${id}-actual ${id}-hint`} onChange={e=>{setError('');setDraft(Number(e.target.value));}}/>
    <div id={`${id}-actual`} className="speed-actual"><span>实际 <strong>{actual.toFixed(2)}×</strong></span><span>{status}</span></div>
    <p id={`${id}-hint`} className="speed-hint">1× = 30 分钟 / 天 · 实际取近 5 秒均值</p>
    {error&&<p className="speed-error" role="alert">{error}</p>}
  </div>;
}
