import type { Snapshot } from '../../shared/types';

// Only presentation data leaves the administrator's simulation. Never publish an
// observer snapshot, private conversations, model traces, or editable documents.
export function publicTownSnapshot(value:Snapshot):Snapshot {
  const {privateActors,decisions,actionTraces,documentErrors,...view}=value;
  return {...view,observer:false,conversations:[],appointments:[],
    events:view.events.filter(event=>event.audience.includes('public')),
    bubbles:[],
    usage:{...view.usage,recent:[]}};
}
