import { api } from './runtime/client';
import { useEffect, useState } from 'react';
import { actionCategoryNames, type ActionCategory, type ActionPolicyView } from '../shared/actions';
import { timeOf } from '../shared/types';
export function ActionPolicy({actorId}:{actorId:string}){
 const [data,setData]=useState<ActionPolicyView|null>(null),[error,setError]=useState('');
 useEffect(()=>{let ended=false,busy=false;setData(null);setError('');const refresh=async()=>{if(busy)return;busy=true;try{const value=await api<ActionPolicyView>(`/action-policy/${encodeURIComponent(actorId)}`);if(!ended){setData(value);setError('');}}catch(e){if(!ended)setError((e as Error).message);}finally{busy=false;}};void refresh();const timer=setInterval(()=>void refresh(),1500);return()=>{ended=true;clearInterval(timer);};},[actorId]);
 if(!data)return <p role="status">{error||'正在读取动作与规划策略…'}</p>;
 const p=data.planning;
 return <section className="action-policy">
   <div className="lab-protocol"><b>本地生成动作 → Jev 选择 → 本地持续执行</b><p>抵达后先执行 Jev 已批准的活动，条件失效、活动完成或重要变化时再决策。工作、休息与阅读期间不重复请求；移动与动画不调用模型。每次最多提供 24 个具体候选。</p><p>DS 阶段目标在条件未变时复用最多 3 天。重大变化才开放重规划，每人每天最多一次，至少间隔 6 游戏小时且 60 秒。失败保留原目标，网络层仍有一次回退。NPC 每段交谈最多一次 DS 表达，玩家开放式回复按需生成。</p></div>
   <div className="lab-metrics"><div><small>当日阶段目标</small><strong>{p.plannedDay===p.day?'本日更新':p.lastPlannedAt>=0?'沿用目标':'等待更新'}</strong><span>第 {p.day} 天 · {data.mode==='demo'?'本地规则计划':'DeepSeek 计划'}</span></div><div><small>今日规划逻辑调用</small><strong>{p.callsToday}</strong><span>{data.mode==='demo'?'规则演示，不调用模型':'包含规划重试，HTTP 重试另计'}</span></div><div><small>Jev 请求重规划</small><strong>{p.replanCount} / 1</strong><span>每日上限</span></div><div><small>日终记忆</small><strong>{data.reflection==='local'?'本地摘录':'模型反思'}</strong><span>{data.reflection==='local'?'仅摘录已记录的本人经历':'DeepSeek 单独调用'}</span></div></div>
   <p><b>规划状态：</b>{p.request?`${p.inFlight?'请求中':'已排队'} · ${p.request.kind==='daily'?'日初规划':'Jev 请求重规划'} · 已尝试 ${p.request.attempts} 次`:'无在途规划'}</p>
   <p className="lab-note">最近规划原因：{p.lastReason}。重规划候选：{data.canReplan?'当前开放':'暂未开放'} · {data.replanReason}。</p>
   {data.localTask&&<div className="trace-events"><b>本地持续执行中</b><p>{data.localTask.candidate.label} · 游戏时间 {timeOf(data.localTask.endsAt)} 完成；无需逐帧调用 Jev 或 DS。</p></div>}
   {p.issues.length>0&&<details><summary>角色感知到的计划变化</summary>{p.issues.map(i=><p key={i.code}>{i.detail}</p>)}</details>}
   <h3>当前位置满足条件的动作</h3><p className="lab-note">每项由预定义规则生成。若角色仍在移动、交谈或执行任务，会等当前行动结束后再请求 Jev；返回后仍须重新校验。</p>
   {(Object.keys(actionCategoryNames) as ActionCategory[]).map(category=>{const rows=Object.entries(data.candidates).filter(([,c])=>c.category===category);return <div className="policy-category" key={category}><h4>{actionCategoryNames[category]} <span>{rows.length}</span></h4>{rows.length?<div className="candidate-list">{rows.map(([key,c])=><div key={key}><span>{c.label}</span><code>{key}</code></div>)}</div>:<p className="lab-note">当前没有满足条件的候选。</p>}</div>;})}
   <details><summary>预定义动作目录（{data.catalog.length} 类能力）</summary>{data.catalog.map(d=><p key={d.id}><b>{actionCategoryNames[d.category]}</b> · {d.description}</p>)}</details>
   <details><summary>DeepSeek 各用途用量 · 全部历史</summary><p className="lab-note">规划、文字表达、反思和基准测试分开统计。不能把对白消耗算作日常规划消耗，旧版规划记录也不会清零。</p><div className="candidate-list">{data.usage.map(u=><div key={u.purpose}><span>{({'daily-plan':'阶段目标复核',replan:'Jev 请求重规划',plan:'旧版阶段规划',dialogue:'对白生成',reflection:'模型日终反思','benchmark-action':'对照实验'} as Record<string,string>)[u.purpose]??u.purpose}</span><b>{u.calls} 次 HTTP · {(u.input+u.output).toLocaleString()} token</b></div>)}</div></details>
   {error&&<p className="warning" role="alert">{error}</p>}
 </section>;
}
