import { OrbitGizmo } from './OrbitGizmo';
import { SpeechBubbles } from './SpeechBubbles';
import { useEffect, useRef, useState } from 'react';
import { Sun, Cloud, Moon, CloudRain, CloudFog, CloudLightning, Sparkles, Crosshair, Map as MapIcon, Minus, Plus, Users } from 'lucide-react';
import { locations, regions, MAP_W, MAP_H } from '../shared/map';
import { daylight, weatherInfo } from '../shared/weather';
import { timeOf, type Snapshot } from '../shared/types';
import { TownRenderer, type ViewState } from './three/TownRenderer';

type Props={readOnly?:boolean;snapshot:Snapshot;selected:string;onSelect:(id:string)=>void;onMove:(x:number,y:number)=>void;onInteract:()=>void};
export function TownCanvas(props:Props){
  const host=useRef<HTMLDivElement>(null),engine=useRef<TownRenderer|null>(null),latest=useRef(props);latest.current=props;
  const [effects,setEffects]=useState(true),[error,setError]=useState('');
  const [view,setView]=useState<ViewState>({overview:false,labels:[],x:70,y:50,w:80,h:60,yaw:.15,pitch:.70});
  useEffect(()=>{if(!host.current)return;let renderer:TownRenderer;try{renderer=new TownRenderer(host.current,{getWorld:()=>latest.current.snapshot,getSelected:()=>latest.current.selected,select:id=>latest.current.onSelect(id),move:(x,y)=>{if(!latest.current.readOnly)latest.current.onMove(x,y);},interact:()=>{if(!latest.current.readOnly)latest.current.onInteract();},view:setView,error:setError});engine.current=renderer;}catch(e){setError(`无法初始化 Three.js 画面：${(e as Error).message}。请确认浏览器已启用 WebGL 2 后刷新。`);return;}return()=>{engine.current=null;renderer.dispose();};},[]);
  const sky=daylight(props.snapshot.clock),WeatherIcon=props.snapshot.weather==='雷雨'?CloudLightning:props.snapshot.weather==='大雾'?CloudFog:props.snapshot.weather==='细雨'?CloudRain:props.snapshot.weather==='多云'?Cloud:sky.night>.7?Moon:Sun;
  const weather=weatherInfo(props.snapshot.weather);
  const atmosphere=props.snapshot.weather==='雷雨'?'风急雨密 · 水面泛起涟漪':props.snapshot.weather==='大雾'?'薄雾笼罩 · 远山渐隐':props.snapshot.weather==='细雨'?'细雨落水 · 云影低徊':props.snapshot.weather==='多云'?'像素流云 · 光影缓行':sky.night>.7?'月色如水 · 灯火渐暖':sky.warm>.3?(sky.phase==='清晨'?'晨光映水 · 远景柔焦':'暮金映水 · 远景柔焦'):'日光穿云 · 碧波微澜';
  return <div className="town-canvas expanded-map three-map" data-weather={props.snapshot.weather}>
    <div ref={host} className="three-host" role="img" aria-label="Three.js HD-2D 溪谷大地图，像素角色与立体场景"/>
    <div className="world-labels" aria-hidden="true">{view.labels.map(l=><span key={`${l.actor?'actor':'place'}:${l.id}`} className={`${l.actor?'person-label':'place-label'} ${l.id===props.selected?'selected':''} ${view.overview?'region-label':''}`} style={{left:`${l.x}%`,top:`${l.y}%`}}>{l.text}</span>)}</div>
    <SpeechBubbles snapshot={props.snapshot} view={view} width={host.current?.clientWidth??0} height={host.current?.clientHeight??0}/>
    <div className="environment-hud" title={weather.advice} role="status" aria-live="polite" aria-atomic="true">
      <div className="weather-emblem"><WeatherIcon size={23}/></div>
      <div className="environment-copy"><b>{props.snapshot.weather}<span className="weather-phase">{sky.phase} · {timeOf(props.snapshot.clock)}</span></b>
        <span className="weather-atmosphere">{atmosphere}</span>
        <div className="weather-metrics"><span>风力 {weather.wind>=.8?'强风':weather.wind>=.4?'轻风':'微风'}</span><span>能见度 {weather.fog>.4?'低':weather.rain>.7?'较低':'良好'}</span></div>
        {weather.speed<1&&<span className="weather-caution">{props.snapshot.weather==='雷雨'?'暂停露天活动，请就近避雨':props.snapshot.weather==='大雾'?'登山、打猎暂停，留意前路':'路面湿滑，行走速度降低'}</span>}
      </div>
    </div>
    <div className="region-navigation" aria-label="区域导航">{regions.map(r=><button key={r.id} onClick={()=>engine.current?.control('region',r.center)}>{r.name}</button>)}<button onClick={()=>engine.current?.control('region',locations.find(l=>l.id==='prison')!.door)}>司法所 / 监狱</button></div>
    <OrbitGizmo yaw={view.yaw} pitch={view.pitch} onOrbit={(yaw,pitch)=>engine.current?.orbit(yaw,pitch)} onReset={()=>engine.current?.resetOrbit()}/>
    <div className="camera-controls">
      <button title="全域地图" aria-label="全域地图" className={view.overview?'active':''} onClick={()=>engine.current?.control('overview')}><MapIcon size={17}/></button>
      <button title="跟随玩家" aria-label="跟随玩家" onClick={()=>engine.current?.control('player')}><Crosshair size={17}/></button>
      <button title="定位选中居民" aria-label="定位选中居民" onClick={()=>engine.current?.control('selected')}><Users size={17}/></button>
      <button aria-label="放大地图" onClick={()=>engine.current?.control('in')}><Plus size={17}/></button><button aria-label="缩小地图" onClick={()=>engine.current?.control('out')}><Minus size={17}/></button>
      <button aria-label="电影与天气特效" aria-pressed={effects} className={effects?'active':''} title="切换电影调色、景深、柔光与云雨特效" onClick={()=>{engine.current?.setEffects(!effects);setEffects(!effects);}}><Sparkles size={17}/></button>
    </div>
    <div className="map-mode-hint">{view.overview?`溪谷全域 · ${MAP_W} × ${MAP_H} · 点击区域展开探索`:props.readOnly?'拖动浏览 · 滚轮缩放 · 旋转镜头 · 只读观看':'拖动浏览 · 滚轮缩放 · 旋转镜头 · 点击地面行走'}</div>
    {!view.overview&&<button className="mini-map" aria-label="小地图，点击返回全域" onClick={()=>engine.current?.control('overview')}><svg viewBox="0 0 240 180"><rect width="240" height="180" fill="#849a68"/><path d="M0 154 Q65 145 120 155 T240 154 V180 H0Z" fill="#538490"/><ellipse cx="36" cy="94" rx="26" ry="23" fill="#6a9b9b"/><rect x="133" y="36" width="5" height="118" fill="#6a9b9b"/><path d="M0 0H240V40L180 30 130 42 60 30 0 44Z" fill="#8e9984"/>{regions.map(r=><circle key={r.id} cx={r.center.x} cy={r.center.y} r="3" fill="#f5e3b9"/>)}<rect x={view.x} y={view.y} width={view.w} height={view.h} fill="none" stroke="#fff8d9" strokeWidth="2"/><circle cx={props.snapshot.player.x} cy={props.snapshot.player.y} r="4" fill="#fbe18e" stroke="#65523a"/></svg></button>}
    {error&&<div className="renderer-error" role="alert"><strong>图形显示</strong><p>{error}</p><button onClick={()=>window.location.reload()}>重新载入</button></div>}
  </div>;
}
