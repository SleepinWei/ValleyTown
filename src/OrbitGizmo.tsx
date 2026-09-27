import { useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import './orbit-gizmo.css';

type Props={yaw:number;pitch:number;onOrbit:(yaw:number,pitch:number)=>void;onReset:()=>void};
export function OrbitGizmo({yaw,pitch,onOrbit,onReset}:Props){
  const help=useId(),drag=useRef<{id:number;x:number;y:number;cx:number;cy:number;angle:number;ring:boolean}|null>(null);
  const [dragging,setDragging]=useState(false);
  const degrees=Math.round(((yaw*180/Math.PI)%360+360)%360)%360;
  const down=(e:PointerEvent<HTMLDivElement>)=>{
    if(e.button!==0||drag.current)return;
    e.preventDefault();e.stopPropagation();e.currentTarget.focus();
    const box=e.currentTarget.getBoundingClientRect(),cx=box.left+box.width/2,cy=box.top+box.height/2;
    drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,cx,cy,angle:Math.atan2(e.clientY-cy,e.clientX-cx),ring:Math.hypot(e.clientX-cx,e.clientY-cy)>box.width*.34};
    e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);
  };
  const move=(e:PointerEvent<HTMLDivElement>)=>{
    const d=drag.current;if(!d||e.pointerId!==d.id)return;e.preventDefault();e.stopPropagation();
    if(d.ring){const angle=Math.atan2(e.clientY-d.cy,e.clientX-d.cx),delta=angle-d.angle;onOrbit(Math.atan2(Math.sin(delta),Math.cos(delta)),0);d.angle=angle;}
    else onOrbit((e.clientX-d.x)*.012,-(e.clientY-d.y)*.008);
    d.x=e.clientX;d.y=e.clientY;
  };
  const stop=(e:PointerEvent<HTMLDivElement>)=>{if(drag.current?.id!==e.pointerId)return;drag.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);};
  const key=(e:KeyboardEvent<HTMLDivElement>)=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();const step=e.shiftKey?.04:.15;
    if(e.key==='Home')onReset();else onOrbit(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0);
  };
  const axes=[{label:'X',color:'#b7594f',v:[1,0,0]},{label:'Y',color:'#608653',v:[0,1,0]},{label:'Z',color:'#577fa4',v:[0,0,1]}].flatMap(axis=>[-1,1].map(sign=>{
    const [x,y,z]=axis.v.map(n=>n*sign);
    return {...axis,sign,x:54+(x*Math.cos(yaw)-z*Math.sin(yaw))*25,y:54+(x*Math.sin(pitch)*Math.sin(yaw)-y*Math.cos(pitch)+z*Math.sin(pitch)*Math.cos(yaw))*25,depth:x*Math.cos(pitch)*Math.sin(yaw)+y*Math.sin(pitch)+z*Math.cos(pitch)*Math.cos(yaw)};
  })).sort((a,b)=>a.depth-b.depth);
  return <div className={`orbit-gizmo${dragging?' dragging':''}`}>
    <div className="orbit-disc" role="slider" tabIndex={0} aria-label="视角旋转环" aria-valuemin={0} aria-valuemax={360} aria-valuenow={degrees} aria-valuetext={`水平 ${degrees} 度，俯角 ${Math.round(pitch*180/Math.PI)} 度`} aria-describedby={help}
      title="拖动外环旋转 · 拖动中央调整俯仰 · 双击复位" onPointerDown={down} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={()=>{drag.current=null;setDragging(false);}} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();onReset();}} onKeyDown={key}>
      <svg viewBox="0 0 108 108" aria-hidden="true">
        <circle className="orbit-back" cx="54" cy="54" r="51"/>
        <circle className="orbit-track" cx="54" cy="54" r="43"/>
        {Array.from({length:24},(_,i)=><line key={i} className="orbit-tick" x1="54" y1={i%6===0?7:9} x2="54" y2="13" transform={`rotate(${i*15} 54 54)`}/>)}
        <circle className="orbit-inner" cx="54" cy="54" r="33"/>
        {axes.map(a=><g key={`${a.label}${a.sign}`} opacity={a.sign<0?.4:1}>
          <line x1="54" y1="54" x2={a.x} y2={a.y} stroke={a.color} strokeWidth={a.sign>0?2.3:1.3}/>
          <circle cx={a.x} cy={a.y} r={a.sign>0?8:4} fill={a.sign>0?a.color:'#e8ebdf'} stroke={a.color}/>
          {a.sign>0&&<text x={a.x} y={a.y+.5}>{a.label}</text>}
        </g>)}
        <circle cx="54" cy="54" r="3" fill="#faf7e9" stroke="#8a9b7c"/>
        <g transform={`rotate(${degrees} 54 54)`}><circle className="orbit-handle" cx="54" cy="11" r="4"/></g>
      </svg>
    </div>
    <span className="orbit-caption" aria-hidden="true">拖动旋转 <b>{degrees}°</b></span>
    <span id={help} className="orbit-help">外环拖动水平旋转，中央拖动调整水平与俯仰。方向键调整，Shift 微调，Home 或双击恢复初始视角。</span>
  </div>;
}
