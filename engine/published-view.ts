import type { World } from '../server/world';
import { createWorldRequests } from './requests';
import { publicTownSnapshot } from '../src/runtime/shared-view';

// Existing GET handlers read saved gameplay only; they never generate via AI.
export async function publishedTownView(world:World){
  const request=createWorldRequests(world),readViews:Record<string,unknown>={};
  for(const a of world.state.actors){
    const id=encodeURIComponent(a.id);
    for(const path of [`/documents/${id}`,`/action-policy/${id}`,`/stories/${id}?view=player`,`/stories/${id}?view=observer`])readViews[path]=await request('GET',path);
  }
  readViews['/decision-lab']=await request('GET','/decision-lab');
  readViews['/saves']=await request('GET','/saves');
  const {events,conversations,appointments,bubbles}=world.snapshot(false);
  return publicTownSnapshot({...world.snapshot(true),displayVersion:2,readViews,playerView:{events,conversations,appointments,bubbles}});
}
