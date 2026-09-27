import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ActionTrace, LabRun } from '../shared/telemetry';
import type { WorldState, Usage, CallRecord } from '../shared/types';

export class BudgetError extends Error { constructor(){super('token 额度不足，模拟已暂停');} }
export class Store {
  db: DatabaseSync;
  constructor(public dir:string, initialLimit=5_000_000) {
    mkdirSync(dir,{recursive:true});this.db=new DatabaseSync(join(dir,'valleytown.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS action_traces(id TEXT PRIMARY KEY, created INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lab_runs(id TEXT PRIMARY KEY, created INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS world(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS saves(id TEXT PRIMARY KEY, label TEXT NOT NULL, created INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, provider TEXT NOT NULL, purpose TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL, latency INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, error TEXT, imported TEXT);
    `);
    this.db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run('token_limit',String(initialLimit));
    // A crash does not prove that the upstream request was free. Preserve its reservation.
    this.db.prepare("UPDATE calls SET status='unknown',error='请求在上次运行中中断，用量待核对' WHERE status='pending'").run();
  }
  putTrace(trace:ActionTrace){this.db.prepare('INSERT INTO action_traces VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(trace.id,trace.queuedAt,JSON.stringify(trace));}
  traces(limit=120):ActionTrace[]{return (this.db.prepare('SELECT json FROM action_traces ORDER BY created DESC, rowid DESC LIMIT ?').all(limit) as {json:string}[]).map(r=>JSON.parse(r.json));}
  putLab(run:LabRun){this.db.prepare('INSERT INTO lab_runs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(run.id,run.created,JSON.stringify(run));}
  labs(limit=5):LabRun[]{return (this.db.prepare('SELECT json FROM lab_runs ORDER BY created DESC, rowid DESC LIMIT ?').all(limit) as {json:string}[]).map(r=>JSON.parse(r.json));}
  call(id:string):CallRecord{return this.db.prepare('SELECT * FROM calls WHERE id=?').get(id) as unknown as CallRecord;}
  load():WorldState|null {const r=this.db.prepare('SELECT json FROM world WHERE id=1').get() as {json:string}|undefined;return r?JSON.parse(r.json):null;}
  save(world:WorldState) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO world(id,json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(JSON.stringify(world));
      const statement=this.db.prepare('INSERT OR IGNORE INTO events(id,json) VALUES (?,?)');
      for(const e of world.events)statement.run(e.id,JSON.stringify(e));
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  archive(world:WorldState,label:string) {const id=randomUUID();this.db.prepare('INSERT INTO saves VALUES (?,?,?,?)').run(id,label,Date.now(),JSON.stringify(world));return id;}
  saves(){return this.db.prepare('SELECT id,label,created FROM saves ORDER BY created DESC LIMIT 30').all();}
  restore(id:string):WorldState {const r=this.db.prepare('SELECT json FROM saves WHERE id=?').get(id) as {json:string}|undefined;if(!r)throw new Error('存档不存在');return JSON.parse(r.json);}
  get limit(){return Number((this.db.prepare("SELECT value FROM settings WHERE key='token_limit'").get() as {value:string}).value);}
  setLimit(limit:number){if(!Number.isSafeInteger(limit)||limit<1||limit>1e10)throw new Error('请输入有效的 token 上限');this.db.prepare("UPDATE settings SET value=? WHERE key='token_limit'").run(String(limit));}
  reserve(provider:string,purpose:string,model:string,tokens:number) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r=this.db.prepare('SELECT COALESCE(SUM(input+output+reserved),0) AS total FROM calls').get() as {total:number};
      if(r.total+tokens>this.limit)throw new BudgetError();
      const id=randomUUID();this.db.prepare("INSERT INTO calls(id,provider,purpose,model,status,reserved,created) VALUES (?,?,?,?,'pending',?,?)").run(id,provider,purpose,model,tokens,Date.now());
      this.db.exec('COMMIT');return id;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  settle(id:string,input:number,output:number,latency:number,model?:string) {
    if(!Number.isFinite(input)||!Number.isFinite(output)||input<0||output<0)throw new Error('接口未返回有效用量');
    this.db.prepare("UPDATE calls SET input=?,output=?,reserved=0,latency=?,status='complete',model=COALESCE(?,model) WHERE id=? AND status IN ('pending','unknown')").run(Math.ceil(input),Math.ceil(output),latency,model??null,id);
  }
  fail(id:string,error:string,knownNotExecuted:boolean,latency=0) {this.db.prepare('UPDATE calls SET status=?,error=?,reserved=CASE WHEN ? THEN 0 ELSE reserved END,latency=? WHERE id=? AND status=\'pending\'').run(knownNotExecuted?'failed':'unknown',error,knownNotExecuted?1:0,latency,id);}
  usage():Usage {
    const total=this.db.prepare('SELECT COALESCE(SUM(input),0) AS input,COALESCE(SUM(output),0) AS output,COALESCE(SUM(reserved),0) AS reserved,COUNT(*) AS calls FROM calls').get() as {input:number;output:number;reserved:number;calls:number};
    const byProvider:Usage['byProvider']={};
    for(const r of this.db.prepare('SELECT provider,SUM(input) AS input,SUM(output) AS output,COUNT(*) AS calls,CAST(AVG(latency) AS INTEGER) AS latency FROM calls GROUP BY provider').all() as unknown as {provider:string;input:number;output:number;calls:number;latency:number}[])byProvider[r.provider]=r;
    return {...total,used:total.input+total.output,limit:this.limit,unknown:(this.db.prepare("SELECT COUNT(*) AS n FROM calls WHERE status='unknown'").get() as {n:number}).n,byProvider,recent:this.db.prepare('SELECT * FROM calls ORDER BY created DESC LIMIT 12').all() as unknown as CallRecord[]};
  }
  close(){this.db.close();}
}
