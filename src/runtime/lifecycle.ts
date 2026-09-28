import type { World } from '../../server/world';
// Visibility is not a permission boundary. Keep running in a background tab while
// its host lease is valid; stop on actual disconnection or a suspended browser.
export class PageLifecycle {
  private active=false;
  private heartbeatAt=0;
  private permitUntil=0;
  private last=0;
  constructor(private world:World,private now=()=>performance.now()){}
  heartbeat(active:boolean,validForMs=90000){
    const time=this.now();
    // A late heartbeat must not silently resume a world after browser sleep.
    if(this.active&&!this.canRun)this.suspend();
    this.heartbeatAt=time;this.permitUntil=time+Math.max(0,Math.min(validForMs,90000));
    if(this.active!==active){this.active=active;this.last=time;}
    if(!active)this.suspend();
  }
  suspend(){this.active=false;this.last=this.now();if(this.world.state.status==='running_live'||this.world.lab.active)this.world.pause();else this.world.persist();}
  get canRun(){const now=this.now();return this.active&&now<this.permitUntil&&now-this.heartbeatAt<75000;}
  step(){const time=this.now(),seconds=this.last?Math.min(1,Math.max(0,(time-this.last)/1000)):0;this.last=time;if(!this.canRun){if(this.world.state.status==='running_live'||this.world.lab.active)this.suspend();return;}this.world.tick(seconds);}
  requireActive(){if(!this.canRun)throw new Error('模拟连接已暂停，请重新连接管理页面。');}
}
