import type { Actor, CallRecord, DocumentView, WorldState } from '../shared/types';
import type { Store } from '../server/store';
import type { ModelGateway } from './model-gateway';

export class BudgetError extends Error {
  constructor(public provider?: import('../shared/budget').BudgetProvider) {
    super(`${provider ?? '模型'} 金额池额度不足，模拟已暂停`);
  }
}
export interface DocumentPort {
  initialize(): void;
  restoreFromWorld(): void;
  list(actorId: string): DocumentView[];
  import(id: string, text: string, revision: number): DocumentView[];
  errors(): string[];
  scan(immediate?: boolean): void;
  project(): void;
}
export type DocumentChanged = (actor: Actor, kind: string, body: string) => void;
export type ModelPort = Pick<ModelGateway, 'configured' | 'jev' | 'text' | 'chooseText'>;
export type Ledger = Pick<Store, 'reserve' | 'settle' | 'fail' | 'call' | 'exhaustedProvider'>;
export interface WorldStore extends Ledger {
  load(): WorldState | null;
  save(world: WorldState): void;
  recordEvent: Store['recordEvent'];
  eventsByIds: Store['eventsByIds'];
  storySummary: Store['storySummary'];
  saveStorySummary: Store['saveStorySummary'];
  putTrace: Store['putTrace'];
  traces: Store['traces'];
  putLab: Store['putLab'];
  labs: Store['labs'];
  archive: Store['archive'];
  saves(): {id:string;label:string;created:number}[];
  restore: Store['restore'];
  usage: Store['usage'];
  setLimit: Store['setLimit'];
  setExchange: Store['setExchange'];
  readonly reflectionEnabled: boolean;
  callSummary(): {purpose:string;calls:number;input:number;output:number}[];
  createGateway(canRun:()=>boolean, onBudget:()=>void): ModelPort;
  createDocuments(world:()=>WorldState, changed:DocumentChanged): DocumentPort;
}
export interface ModelConfig {
  jevKey?: string; deepseekKey?: string; jevModel?: string;
  jevEndpoint?: string; deepseekBaseUrl?: string; thinking?: boolean;
}
export interface ModelTransport {
  config(): ModelConfig;
  send(provider:'Jev'|'DeepSeek', url:string, key:string, body:unknown, retry:boolean): Promise<Response>;
  attempts?(): CallRecord[] | undefined;
}
