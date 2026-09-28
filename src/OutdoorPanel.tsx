import { WriteButton } from './ReadOnly';
import { useState } from 'react';
import { Fish, Footprints, Mountain, TentTree, Target, ArrowRight, MapPin, Clock3, BatteryMedium, CircleDot } from 'lucide-react';
import type { OutdoorKind, Snapshot } from '../shared/types';
import { outdoorWeatherBlock, weatherInfo } from '../shared/weather';
import { outdoorActivities, skillLevel } from '../shared/outdoors';
import { items, location, regionAt } from '../shared/map';
const icons={fishing:Fish,jogging:Footprints,basketball:CircleDot,hiking:Mountain,hunting:Target,rest:TentTree};
export function OutdoorPanel({world,start}:{world:Snapshot;start:(kind:OutdoorKind,place:string)=>void}){
  const [kind,setKind]=useState<OutdoorKind>('fishing');const spec=outdoorActivities[kind],Icon=icons[kind];
  const task=world.player.outdoor.task,paused=world.status.startsWith('paused');
  const effort=Math.ceil(spec.energy*weatherInfo(world.weather).effort);
  const weatherBlock=outdoorWeatherBlock(world.weather,kind);
  const missing=weatherBlock??(kind==='hunting'&&(world.clock%1440<360||world.clock%1440>=1140)?'狩猎开放时间为 06:00–19:00':null)??(spec.gear&&!world.player.inventory[spec.gear]?`需要${items[spec.gear].name}`:spec.consume&&!world.player.inventory[spec.consume]?`需要${items[spec.consume].name}`:world.player.energy<effort?'体力不足':null);
  return <div className="outdoor-panel">
    <div className="expedition-intro"><span className="eyebrow">BEYOND THE TOWN</span><h3>沿着小路，去远一点的地方。</h3><p>听海、追山风，或等一尾鱼上钩。选好活动后会自动走到目的地。</p></div>
    <p className="outdoor-weather"><b>{world.weather}</b> · {weatherInfo(world.weather).advice}</p>
    <div className="outdoor-stats"><span><BatteryMedium size={16}/> 体力 <b>{Math.round(world.player.energy)} / 100</b></span>{(['fishing','fitness','hunting']as const).map((skill,i)=><span key={skill}>{['钓鱼','体能','狩猎'][i]} <b>Lv.{skillLevel(world.player.outdoor.xp[skill])}</b><small>{world.player.outdoor.xp[skill]} XP</small></span>)}</div>
    <div className="activity-picker" role="tablist" aria-label="户外活动类型">{Object.entries(outdoorActivities).map(([key,value])=>{const ActivityIcon=icons[key as OutdoorKind];return <button key={key} role="tab" aria-selected={kind===key} className={kind===key?'active':''} onClick={()=>setKind(key as OutdoorKind)}><ActivityIcon size={19}/>{value.name}</button>;})}</div>
    <div className="activity-description"><Icon size={22}/><div><h3>{spec.name}</h3><p>{spec.description}</p><span><Clock3 size={12}/>{spec.duration} 游戏分钟 <b>·</b> {spec.energy?`消耗 ${effort} 体力`:'恢复 32 体力'}{spec.consume&&` · 每次消耗 1 份${items[spec.consume].name}`}</span></div></div>
    <div className="destination-grid">{spec.places.map(id=>{const site=location(id),region=regionAt(site.door.x,site.door.y);return <article key={id} className={`destination-card destination-${region.id}`}><span className="destination-region"><MapPin size={12}/>{region.name}</span><h4>{site.name}</h4><p>{kind==='fishing'?`可能收获：${id==='seapier'?'银鳞海鱼':id==='lakepier'?'镜湖鲈鱼':'河鱼'}`:kind==='hunting'?'林地野兔 · 白天开放':kind==='rest'?'驻足休息，恢复旅途体力':'完成训练，积累体能经验'}</p><WriteButton className="primary full" disabled={paused||!!task||!!missing||!!world.player.conversation} onClick={()=>start(kind,id)}>出发{spec.name}<ArrowRight size={14}/></WriteButton></article>;})}</div>
    {paused?<p className="outdoor-note">世界已暂停，继续模拟后即可出发。</p>:task?<p className="outdoor-note">正在{task.phase==='travel'?'前往':'进行'}{location(task.place).name}的{outdoorActivities[task.kind].name}。可在地图下方结束当前活动。</p>:world.player.conversation?<p className="outdoor-note">先结束交谈，再出发探索。</p>:missing&&<p className="outdoor-note">{missing}。{!weatherBlock&&'体力不足可选择休息；装备与消耗品可在中心城区杂货铺补给。'}</p>}
    <p className="hint">装备与体力在到达地点、活动开始时消耗。中途取消不会返还已消耗物资；收获与技能会保存到存档。户外活动本身由世界规则结算，不额外调用模型。</p>
  </div>;
}
