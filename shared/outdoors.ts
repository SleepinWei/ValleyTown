import type { OutdoorKind, OutdoorState } from './types';
export const outdoorActivities:Record<OutdoorKind,{name:string;verb:string;skill:'fishing'|'fitness'|'hunting'|'rest';duration:number;energy:number;places:string[];gear?:string;consume?:string;description:string}>={
 fishing:{name:'钓鱼',verb:'等待鱼儿上钩',skill:'fishing',duration:25,energy:5,places:['seapier','lakepier','riverside'],gear:'rod',consume:'bait',description:'抛竿、等待、收线。海岸、镜湖与河流有不同鱼获，雨天更容易咬钩。'},
 jogging:{name:'慢跑',verb:'绕公园慢跑',skill:'fitness',duration:30,energy:14,places:['sports'],description:'沿红土环道跑步，提升体能，和一起运动的人熟悉起来。'},
 basketball:{name:'篮球',verb:'练习投篮',skill:'fitness',duration:35,energy:18,places:['court'],description:'在青禾球场练习投篮，完成训练获得体能经验。'},
 hiking:{name:'登山',verb:'沿山脊徒步',skill:'fitness',duration:45,energy:20,places:['summit','mountaincamp'],description:'沿云杉山径抵达观景台，在山风中锻炼体能。'},
 hunting:{name:'打猎',verb:'追踪林间猎物',skill:'hunting',duration:40,energy:16,places:['huntingcamp','foresttrail'],gear:'bow',consume:'arrows',description:'在鹿鸣林地追踪野兔。需要猎弓和箭矢；白天出发，结果受经验影响。'},
 rest:{name:'休息',verb:'坐下来休息',skill:'rest',duration:25,energy:0,places:['lakecamp','mountaincamp','huntingcamp','beach','square'],description:'在营地或风景旁歇一会儿，恢复 32 点体力。'},
};
export const emptyOutdoor=():OutdoorState=>({task:null,xp:{fishing:0,fitness:0,hunting:0},lastResult:null});
export const skillLevel=(xp:number)=>Math.min(10,1+Math.floor(xp/20));
export const outdoorPlaceChoices=Object.entries(outdoorActivities).flatMap(([kind,a])=>a.places.map(place=>({kind:kind as OutdoorKind,place,...a})));

export const outdoorInterests:Record<string,OutdoorKind[]>={baker:['jogging','fishing'],gardener:['hiking','fishing'],carpenter:['hunting','basketball'],merchant:['basketball','jogging'],librarian:['hiking','jogging'],fisher:['fishing','hunting'],innkeeper:['jogging','fishing'],painter:['hiking','fishing']};
