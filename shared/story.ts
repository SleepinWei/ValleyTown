export type StoryView='player'|'observer';
export interface StoryRecord {id:string;at:number;text:string;kind:string;label:string;score:number;people:string[];perspective:'event'|'experience'|'belief'|'reflection'|'commitment'}
export interface StoryChapter {day:number;count:number;summary:string;records:StoryRecord[]}
export interface StoryNarrative {title:string;paragraphs:{text:string;ids:string[]}[];highlights:{id:string;reason:string}[];model:string;input:number;output:number;generatedAt:number}
export interface ActorStory {
  worldId:string;actorId:string;name:string;role:string;view:StoryView;asOf:number;from:number|null;fingerprint:string;
  summary:string;total:number;days:number;highlights:StoryRecord[];chapters:StoryChapter[];
  people:{id:string;name:string;count:number}[];coverageNote:string;canGenerate:boolean;narrative:StoryNarrative|null;
}
export interface StoryJob {id:string;status:'running'|'complete'|'failed';story:ActorStory;error?:string}
