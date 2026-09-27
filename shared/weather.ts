import type { OutdoorKind } from './types';

export const weatherNames=['晴朗','多云','细雨','大雾','雷雨'] as const;
export type WeatherName=typeof weatherNames[number];
export const weatherRules:Record<WeatherName,{cloud:number;rain:number;fog:number;wind:number;speed:number;effort:number;fishBonus:number;advice:string}>={
  晴朗:{cloud:.1,rain:0,fog:0,wind:.3,speed:1,effort:1,fishBonus:0,advice:'适合远行、运动与户外见面。'},
  多云:{cloud:.65,rain:0,fog:.04,wind:.55,speed:1,effort:1,fishBonus:.03,advice:'日光柔和，适合散步、运动和登山。'},
  细雨:{cloud:.8,rain:.5,fog:.12,wind:.5,speed:.88,effort:1.2,fishBonus:.12,advice:'路面湿滑，运动更耗体力；鱼儿更活跃，可以钓鱼或去屋檐下避雨。'},
  大雾:{cloud:.55,rain:0,fog:.65,wind:.15,speed:.78,effort:1.1,fishBonus:-.05,advice:'能见度低，暂停登山和打猎，优先留在城区或屋檐附近。'},
  雷雨:{cloud:1,rain:1,fog:.2,wind:1,speed:.7,effort:1.35,fishBonus:0,advice:'暂停露天活动，优先去最近建筑的屋檐下避雨，暂缓河岸赴约。'},
};
export function weatherInfo(name:string){return weatherRules[name as WeatherName]??weatherRules.晴朗;}
export const weatherSlot=(clock:number)=>Math.floor(clock/240);
// Four-hour fronts repeat deterministically: saves and offline catch-up use the same weather.
export function weatherAt(clock:number):WeatherName{
  const day=Math.floor(clock/1440),slot=weatherSlot(clock)%6;
  const fronts:WeatherName[][]=[['大雾','多云','晴朗','晴朗','多云','细雨'],['细雨','多云','多云','雷雨','细雨','大雾'],['大雾','多云','晴朗','多云','晴朗','多云'],['多云','细雨','细雨','多云','雷雨','细雨']];
  return fronts[day%fronts.length][slot];
}
export function outdoorWeatherBlock(weather:string,kind:OutdoorKind):string|null{
  if(weather==='雷雨')return '雷雨中暂停露天活动，请到建筑屋檐下避雨';
  if(weather==='大雾'&&(kind==='hiking'||kind==='hunting'))return '大雾能见度低，暂时不能登山或打猎';
  return null;
}
export function daylight(clock:number){
  const hour=((clock%1440)+1440)%1440/60;
  const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  // One continuous 24-hour orbit: east at 06:00, highest at noon, west at 18:00.
  // The tilted orbital plane keeps the noon shadow readable in the isometric view.
  const angle=(hour-6)/24*Math.PI*2,tilt=.4,height=Math.sin(angle);
  const direction={x:Math.cos(angle),y:height*Math.cos(tilt),z:-height*Math.sin(tilt)};
  const sun=smooth(-.12,.38,height),night=1-sun;
  const warm=(1-smooth(.05,.55,Math.abs(height)))*smooth(-.22,.04,height);
  return {hour,sun,night,warm,direction,directSun:smooth(0,.22,height),moon:smooth(0,.3,-height)*night,
    phase:hour<5||hour>=20?'夜晚':hour<8?'清晨':hour<17?'白昼':'黄昏',
    shadowX:direction.x,shadowLength:.6+(1-Math.max(0,height))*1.8};
}
export function environmentContext(weather:string,clock:number){const w=weatherInfo(weather);return {weather,phase:daylight(clock).phase,visibility:weather==='大雾'?'低':'正常',advice:w.advice,movementSpeed:w.speed,outdoorEnergyMultiplier:w.effort,nextWeatherCheck:((weatherSlot(clock)+1)*240)%1440};}
