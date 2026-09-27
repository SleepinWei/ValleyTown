/** Measured game minutes / real second, including time spent waiting for APIs. */
export class SimulationRate {
  private samples:{seconds:number;minutes:number}[]=[];
  private seconds=0;
  private minutes=0;
  reset(){this.samples=[];this.seconds=0;this.minutes=0;}
  record(seconds:number,minutes:number){
    if(!Number.isFinite(seconds)||seconds<=0)return;
    this.samples.push({seconds,minutes});this.seconds+=seconds;this.minutes+=minutes;
    while(this.seconds>5&&this.samples.length){
      const first=this.samples[0],removed=Math.min(first.seconds,this.seconds-5);
      const fraction=removed/first.seconds;
      this.minutes-=first.minutes*fraction;this.seconds-=removed;
      first.minutes*=1-fraction;first.seconds-=removed;
      if(first.seconds<1e-9)this.samples.shift();
    }
  }
  snapshot(dayMinutes:number,waitingForApi:boolean){
    const gameMinutesPerSecond=this.seconds>0?Math.max(0,this.minutes/this.seconds):0;
    return {targetMultiplier:30/dayMinutes,actualMultiplier:gameMinutesPerSecond/.8,gameMinutesPerSecond,waitingForApi,windowSeconds:this.seconds};
  }
}
