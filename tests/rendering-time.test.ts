import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daylight } from '../shared/weather';
import { PresentationClock } from '../src/three/PresentationClock';
import type { Snapshot } from '../shared/types';

const close=(a:number,b:number,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const distance=(a:ReturnType<typeof daylight>['direction'],b:ReturnType<typeof daylight>['direction'])=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const sample=(clock:number,status:Snapshot['status']='running_live',id='test-world')=>({id,clock,status});

test('sun follows a constant angular-speed orbit through sunrise, noon, sunset and midnight',()=>{
  const step=distance(daylight(0).direction,daylight(1).direction);
  for(let minute=0;minute<1440;minute++){
    const a=daylight(minute),b=daylight(minute+1);
    close(Math.hypot(a.direction.x,a.direction.y,a.direction.z),1);
    close(distance(a.direction,b.direction),step);
    close(distance(a.direction,daylight(minute+1440).direction),0);
    if(a.direction.y<0)assert.equal(a.directSun,0);
  }
  assert.ok(daylight(540).direction.x>0);
  assert.ok(daylight(900).direction.x<0);
  assert.ok(daylight(600).direction.y>daylight(540).direction.y);
  assert.ok(daylight(720).direction.y>daylight(660).direction.y);
});

test('all lighting channels are continuous at phase boundaries and midnight',()=>{
  for(const clock of [0,300,360,480,720,1020,1080,1200,1440]){
    const before=daylight(clock-.001),after=daylight(clock+.001);
    for(const key of ['sun','night','warm','directSun','moon','shadowLength'] as const)close(before[key],after[key],.0001);
    assert.ok(distance(before.direction,after.direction)<.0001);
  }
});

test('snapshot interpolation fills frames without predicting ahead or jumping at arrivals',()=>{
  const clock=new PresentationClock();
  assert.equal(clock.sample(sample(1439.6),0),1439.6);
  assert.equal(clock.sample(sample(1440),500),1439.6);
  close(clock.sample(sample(1440),750),1439.8);
  assert.equal(clock.sample(sample(1440.4),1000),1440);
  close(clock.sample(sample(1440.4),1250),1440.2);
  assert.equal(clock.sample(sample(1440.4),2000),1440.4);
  assert.equal(clock.sample(sample(1440.4),10000),1440.4);
});

test('irregular snapshots remain monotonic and interpolate larger game-time steps',()=>{
  const clock=new PresentationClock();let previous=clock.sample(sample(720),0),server=720;
  for(let ms=16;ms<3000;ms+=16){
    if(ms%160===0||ms%272===0)server+=.64;
    const time=clock.sample(sample(server),ms);
    assert.ok(time>=previous&&time<=server);previous=time;
  }
  const fast=new PresentationClock();fast.sample(sample(720),0);
  assert.equal(fast.sample(sample(740),500),720);
  close(fast.sample(sample(740),750),730);
});

test('pause, resume, restoring saves and reconnecting synchronize to the authoritative clock',()=>{
  const clock=new PresentationClock();clock.sample(sample(480),0);clock.sample(sample(481),500);
  assert.equal(clock.sample(sample(481,'paused_manual'),600),481);
  assert.equal(clock.sample(sample(481,'paused_manual'),9000),481);
  assert.equal(clock.sample(sample(481),9100),481);
  assert.equal(clock.sample(sample(482),9600),481);
  assert.equal(clock.sample(sample(400),9700),400);
  assert.equal(clock.sample(sample(500,'running_live','restored'),9800),500);
  assert.equal(clock.sample(sample(501,'running_live','restored'),20000),501);
});
