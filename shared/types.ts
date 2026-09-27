import type { PlanningState, LocalAction } from './actions';
import type { ActionTrace } from './telemetry';
export type Point = { x: number; y: number };
export type RunStatus = 'paused_manual' | 'paused_token_limit' | 'running_live';
export type Mode = 'live' | 'demo';
export interface Relation { affection: number; trust: number; attraction: number; resentment: number; familiarity: number }
export interface Memory { id: string; day: number; minute: number; text: string; source: string; kind: 'experience' | 'belief' | 'commitment' | 'reflection' | 'editor'; important: boolean }
export interface Secret { title: string; core: string; fragments: string[]; disclosed: Record<string, number[]> }
export interface Decision {
  traceId?:string; id: string; time: string; actorId: string; source: string; action: string; choices: Record<string, number>;
  confidence: number | null; interest?: number; latency: number; input: number; output: number;
  evidence: string[]; explanation: string; error?: string;
}
export type OutdoorKind='fishing'|'jogging'|'basketball'|'hiking'|'hunting'|'rest';
export interface OutdoorTask {id:string;kind:OutdoorKind;place:string;phase:'travel'|'active';startedAt:number;endsAt:number|null}
export interface OutdoorState {task:OutdoorTask|null;xp:{fishing:number;fitness:number;hunting:number};lastResult:{text:string;at:number;item?:string;success:boolean}|null}
export interface LifeState {
  status:'alive'|'dead'; stage:'adult'|'child'; spouse:string|null; parents:string[]; children:string[];
  bornAt:number|null; diedAt:number|null; marriedAt:number|null;
  custody:{caseId:string;releaseAt:number}|null; aggressive:boolean;
}
export interface CrimeCase {
  id:string; victim:string; perpetrator:string; at:number; position:Point;
  status:'investigating'|'unresolved'|'sentenced'|'released'; evidence:{kind:string;witness?:string;at:number}[];
  nextInvestigation:number; sentenceAt:number|null; releaseAt:number|null;
}
export interface SocietyState {
  requests:{from:string;to:string;type:'marriage'|'family'}[]; nextPulse:number; lastMurderDay:number; births:{id:string;parents:[string,string];dueAt:number}[];
  cases:CrimeCase[]; dailyFamily:Record<string,number>; nextChild:number;
}
export const freshLife=():LifeState=>({status:'alive',stage:'adult',spouse:null,parents:[],children:[],bornAt:null,diedAt:null,marriedAt:null,custody:null,aggressive:false});
export const freeAdult=(a:Actor)=>a.life.status==='alive'&&a.life.stage==='adult'&&!a.life.custody;
export interface Actor extends Point {
  planning?:PlanningState; decisionReason?:string; localTask?:LocalAction|null;
  life:LifeState;
  outdoor:OutdoorState;
  id: string; name: string; role: string; age: number; color: string; hair: string; skin: string;
  longTermNotes?: string; dailyNotes?: { day:number; text:string }; persona: string; goal: string; plan: string; home: string; activity: string; energy: number;
  mood: string; actionUntil: number; nextDecision: number; nextPlan: number; revision: number;
  target: string | null; path: Point[]; conversation: string | null; busy: boolean;
  inventory: Record<string, number>; coins: number; relations: Record<string, Relation>;
  memories: Memory[]; secret: Secret; knowledge: string[]; partner: string | null;
  trustedEvents: Record<string, string[]>; giftCounts: Record<string, number>; socialCooldown: Record<string, number>;
}
export interface PublicActor extends Point {
  life:Omit<LifeState,'aggressive'>; age:number; outdoor:OutdoorState; id: string; name: string; role: string; color: string; hair: string; skin: string;
  activity: string; mood: string; energy: number; home: string; busy: boolean;
}
export interface TownEvent { id: string; at: number; kind: string; text: string; actorIds: string[]; audience: string[]; mode: 'live' | 'offline_compressed'; source?: string }
export interface Message { id: string; speaker: string; text: string; at: number; source: string }
export interface Conversation { id: string; participants: string[]; messages: Message[]; status: 'active' | 'ended'; turn: number; pending: boolean; started: number; nextTurn: number; expires: number }
export interface Appointment { id: string; from: string; to: string; place: string; at: number; status: 'proposed' | 'accepted' | 'fulfilled' | 'missed' | 'declined'; type: 'date' | 'help'; arrived: string[]; togetherSince?: number }
export interface Quest { id: string; title: string; text: string; progress: number; required: number; completed: boolean; reward: number }
export interface WorldState {
  laboratoryRun?:string; society:SocietyState; weatherSlot?:number; rng?:number; version: number; id: string; clock: number; dayMinutes: number; status: RunStatus; mode: Mode; weather: string;
  actors: Actor[]; player: { energy:number; outdoor:OutdoorState; x: number; y: number; path: Point[]; coins: number; inventory: Record<string, number>; conversation: string | null };
  events: TownEvent[]; conversations: Conversation[]; appointments: Appointment[]; quests: Quest[];
  decisions: Decision[]; checkpointAt: number;
  reflectionQueue: { actorId: string; day: number }[]; commandIds: string[];
  speechQueue: PendingSpeech[]; commandResults: Record<string, unknown>; notice: string;
  pending: { kind: string; actorId: string; revision: number; data: any }[];
}
export interface PendingSpeech { conversationId: string; speaker: string; revision: number; turn: number; text: string; source: string; intent: string; fragment: number | null; warmth?: number; proposal?: { place: string; at: number }; decision: Decision }
export interface Usage { limit: number; used: number; reserved: number; unknown: number; calls: number; input: number; output: number; byProvider: Record<string, { input: number; output: number; calls: number; latency: number }>; recent: CallRecord[] }
export interface CallRecord { id: string; provider: string; purpose: string; model: string; status: string; input: number; output: number; reserved: number; latency: number; created: number; error: string | null }
export interface DocumentView { id: string; actorId: string; revision: number; text: string; file: string; error?: string; imported?: string }
export interface SpeechBubble {id:string;actorId:string;text:string;source:string;at:number;pending:boolean}
export interface SimulationTiming {
  targetMultiplier:number;actualMultiplier:number;gameMinutesPerSecond:number;waitingForApi:boolean;windowSeconds:number;
}
export interface Snapshot {
  timing:SimulationTiming;
  bubbles:SpeechBubble[];performance:{active:{action:number;dialogue:number;background:number};limits:{action:number;dialogue:number;background:number};lastFastContextTokens:number};
  id: string; clock: number; dayMinutes: number; status: RunStatus; mode: Mode; weather: string;
  actors: PublicActor[]; player: WorldState['player']; events: TownEvent[]; conversations: Conversation[];
  appointments: Appointment[]; quests: Quest[]; usage: Usage; configured: { jev: boolean; deepseek: boolean };
  notice: string; observer: boolean;
  society:{births:SocietyState['births'];cases:Omit<CrimeCase,'perpetrator'|'evidence'>[]}; runtime?:{simulation:'worker'|'inline';threadId:number};
  actionTraces?:ActionTrace[]; laboratory?:{active:boolean;id?:string;completed:number;total:number}; privateActors?: Actor[]; decisions?: Decision[]; documentErrors?: string[];
}
export const dayOf = (clock: number) => Math.floor(clock / 1440) + 1;
export const timeOf = (clock: number) => `${String(Math.floor(clock % 1440 / 60)).padStart(2, '0')}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
export const relation = (): Relation => ({ affection: 5, trust: 20, attraction: 0, resentment: 0, familiarity: 10 });
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
