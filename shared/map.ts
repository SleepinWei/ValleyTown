import type { Point } from './types';
export const MAP_W = 240, MAP_H = 180, TILE = 16;
export const TOWN_OFFSET = {x:72,y:48};
const oldTown = [
  { id: 'bakery', name: '麦穗面包店', x: 13, y: 13, w: 10, h: 8, door: {x:18,y:21}, color: '#b96c53', kind: 'shop' },
  { id: 'market', name: '禾间杂货铺', x: 29, y: 11, w: 10, h: 8, door: {x:34,y:19}, color: '#c19a55', kind: 'shop' },
  { id: 'library', name: '溪谷图书馆', x: 45, y: 12, w: 11, h: 8, door: {x:50,y:20}, color: '#6f8790', kind: 'shop' },
  { id: 'inn', name: '晚灯旅店', x: 13, y: 37, w: 12, h: 9, door: {x:19,y:46}, color: '#977783', kind: 'shop' },
  { id: 'workshop', name: '木工作坊', x: 45, y: 37, w: 10, h: 8, door: {x:50,y:45}, color: '#a77f50', kind: 'shop' },
  { id: 'playerhome', name: '你的小屋', x: 29, y: 44, w: 8, h: 7, door: {x:33,y:51}, color: '#719276', kind: 'home' },
  { id: 'garden', name: '风铃花圃', x: 7, y: 26, w: 10, h: 6, door: {x:17,y:30}, color: '#b17b8d', kind: 'garden' },
  { id: 'square', name: '溪谷广场', x: 29, y: 25, w: 14, h: 9, door: {x:36,y:31}, color: '#bbaf88', kind: 'square' },
  { id: 'riverside', name: '河岸长椅', x: 66, y: 25, w: 8, h: 7, door: {x:69,y:29}, color: '#718ea0', kind: 'river' },
  { id: 'bridge', name: '旧桥工程', x: 59, y: 38, w: 8, h: 4, door: {x:59,y:40}, color: '#a78b63', kind: 'bridge' },
] as const;
export const regions = [
  {id:'town',name:'中心城区',subtitle:'店铺、广场与老邻居',color:'#bfa77e',center:{x:108,y:80}},
  {id:'coast',name:'南风海岸',subtitle:'沙滩、灯塔与海钓码头',color:'#d7c391',center:{x:106,y:148}},
  {id:'mountain',name:'云杉山地',subtitle:'山脊步道、营地与观景台',color:'#89988c',center:{x:100,y:29}},
  {id:'lake',name:'镜湖湿地',subtitle:'湖畔钓台与芦苇小径',color:'#79a8ab',center:{x:49,y:100}},
  {id:'forest',name:'鹿鸣林地',subtitle:'林间营地与狩猎步道',color:'#648267',center:{x:198,y:85}},
  {id:'park',name:'青禾运动公园',subtitle:'慢跑环道与篮球场',color:'#9fac78',center:{x:107,y:124}},
] as const;
export const locations = [
  ...oldTown.map(l=>({...l,x:l.x+TOWN_OFFSET.x,y:l.y+TOWN_OFFSET.y,door:{x:l.door.x+TOWN_OFFSET.x,y:l.door.y+TOWN_OFFSET.y}})),
  {id:'seapier',name:'南风海钓码头',x:101,y:148,w:7,h:10,door:{x:104,y:154},color:'#bf9d72',kind:'pier'},
  {id:'lighthouse',name:'白鹭灯塔',x:165,y:137,w:6,h:9,door:{x:168,y:146},color:'#b4715d',kind:'shop'},
  {id:'beach',name:'贝壳沙滩',x:74,y:142,w:17,h:8,door:{x:82,y:148},color:'#dfc695',kind:'beach'},
  {id:'lakepier',name:'镜湖钓台',x:62,y:95,w:5,h:9,door:{x:65,y:100},color:'#80a5a7',kind:'pier'},
  {id:'lakecamp',name:'芦苇营地',x:21,y:120,w:8,h:6,door:{x:25,y:126},color:'#b4a36f',kind:'camp'},
  {id:'mountaincamp',name:'云杉营地',x:100,y:38,w:9,h:6,door:{x:104,y:44},color:'#8a927d',kind:'camp'},
  {id:'summit',name:'风脊观景台',x:91,y:17,w:10,h:6,door:{x:96,y:23},color:'#a2aaa0',kind:'summit'},
  {id:'huntingcamp',name:'鹿鸣狩猎营地',x:194,y:76,w:10,h:8,door:{x:199,y:84},color:'#8f8d69',kind:'camp'},
  {id:'foresttrail',name:'野兔林间径',x:195,y:101,w:12,h:8,door:{x:201,y:109},color:'#658467',kind:'trail'},
  {id:'sports',name:'青禾慢跑环道',x:93,y:114,w:24,h:14,door:{x:105,y:128},color:'#b9937b',kind:'sports'},
  {id:'court',name:'青禾篮球场',x:120,y:116,w:10,h:14,door:{x:125,y:130},color:'#7d9c94',kind:'court'},
  {id:'prison',name:'溪谷司法所 · 监狱',x:150,y:94,w:16,h:13,door:{x:158,y:108},color:'#717c85',kind:'prison'},
  {id:'clinic',name:'白芷诊所',x:75,y:96,w:9,h:8,door:{x:79,y:104},color:'#9aa99b',kind:'shop'},
  {id:'school',name:'溪谷学堂',x:109,y:98,w:9,h:8,door:{x:113,y:106},color:'#ad9172',kind:'shop'},
  {id:'cottages',name:'织梦合院',x:145,y:56,w:10,h:9,door:{x:150,y:65},color:'#a98480',kind:'home'},
  {id:'ranger',name:'护林人小屋',x:164,y:53,w:9,h:8,door:{x:168,y:61},color:'#778767',kind:'shop'},
];
export const location = (id:string) => locations.find(l=>l.id===id)??locations[7];
export const shoreY=(x:number)=>154+Math.round(Math.sin(x/19)*2+Math.sin(x/8));
export const isLake=(x:number,y:number)=>((x-36)/26)**2+((y-94)/23)**2<1;
export const isSea=(x:number,y:number)=>y>=shoreY(x);
export const isRiver=(x:number,y:number)=>x>=133&&x<=137&&y>=36&&y<shoreY(x)&&![42,76,87,99,130,148].some(by=>y>=by&&y<=by+3);
export const isPier=(x:number,y:number)=>x>=102&&x<=106&&y>=148&&y<=160;
export const peaks=[{x:34,y:21,rx:17,ry:10},{x:69,y:13,rx:14,ry:9},{x:128,y:16,rx:17,ry:10},{x:171,y:23,rx:20,ry:13},{x:209,y:15,rx:18,ry:9}];
export const isRock=(x:number,y:number)=>peaks.some(p=>((x-p.x)/p.rx)**2+((y-p.y)/p.ry)**2<1);
export function terrainAt(x:number,y:number){if(isPier(x,y))return 'pier';if(isLake(x,y))return 'lake';if(isSea(x,y))return 'sea';if(isRiver(x,y))return 'river';if(isRock(x,y))return 'rock';if(y>=shoreY(x)-10)return 'sand';if(y<47)return 'mountain';if(x>157&&y<136)return 'forest';if(x<70&&y>58&&y<132)return 'wetland';return 'grass';}
export function regionAt(x:number,y:number){return y>=137?regions[1]:y<48?regions[2]:x<70&&y>58?regions[3]:x>157&&y<137?regions[4]:y>=110&&x>=75&&x<150?regions[5]:regions[0];}
export const walkable=(x:number,y:number)=>{
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<3||y<5||x>=MAP_W-3||y>=MAP_H-3)return false;
  if((x===150||x===165)&&y>=94&&y<=106||y===94&&x>=150&&x<=165||y===106&&x>=150&&x<=165&&x!==158)return false;
  const terrain=terrainAt(x,y);if(['lake','sea','river','rock'].includes(terrain))return false;
  return !locations.some(l=>(l.kind==='shop'||l.kind==='home')&&x>=l.x&&x<l.x+l.w&&y>=l.y&&y<l.y+l.h);
};
export function pathfind(start:Point,end:Point):Point[]{
  const sx=Math.round(start.x),sy=Math.round(start.y),ex=Math.round(end.x),ey=Math.round(end.y);
  if(!walkable(sx,sy)||!walkable(ex,ey))return [];
  const origin=sy*MAP_W+sx,goal=ey*MAP_W+ex,heap:{key:number;f:number;g:number}[]=[];
  const costs=new Map<number,number>([[origin,0]]),parents=new Map<number,number>();
  const push=(n:typeof heap[number])=>{heap.push(n);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p].f<=n.f)break;heap[i]=heap[p];i=p;}heap[i]=n;};
  const pop=()=>{const top=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1].f<heap[child].f)child++;if(heap[child].f>=last.f)break;heap[i]=heap[child];i=child;}heap[i]=last;}return top;};
  push({key:origin,g:0,f:Math.abs(ex-sx)+Math.abs(ey-sy)});
  while(heap.length){const n=pop();if(n.g!==costs.get(n.key))continue;if(n.key===goal){const result:Point[]=[];let key=goal;while(key!==origin){result.push({x:key%MAP_W,y:Math.floor(key/MAP_W)});key=parents.get(key)!;}return result.reverse();}
    const x=n.key%MAP_W,y=Math.floor(n.key/MAP_W);
    for(const [dx,dy]of [[0,1],[1,0],[0,-1],[-1,0]]){const nx=x+dx,ny=y+dy,k=ny*MAP_W+nx,g=n.g+1;if(!walkable(nx,ny)||g>=(costs.get(k)??Infinity))continue;costs.set(k,g);parents.set(k,n.key);push({key:k,g,f:g+Math.abs(ex-nx)+Math.abs(ey-ny)});}
  }return [];
}
export const distance = (a: Point,b: Point) => Math.hypot(a.x-b.x,a.y-b.y);
export const items: Record<string, { name: string; color: string; price: number }> = {
  rod:{name:'旅行鱼竿',color:'#a88453',price:30},bait:{name:'鱼饵',color:'#b08775',price:2},bow:{name:'林地猎弓',color:'#94785b',price:45},arrows:{name:'箭矢',color:'#aeb5a7',price:3},seafish:{name:'银鳞海鱼',color:'#79a8bd',price:12},lakefish:{name:'镜湖鲈鱼',color:'#729e80',price:10},rabbit:{name:'野兔猎获',color:'#b49b81',price:16},
  bread:{name:'蜂蜜面包',color:'#d7a259',price:6}, soup:{name:'暖心热汤',color:'#c78255',price:8}, berries:{name:'野莓',color:'#9c647b',price:4},
  flowers:{name:'野花束',color:'#dba0a2',price:5}, seeds:{name:'花种',color:'#a3af68',price:3}, wood:{name:'木材',color:'#ad8b60',price:4},
  tools:{name:'修理工具',color:'#809493',price:12}, fish:{name:'河鱼',color:'#77a9aa',price:6}, book:{name:'旧书',color:'#8c94ac',price:10},
  paper:{name:'画纸',color:'#d5cbb0',price:3}, paint:{name:'颜料',color:'#b492bf',price:8}, note:{name:'手写便条',color:'#d6c3a2',price:2},
};
