import { ActionPolicy } from './ActionPolicy';
import { actionCategoryNames } from '../shared/actions';
import { useEffect, useState } from 'react';
import { Activity, FlaskConical, ArrowRight, Download, Pause, Play } from 'lucide-react';
import type { Snapshot } from '../shared/types';
import { labStats, percentile, type ActionTrace, type LabRun, type LabScenario } from '../shared/telemetry';
import './decision-lab.css';
const ms=(n:number|null|undefined)=>n==null?'—':`${(n/1000).toFixed(2)} s`;
const statusText:Record<ActionTrace['status'],string>={requesting:'请求中',deferred:'暂停暂存',applied:'已交给游戏执行',overridden:'规则替换后执行',rejected:'执行被拒绝',failed:'模型请求失败',interrupted:'进程中断 · 待核对'};
const scenarios:Record<LabScenario,string>={baseline:'相同情境 · 检查波动',rain:'晴天 → 雷雨',tired:'精力 75 → 12',enemy:'普通邻居 → 高怨恨',lover:'普通邻居 → 亲密关系与邀请'};
async function api<T>(path:string,body?:unknown):Promise<T>{const r=await fetch(`/api${path}`,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error??'请求失败');return data;}

export function TraceDetail({trace}:{trace:ActionTrace}){
  const attempts=trace.attempts,requestMs=attempts.reduce((n,a)=>n+a.latency,0),tokens=attempts.reduce((n,a)=>n+a.input+a.output,0);
  return <article className="trace-detail">
    <div className="lab-section-heading"><b>{trace.source}</b><span className={`trace-status ${trace.status}`}>{statusText[trace.status]}</span><time>{new Date(trace.startedAt).toLocaleTimeString()}</time></div>
    <div className="trace-flow"><div><small>感知事实</small><p>{trace.facts.weather} · 精力 {trace.facts.energy} · {trace.facts.region}</p></div><ArrowRight size={16}/><div><small>模型选择</small><p>{trace.selected?trace.candidates[trace.selected]??trace.selected:'尚无有效选择'}</p></div><ArrowRight size={16}/><div><small>执行结果</small><p>{trace.status==='rejected'||trace.status==='failed'?'未执行':trace.activity??'等待校验'}</p></div></div>
    <p className="lab-note">决策触发：{trace.facts.trigger??'旧记录未单独标注'}</p>
    <p className="lab-note">{trace.reason??'等待模型返回，当前画面移动无需逐帧调用模型。'}</p>
    <dl className="trace-timing"><div><dt>排队</dt><dd>{ms(trace.queueMs)}</dd></div><div><dt>完整模型调用</dt><dd>{ms(trace.finishedAt?trace.modelMs:undefined)}</dd></div><div><dt>返回后等待 / 校验</dt><dd>{ms(trace.deferredMs)}</dd></div><div><dt>就绪 → 结果</dt><dd>{ms(trace.totalMs)}</dd></div></dl>
    <p className="lab-note">{attempts.length} 次 HTTP 尝试 · {Math.max(0,attempts.length-1)} 次重试 · {tokens.toLocaleString()} 已知 token{attempts.some(a=>a.reserved>0)?' · 部分用量待核对':''}。完整模型调用包含重试、退避与响应校验；暂停暂存计入就绪到结果的耗时。</p>
    <details><summary>候选动作与模型返回分数（{Object.keys(trace.candidates).length}）</summary><div className="candidate-list">{Object.entries(trace.candidates).sort(([a],[b])=>(trace.probabilities[b]??-1)-(trace.probabilities[a]??-1)).map(([key,label])=><div key={key}><span>{trace.candidateCategories?.[key]?`[${actionCategoryNames[trace.candidateCategories[key]]}] `:''}{key===trace.selected?'模型选择 · ':''}{key===trace.effective?'实际采用 · ':''}{label}</span><b>{trace.probabilities[key]===undefined?'—':`${(trace.probabilities[key]*100).toFixed(1)}%`}</b></div>)}</div></details>
    <details><summary>阶段目标与请求明细</summary><p>{trace.facts.plan}</p><p className="lab-note">HTTP 合计 {ms(requestMs)}；其余为退避、校验和本地处理，未单独估算网络外的模型推理时间。</p>{attempts.map((a,i)=><p className="lab-note" key={a.id}>第 {i+1} 次 · {a.model} · {a.status} · {ms(a.latency)}{a.error?` · ${a.error}`:''}</p>)}</details>
    {trace.events.length===0&&['applied','overridden'].includes(trace.status)&&<p className="lab-note">本次提交尚未产生独立事件，行走到达或后续交谈需继续观察小镇。</p>}
    {trace.events.length>0&&<div className="trace-events"><b>本次执行产生的事件</b>{trace.events.map(e=><p key={e.id}>{e.text}</p>)}</div>}
  </article>;
}

