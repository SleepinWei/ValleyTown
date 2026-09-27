import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Download, RefreshCw, Sparkles } from 'lucide-react';
import { dayOf, timeOf } from '../shared/types';
import type { ActorStory as Story, StoryJob, StoryRecord, StoryView } from '../shared/story';
import './actor-story.css';

async function request<T>(path:string,method='GET',signal?:AbortSignal):Promise<T>{
  const r=await fetch(`/api${path}`,{method,signal});const result=await r.json();if(!r.ok)throw new Error(result.error??'无法读取故事');return result;
}
const date=(at:number)=>`第 ${dayOf(at)} 天 · ${timeOf(at)}`;
const perspective=(r:StoryRecord)=>({event:'事件记录',experience:'亲身经历',belief:'个人认知 / 转述，未证实',reflection:'本人反思',commitment:'约定与回应'})[r.perspective];

export function ActorStory({actorId,view}:{actorId:string;view:StoryView}){
  const [story,setStory]=useState<Story|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[starting,setStarting]=useState(false),[job,setJob]=useState<string|null>(null);
  const [expanded,setExpanded]=useState<Set<number>>(new Set()),[source,setSource]=useState<string[]|null>(null),[revision,setRevision]=useState(0);
  const evidenceRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(source)evidenceRef.current?.scrollIntoView({block:'nearest'});},[source]);
  const query=`?view=${view}`;
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
    request<Story>(`/stories/${encodeURIComponent(actorId)}${query}`,'GET',controller.signal).then(setStory).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[actorId,view,revision]);
  useEffect(()=>{if(!job)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const result=await request<StoryJob>(`/story-jobs/${job}${query}`,'GET',controller.signal);if(controller.signal.aborted)return;
      if(result.status==='running'){timer=setTimeout(poll,1500);return;}
      setJob(null);if(result.status==='failed')setError(result.error??'生成失败，可重试。');else setStory(result.story);
    }catch(e){if(!controller.signal.aborted){setJob(null);setError((e as Error).message);}}};void poll();
    return()=>{controller.abort();clearTimeout(timer);};
  },[job,view]);
  const generate=async()=>{setStarting(true);setError('');try{const result=await request<StoryJob>(`/stories/${encodeURIComponent(actorId)}${query}`,'POST');setStory(result.story);if(result.status==='running')setJob(result.id);else if(result.status==='failed')setError(result.error??'生成失败');}catch(e){setError((e as Error).message);}finally{setStarting(false);}};
  const busy=starting||!!job;
  const download=()=>{if(!story)return;const text=[`# ${story.narrative?.title??`${story.name}的小镇故事`}`,`截至${date(story.asOf)} · ${view==='observer'?'观察者档案':'游玩视角'}`,story.coverageNote,story.summary,...(story.narrative?.paragraphs.map(p=>`${p.text}\n\n来源：${p.ids.join('、')}`)??[]),'## 值得回看的时刻',...highlighted.map(({record:r,reason})=>`- ${date(r.at)} · ${r.label}：${r.text}${reason?`\n  值得回看：${reason}`:''}\n  来源：${r.id}`),'## 完整时间线',...story.chapters.map(c=>`### 第 ${c.day} 天\n\n${c.records.map(r=>`- ${timeOf(r.at)} [${perspective(r)}] ${r.text}\n  记录编号：${r.id}`).join('\n')}`)].join('\n\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`${story.name}-人物故事.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  if(loading&&!story)return <p className="story-loading" role="status">正在翻阅这个人的全部经历…</p>;
  if(!story)return <div className="story-error" role="alert"><p>{error}</p><button className="outline" onClick={()=>setRevision(v=>v+1)}>重新读取</button></div>;
  const records=new Map(story.chapters.flatMap(c=>c.records).map(r=>[r.id,r]));
  const selected=source?.map(id=>records.get(id)).filter((r):r is StoryRecord=>!!r);
  const highlighted=story.narrative?.highlights.length?story.narrative.highlights.flatMap(h=>{const r=records.get(h.id);return r?[{record:r,reason:h.reason}]:[];}):story.highlights.map(record=>({record,reason:''}));
  return <section className="actor-story">
    <div className="story-cover"><span className="story-eyebrow">溪谷人物志 · {view==='observer'?'完整记录视角':'你所知道的故事'}</span><h3>{story.narrative?.title??`${story.name}，在溪谷的日子`}</h3><p>{story.role} · 截至{date(story.asOf)}</p><div className="story-stats"><span><b>{story.total}</b> 条记录</span><span><b>{story.days}</b> 个有故事的日子</span><span><b>{highlighted.length}</b> 个回看时刻</span></div></div>
    <div className="story-toolbar"><button className="primary" disabled={busy||!story.canGenerate||!story.total} onClick={()=>void generate()}><Sparkles size={15}/>{busy?'正在写故事…':story.narrative?'重新整理叙事':'AI 写成故事'}</button><button className="outline" disabled={busy||loading} onClick={()=>{setSource(null);setRevision(v=>v+1);}}><RefreshCw size={14}/> 更新记录</button><button className="outline" onClick={download}><Download size={14}/> 导出</button></div>
    <p className="story-note">{story.canGenerate?'AI 叙事使用 DeepSeek，计入 DeepSeek 人民币金额池；相同记录复用结果。':'当前为本地整理，可直接查看全时段故事；AI 叙事需真实模型模式并配置 DeepSeek。'}</p>
    {busy&&<p className="story-progress" role="status">正在从整段时间线里寻找故事的脉络。关闭后仍会继续整理。</p>}
    {error&&<p className="story-error" role="alert">{error}</p>}
    <p className="story-coverage">{story.coverageNote}</p>
    <div className="story-narrative"><h4><BookOpen size={17}/> {story.narrative?'故事正文':'一路走来的故事'}</h4><p>{story.summary}</p>{story.narrative?.paragraphs.map((p,i)=><div key={i}><p>{p.text}</p><button className="story-source" onClick={()=>setSource(p.ids)}>查看这一段的 {p.ids.length} 条依据</button></div>)}{story.narrative&&<small>AI 叙事 · {story.narrative.model} · {story.narrative.input+story.narrative.output} tokens · 可对照原始记录阅读</small>}</div>
    {selected&&<div className="story-evidence" ref={evidenceRef}><div><b>原始依据</b><button className="outline" onClick={()=>setSource(null)}>收起依据</button></div>{selected.map(r=><article key={r.id}><small>{date(r.at)} · {perspective(r)}</small><p>{r.text}</p></article>)}</div>}
    <div className="story-section-heading"><h4>值得回看的时刻</h4><span>从整段经历中挑选</span></div>
    {highlighted.length?<div className="story-highlights">{highlighted.map(({record:r,reason},i)=><article key={r.id}><div className="story-highlight-meta"><span>{String(i+1).padStart(2,'0')} / {r.label}</span><time>{date(r.at)}</time></div><p><mark>{r.text}</mark></p>{reason&&<p className="story-highlight-reason">{reason}</p>}<button className="story-source" onClick={()=>setSource([r.id])}>查看原始记录</button></article>)}</div>:<p className="story-note">还没有足够的亲历记录可供挑选。让故事慢慢发生吧。</p>}
    {story.people.length>0&&<div className="story-people"><h4>故事里常出现的人</h4>{story.people.map(p=><span key={p.id}>{p.name}<small>{p.count} 次共同记录</small></span>)}<p className="story-note">出现次数反映记录中的交集，不代表关系亲密程度。</p></div>}
    <div className="story-section-heading"><h4>完整时间线</h4><span>按天展开全部记录</span></div>
    <div className="story-chapters">{story.chapters.map(c=><article key={c.day}><button className="story-chapter-toggle" aria-expanded={expanded.has(c.day)} onClick={()=>setExpanded(previous=>{const next=new Set(previous);next.has(c.day)?next.delete(c.day):next.add(c.day);return next;})}><b>第 {c.day} 天</b><span>{c.count} 条记录</span><ChevronDown size={16}/></button><p className="story-chapter-summary">{c.summary}</p>{expanded.has(c.day)&&<ol>{c.records.map(r=><li key={r.id}><time>{timeOf(r.at)}</time><div><small>{perspective(r)}</small><p>{r.text}</p></div></li>)}</ol>}</article>)}</div>
  </section>;
}
