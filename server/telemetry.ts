import { AsyncLocalStorage } from 'node:async_hooks';
import type { CallRecord } from '../shared/types';
// Async-local attribution keeps concurrent NPC and benchmark retries in their own logical request.
export const modelAttempts=new AsyncLocalStorage<CallRecord[]>();
export async function captureAttempts<T>(attempts:CallRecord[],run:()=>Promise<T>):Promise<T>{return modelAttempts.run(attempts,run);}