export function DecisionLab({world,selected}:{world:Snapshot;selected:string}){
  const [tab,setTab]=useState<'live'|'experiment'|'policy'>('live'),[actorId,setActorId]=useState(selected),[scenario,setScenario]=useState<LabScenario>('rain'),[repeats,setRepeats]=useState(3),[paired,setPaired]=useState(true),[profile,setProfile]=useState<'synthetic'|'resident'>('synthetic');
  const [data,setData]=useState<{runs:LabRun[];traces:ActionTrace[]}>({runs:[],traces:[]}),[error,setError]=useState(''),[sending,setSending]=useState(false),[traceId,setTraceId]=useState(''),[runId,setRunId]=useState('');
  useEffect(()=>{let stopped=false,pending=false;const refresh=async()=>{if(pending)return;pending=true;try{const r=await api<typeof data>('/decision-lab');if(!stopped)setData(r);}catch(e){if(!stopped)setError((e as Error).message);}finally{pending=false;}};void refresh();const timer=setInterval(()=>void refresh(),1200);return()=>{stopped=true;clearInterval(timer);};},[]);
  const traces=data.traces.filter(t=>t.actorId===actorId),trace=traces.find(t=>t.id===traceId)??traces[0],run=data.runs.find(r=>r.id===runId)??data.runs[0];
  const settled=data.traces.filter(t=>t.mode==='live'&&['applied','overridden','rejected','failed'].includes(t.status));
  const submitted=settled.filter(t=>t.status==='applied'||t.status==='overridden'),valid=settled.filter(t=>t.selected);
  const busy=!!world.laboratory?.active,playing=world.status.startsWith('running'),active=Object.values(world.performance.active).reduce((n,v)=>n+v,0);
  const start=async()=>{setSending(true);setError('');try{const r=await api<{id:string}>('/decision-lab',{actorId,scenario,repeats,paired,profile});setRunId(r.id);setData(await api('/decision-lab'));}catch(e){setError((e as Error).message);}finally{setSending(false);}};
  const stop=async()=>{try{await api('/decision-lab/stop',{});}catch(e){setError((e as Error).message);}};
  const download=()=>{if(!run)return;const url=URL.createObjectURL(new Blob([JSON.stringify(run,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`valley-decision-${run.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <div className="decision-lab">
    <p className="lab-intro">看见 Jev 如何影响居民，用相同任务检验速度。走路与动画由本地游戏持续执行，FPS 不作为模型速度指标。</p>
    <div className="lab-tabs" role="group" aria-label="决策实验室视图"><button className={tab==='live'?'active':''} onClick={()=>setTab('live')}><Activity size={16}/> 实时执行追踪</button><button className={tab==='experiment'?'active':''} onClick={()=>setTab('experiment')}><FlaskConical size={16}/> 情境与速度对照</button><button className={tab==='policy'?'active':''} onClick={()=>setTab('policy')}>动作与规划</button></div>
    {error&&<p className="warning" role="alert">{error}</p>}
    <label className="lab-actor">观察居民<select value={actorId} onChange={e=>{setActorId(e.target.value);setTraceId('');}}>{world.actors.map(a=><option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}</select></label>
    {tab==='policy'?<ActionPolicy actorId={actorId}/>:tab==='live'?<>
      <div className="lab-metrics"><div><small>有有效模型选择</small><strong>{settled.length?`${Math.round(valid.length/settled.length*100)}%`:'—'}</strong><span>{valid.length} / {settled.length} 次逻辑决策</span></div><div><small>交给游戏执行</small><strong>{submitted.length}</strong><span>含规则替换 {settled.filter(t=>t.status==='overridden').length} 次</span></div><div><small>就绪 → 结果 P50</small><strong>{ms(percentile(settled.map(t=>t.totalMs??0),.5))}</strong><span>包含失败与暂停等待</span></div><div><small>就绪 → 结果 P95</small><strong>{ms(percentile(settled.map(t=>t.totalMs??0),.95))}</strong><span>含失败，避免隐藏长尾</span></div></div>
      <p className="lab-note">仅统计加入追踪后的最近 200 条记录中的真实行动决策，规则演示不计入。游戏接受动作不等于已到达目的地或对方同意；历史成功请求耗时不混入本统计。</p>
      <label className="lab-actor">决策记录<select value={trace?.id??''} onChange={e=>setTraceId(e.target.value)}><option value="" disabled>尚无记录</option>{traces.map(t=><option key={t.id} value={t.id}>{new Date(t.startedAt).toLocaleTimeString()} · {statusText[t.status]} · {t.selected??'等待结果'}</option>)}</select></label>
      {trace?<TraceDetail trace={trace}/>:<div className="lab-empty"><Activity size={24}/><p>这位居民尚无新的执行追踪。</p><span>继续小镇模拟，下一次动作决策会显示在这里。</span></div>}
    </>:<>
      <label className="lab-actor">输入来源<select value={profile} onChange={e=>setProfile(e.target.value as 'synthetic'|'resident')}><option value="synthetic">合成测试人物 · 不读取存档数据</option><option value="resident">所选居民快照 · 包含本人私有记忆</option></select></label>
      <div className="lab-experiment-controls"><label>情境变化<select value={scenario} onChange={e=>setScenario(e.target.value as LabScenario)}>{Object.entries(scenarios).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><label>每种情境重复<select value={repeats} onChange={e=>setRepeats(Number(e.target.value))}>{[1,3,5,10].map(n=><option key={n} value={n}>{n} 次</option>)}</select></label><label>参与模型<select value={paired?'paired':'jev'} onChange={e=>setPaired(e.target.value==='paired')}><option value="paired">Jev 与 DeepSeek</option><option value="jev">仅 Jev · 行为演示</option></select></label></div>
      <div className="lab-protocol"><b>固定输入 · 相同候选 · 每个模型并发 1</b><p>{profile==='synthetic'?'使用内置合成人物，不读取存档中的角色、记忆或秘密。':'使用所选居民的人设、私有动机和部分本人记忆，运行时会发送给参与模型的 API。'}用固定的 7 个意图进行实验。基线为晴天、精力 75、普通邻居；仅改变所选情境。候选集保持不变，观察模型选择；真实小镇执行时还会过滤不合法动作。</p><p>两个模型都只选一个动作，DeepSeek 使用 JSON、关闭思考，输出上限 64 token；Jev 使用原生 Choice（会额外返回分数）。这衡量当前 API 配置的完整调用性能，不是底层模型推理的纯耗时。</p><p>实验不推进世界或提交动作，完成后保持暂停。费用分别计入 Jev 与 DeepSeek 各自的人民币金额池。预计 {repeats*2*(paired?2:1)} 次逻辑请求，失败重试另计。</p></div>
      <div className="button-row">{busy?<button className="primary" onClick={()=>void stop()}><Pause size={15}/> 停止实验</button>:<button className="primary" disabled={sending||playing||active>0||world.mode!=='live'} onClick={()=>void start()}><Play size={15}/>{sending?'正在启动…':'运行快照实验'}</button>}{playing&&!busy&&<button className="outline" onClick={()=>void stop()}><Pause size={15}/> 暂停小镇以准备实验</button>}<span className="lab-note">{busy?`实验进度 ${world.laboratory?.completed} / ${world.laboratory?.total} · 世界时钟冻结`:world.mode!=='live'?'先在设置中切换真实 Agent 模式':playing||active?'暂停并等在途请求结算后可运行':'小镇暂停中，可运行实验'}</span></div>
      {data.runs.length>0&&<label className="lab-actor">实验记录<select value={run?.id??''} onChange={e=>setRunId(e.target.value)}>{data.runs.map(r=><option value={r.id} key={r.id}>{new Date(r.created).toLocaleString()} · {r.actorName} · {scenarios[r.scenario]}</option>)}</select></label>}
      {run&&<section className="lab-results"><div className="lab-section-heading"><h3>{run.actorName} · {scenarios[run.scenario]}</h3><span>{({running:'实验进行中',stopping:'等待在途请求结算',complete:'已完成',cancelled:'已停止',interrupted:'进程中断'})[run.status]}</span><button className="outline" onClick={download}><Download size={14}/> 导出 JSON</button></div><p className="lab-note">当前展示的是上方选中的历史实验。停止和中断的样本不计为成功或失败；已发出且失败的请求计入统计。</p>
        <div className="lab-comparison">{(run.paired?['Jev','DeepSeek']:['Jev']).map(provider=>{const s=labStats(run,provider as 'Jev'|'DeepSeek');return <article key={provider}><h3>{provider}</h3><strong>{ms(s.p50)}<small>完整调用 P50 · 含失败</small></strong><dl><div><dt>P95 · 含失败</dt><dd>{ms(s.p95)}</dd></div><div><dt>成功调用 P50</dt><dd>{ms(s.successP50)}</dd></div><div><dt>最终合法选择率</dt><dd>{s.rate===null?'—':`${Math.round(s.rate*100)}%`} ({s.success}/{s.count})</dd></div><div><dt>每分钟有效决策¹</dt><dd>{s.perMinute?.toFixed(1)??'—'}</dd></div><div><dt>排队 P50 / 全程 P95</dt><dd>{ms(s.queueP50)} / {ms(s.totalP95)}</dd></div><div><dt>HTTP 尝试 / 重试</dt><dd>{s.attempts} / {s.retries}</dd></div><div><dt>已知 token / 待核对预留</dt><dd>{s.tokens.toLocaleString()} / {s.reserved.toLocaleString()}</dd></div></dl></article>;})}</div>
        <p className="lab-note">¹ 单请求通道能力 = 有效选择数 ÷ 全部已结算调用耗时总和，包含失败与重试时间；不是 24 人小镇实测吞吐量。排队从本批入队起计算，全程终点是合法选择返回或失败，不含游戏执行。小样本 P95 仅作观察，不自动宣布谁更快。</p>
        <div className="lab-table-wrap" tabIndex={0} role="region" aria-label="逐次实验结果"><table><thead><tr><th>轮次 / 情境</th><th>模型</th><th>选择</th><th>完整调用</th><th>结果</th></tr></thead><tbody>{run.samples.map(s=><tr key={s.id}><td>{s.pair+1} · {s.variant==='before'?'基线':'变化后'}</td><td>{s.provider}</td><td>{s.choice?run.inputs[s.variant].candidates[s.choice]:'—'}</td><td>{ms(s.modelMs)}</td><td>{({queued:'排队',running:'请求中',complete:'合法选择',failed:'失败',cancelled:'已取消',interrupted:'已中断'})[s.status]}{s.error&&<small>{s.error}</small>}</td></tr>)}</tbody></table></div>
        <details><summary>核对模型实际输入与快照指纹（观察者私有）</summary><p className="lab-note">两种模型各自使用相同的 state、instructions 和 candidates；包装格式不同。{run.profile==='synthetic'?'本次仅含内置合成数据。':'本次含选中居民自己的私有记忆，导出也包含这些内容。'}</p>{(['before','after'] as const).map(key=><div key={key}><h4>{key==='before'?'基线':'变化后'} · {run.inputs[key].hash.slice(0,16)}</h4><pre>{JSON.stringify(run.inputs[key],null,2)}</pre></div>)}</details>
      </section>}
      {!run&&<div className="lab-empty"><FlaskConical size={24}/><p>还没有实验结果。运行后会逐条显示返回与失败记录。</p></div>}
    </>}
  </div>;
}
