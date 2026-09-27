import { expandPopulation } from './population';
import type { WorldState } from '../shared/types';
import { TOWN_OFFSET } from '../shared/map';
import { weatherSlot } from '../shared/weather';
import { emptyOutdoor } from '../shared/outdoors';
export function migrateWorld(world:WorldState):WorldState{
  if(world.version<2){
    for(const person of [world.player,...world.actors]){
      person.x+=TOWN_OFFSET.x;person.y+=TOWN_OFFSET.y;person.path=[];
      person.inventory.rod??=1;person.inventory.bait??=8;person.inventory.arrows??=6;
      person.outdoor=emptyOutdoor();
    }
    world.player.inventory.bow??=1;
    for(const a of world.actors){if(['carpenter','fisher'].includes(a.id))a.inventory.bow??=1;a.target=null;}
    const merchant=world.actors.find(a=>a.id==='merchant');if(merchant)Object.assign(merchant.inventory,{rod:8,bait:100,bow:5,arrows:100});
    world.version=2;
  }
  world.weatherSlot??=weatherSlot(world.clock);world.player.energy??=100;world.player.outdoor??=emptyOutdoor();world.rng??=81927;
  for(const a of world.actors)a.outdoor??=emptyOutdoor();
  world.society??={requests:[],nextPulse:world.clock,lastMurderDay:-100,births:[],cases:[],dailyFamily:{},nextChild:1};
  if(world.version<3){expandPopulation(world);world.version=3;}
  // Old saves may contain offline time debt. Discard it without advancing the clock
  // or altering completed events, pending results, or the token ledger.
  const legacy=world as Omit<WorldState,'status'> & {status:string;catchupTarget?:number|null;offlineDays?:number};
  const wasCatchingUp=legacy.status==='running_catchup';
  if(wasCatchingUp)legacy.status='running_live';
  if(wasCatchingUp||/离线|补算/.test(world.notice)){
    world.notice=legacy.status==='running_live'?'已从保存的游戏时间继续。':'世界已暂停，将从保存的游戏时间继续。';
  }
  delete legacy.catchupTarget;delete legacy.offlineDays;
  return world;
}
