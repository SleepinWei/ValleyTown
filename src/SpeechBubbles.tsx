import { useEffect, useRef, useState } from 'react';
import type { Snapshot, SpeechBubble } from '../shared/types';
import type { ViewState } from './three/TownRenderer';

export function SpeechBubbles({snapshot,view,width,height}:{snapshot:Snapshot;view:ViewState;width:number;height:number}){
 const latest=useRef(snapshot);latest.current=snapshot;
 const seen=useRef(new Map<string,number>()),clock=useRef(0),last=useRef(performance.now());
 const [,redraw]=useState(0);
 useEffect(()=>{const timer=setInterval(()=>{const now=performance.now();if(latest.current.status.startsWith('running'))clock.current+=(now-last.current)/1000;last.current=now;redraw(n=>n+1);},150);return()=>clearInterval(timer);},[]);
 // Changing views must discard invisible/private messages immediately.
 const candidates=(snapshot.bubbles??[]).filter(b=>{
  if(!seen.current.has(b.id))seen.current.set(b.id,clock.current);
  return b.pending||clock.current-seen.current.get(b.id)!<Math.max(7,Math.min(16,b.text.length*.16));
 });
 for(const id of seen.current.keys())if(!snapshot.bubbles?.some(b=>b.id===id))seen.current.delete(id);
 if(view.overview||!width||!height)return null;
 const placed:{bubble:SpeechBubble;x:number;y:number;w:number;h:number;name:string}[]=[];
 // Committed dialogue takes visual priority over pending dots; nearby bubbles stack upwards.
 for(const b of [...candidates].sort((a,b)=>Number(a.pending)-Number(b.pending)).slice(0,8)){
  const anchor=view.labels.find(l=>l.actor&&l.id===b.actorId);if(!anchor)continue;
  const name=b.actorId==='player'?'你':snapshot.actors.find(a=>a.id===b.actorId)?.name??'';
  const w=b.pending?100:Math.min(width<640?200:228,width-32),h=b.pending?42:Math.min(150,58+Math.ceil(Math.min(b.text.length,160)/16)*18);
  const x=Math.max(8,Math.min(width-w-(width<640?112:8),anchor.x/100*width-w/2));let y=Math.max(80,anchor.y/100*height-h-15);
  for(let n=0;n<4&&placed.some(p=>x<p.x+p.w+6&&x+w+6>p.x&&y<p.y+p.h+6&&y+h+6>p.y);n++)y-=h+10;
  if(y<70||placed.length>=4)continue;
  placed.push({bubble:b,x,y,w,h,name});
 }
 return <div className="speech-layer" aria-label="角色头顶对白">{placed.map(({bubble:b,x,y,w,name})=><div key={b.id} className={`speech-bubble ${b.pending?'pending':''}`} style={{left:x,top:y,width:w}} title={b.pending?`${name}正在思考回应`:`${name}：${b.text}\n${b.source}`}><div className="speech-name">{name}{!b.pending&&<small>{b.source.includes('规则')?'演示对白':b.source.includes('模板')?'意图模板':b.source==='玩家'?'玩家':'对白'}</small>}</div>{b.pending?<span className="speech-dots" aria-label="正在思考回应"><i/><i/><i/></span>:<p>{b.text.length>160?b.text.slice(0,160)+'…':b.text}</p>}</div>)}</div>;
}
