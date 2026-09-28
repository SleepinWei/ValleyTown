import type { World } from '../../server/world';
// A heartbeat also covers an unannounced tab freeze, lost page, or suspended browser process.
export class PageLifecycle {
  private visible=false;
  private heartbeatAt=0;
  private last=0;
  constructor(private world:World,private now=()=>performance.now()){}
  heartbeat(visible:boolean){
    const time=this.now();this.heartbeatAt=time;
    if(this.visible!==visible){this.visible=visible;this.last=time;if(!visible)this.suspend();}
  }
  suspend(){this.visible=false;this.last=this.now();if(this.world.state.status==='running_live'||this.world.lab.active)this.world.pause();else this.world.persist();}
  get canRun(){return this.visible&&this.now()-this.heartbeatAt<3500;}
  step(){const time=this.now(),seconds=this.last?(time-this.last)/1000:0;this.last=time;if(!this.canRun){if(this.world.state.status==='running_live')this.suspend();return;}this.world.tick(seconds);}
  requireVisible(){if(!this.canRun)throw new Error('请回到可见的小镇页面后继续操作。');}
}
