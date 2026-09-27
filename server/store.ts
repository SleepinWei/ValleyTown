import { budgetProviders, type BudgetLimits, type BudgetProvider } from '../shared/budget';
import { MONEY_SCALE, DEFAULT_LIMITS, pricing, costNano, validateLimit, type CallPricing } from './pricing';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ActionTrace, LabRun } from '../shared/telemetry';
import type { WorldState, Usage, CallRecord, TownEvent } from '../shared/types';

export class BudgetError extends Error { constructor(public provider?:BudgetProvider){super(`${provider??'模型'} 金额池额度不足，模拟已暂停`);} }
export class Store {
  db: DatabaseSync;
  private usageCache?:Usage;
  private usageDataVersion=-1;
  private savedEvents=new Set<string>();
  private rememberEvent(id:string){this.savedEvents.add(id);if(this.savedEvents.size>2000)this.savedEvents.delete(this.savedEvents.values().next().value!);}
  constructor(public dir:string, initialLimits:BudgetLimits=DEFAULT_LIMITS) {
    mkdirSync(dir,{recursive:true});this.db=new DatabaseSync(join(dir,'valleytown.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS story_summaries(fingerprint TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS action_traces(id TEXT PRIMARY KEY, created INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lab_runs(id TEXT PRIMARY KEY, created INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS world(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS saves(id TEXT PRIMARY KEY, label TEXT NOT NULL, created INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, provider TEXT NOT NULL, purpose TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL, latency INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, error TEXT, imported TEXT);
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS calls_created ON calls(created); CREATE INDEX IF NOT EXISTS action_traces_created ON action_traces(created); CREATE INDEX IF NOT EXISTS lab_runs_created ON lab_runs(created)');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const setting=this.db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
      for(const provider of budgetProviders)setting.run(`budget_cny_${provider}`,String(validateLimit(initialLimits[provider])));
      const exchange=Number(process.env.JEV_USD_CNY??7);this.validateExchange(exchange);
      setting.run('jev_usd_cny',String(exchange));
      const columns=new Set((this.db.prepare('PRAGMA table_info(calls)').all() as {name:string}[]).map(c=>c.name));
      for(const [name,type] of Object.entries({cost_nano:'INTEGER NOT NULL DEFAULT 0',reserved_nano:'INTEGER NOT NULL DEFAULT 0',pricing:'TEXT',cached_input:'INTEGER NOT NULL DEFAULT 0',legacy_cost:'INTEGER NOT NULL DEFAULT 0'}))if(!columns.has(name))this.db.exec(`ALTER TABLE calls ADD COLUMN ${name} ${type}`);
      // Old ledgers have no cache details or separate input/output reservations.
      // Charge known tokens conservatively, preserving unknown requests in their own pool.
      for(const row of this.db.prepare('SELECT * FROM calls WHERE pricing IS NULL').all() as unknown as CallRecord[]){
        const provider=this.provider(row.provider),rate=pricing(provider,this.usdCny);
        const reserved=Math.ceil(row.reserved*Math.max(rate.input,rate.output)*1000);
        this.db.prepare('UPDATE calls SET cost_nano=?,reserved_nano=?,pricing=?,legacy_cost=1 WHERE id=?').run(costNano(rate,row.input,row.output),reserved,JSON.stringify(rate),row.id);
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');this.db.close();throw error;}
    // A crash does not prove that the upstream request was free. Preserve its reservation.
    this.db.prepare("UPDATE calls SET status='unknown',error='请求在上次运行中中断，用量待核对' WHERE status='pending'").run();
  }
  recordEvent(event:TownEvent){this.db.prepare('INSERT OR IGNORE INTO events(id,json) VALUES (?,?)').run(event.id,JSON.stringify(event));this.rememberEvent(event.id);}
  eventsByIds(ids:string[]):TownEvent[]{
    const result:TownEvent[]=[];
    for(let i=0;i<ids.length;i+=400){const batch=ids.slice(i,i+400);const rows=this.db.prepare(`SELECT json FROM events WHERE id IN (${batch.map(()=>'?').join(',')})`).all(...batch) as {json:string}[];result.push(...rows.map(r=>JSON.parse(r.json)));}
    return result;
  }
  storySummary(fingerprint:string){const row=this.db.prepare('SELECT json FROM story_summaries WHERE fingerprint=?').get(fingerprint) as {json:string}|undefined;return row?JSON.parse(row.json):null;}
  saveStorySummary(fingerprint:string,value:unknown){this.db.prepare('INSERT OR REPLACE INTO story_summaries VALUES (?,?)').run(fingerprint,JSON.stringify(value));}
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
      const freshEvents=world.events.filter(e=>!this.savedEvents.has(e.id));
      for(const e of freshEvents)statement.run(e.id,JSON.stringify(e));
      this.db.exec('COMMIT');for(const e of freshEvents)this.rememberEvent(e.id);
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  archive(world:WorldState,label:string) {const id=randomUUID();this.db.prepare('INSERT INTO saves VALUES (?,?,?,?)').run(id,label,Date.now(),JSON.stringify(world));return id;}
  saves(){return this.db.prepare('SELECT id,label,created FROM saves ORDER BY created DESC LIMIT 30').all();}
  restore(id:string):WorldState {const r=this.db.prepare('SELECT json FROM saves WHERE id=?').get(id) as {json:string}|undefined;if(!r)throw new Error('存档不存在');return JSON.parse(r.json);}
  private provider(value:string):BudgetProvider {if(!budgetProviders.includes(value as BudgetProvider))throw new Error('未知模型供应商');return value as BudgetProvider;}
  private validateExchange(value:number){if(!Number.isFinite(value)||value<=0||value>100)throw new Error('请输入有效的美元兑人民币汇率（0–100）');}
  get usdCny(){return Number((this.db.prepare("SELECT value FROM settings WHERE key='jev_usd_cny'").get() as {value:string}).value);}
  setExchange(value:number){this.validateExchange(value);this.db.prepare("UPDATE settings SET value=? WHERE key='jev_usd_cny'").run(String(value));this.usageCache=undefined;}
  private limitNano(provider:BudgetProvider){return Number((this.db.prepare('SELECT value FROM settings WHERE key=?').get(`budget_cny_${provider}`) as {value:string}).value);}
  setLimit(provider:BudgetProvider,limit:number){this.provider(provider);const nano=validateLimit(limit);this.db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(nano),`budget_cny_${provider}`);this.usageCache=undefined;}
  exhaustedProvider(providers:readonly BudgetProvider[]=budgetProviders){const usage=this.usage();return providers.find(provider=>{const p=usage.pools[provider];return p.remainingCny<=0;});}
  reserve(provider:BudgetProvider,purpose:string,model:string,input:number,output=0) {
    this.provider(provider);
    if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)throw new Error('无效的预留用量');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const rate=pricing(provider,this.usdCny),amount=costNano(rate,input,output);
      const r=this.db.prepare('SELECT COALESCE(SUM(cost_nano+reserved_nano),0) AS total FROM calls WHERE provider=?').get(provider) as {total:number};
      if(r.total>=this.limitNano(provider)||r.total+amount>this.limitNano(provider))throw new BudgetError(provider);
      const id=randomUUID();this.db.prepare("INSERT INTO calls(id,provider,purpose,model,status,reserved,reserved_nano,pricing,created) VALUES (?,?,?,?,'pending',?,?,?,?)").run(id,provider,purpose,model,input+output,amount,JSON.stringify(rate),Date.now());
      this.db.exec('COMMIT');this.usageCache=undefined;return id;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  settle(id:string,input:number,output:number,latency:number,model?:string,cachedInput=0) {
    if(!Number.isSafeInteger(input)||!Number.isSafeInteger(output)||input<0||output<0||!Number.isSafeInteger(cachedInput)||cachedInput<0||cachedInput>input)throw new Error('接口未返回有效用量');
    const row=this.db.prepare('SELECT pricing FROM calls WHERE id=?').get(id) as {pricing:string}|undefined;
    if(!row)throw new Error('调用记录不存在');
    const amount=costNano(JSON.parse(row.pricing) as CallPricing,input,output,cachedInput);
    this.db.prepare("UPDATE calls SET input=?,output=?,cached_input=?,cost_nano=?,reserved=0,reserved_nano=0,latency=?,status='complete',model=COALESCE(?,model) WHERE id=? AND status IN ('pending','unknown')").run(input,output,cachedInput,amount,latency,model??null,id);this.usageCache=undefined;
  }
  fail(id:string,error:string,knownNotExecuted:boolean,latency=0) {this.db.prepare("UPDATE calls SET status=?,error=?,reserved=CASE WHEN ? THEN 0 ELSE reserved END,reserved_nano=CASE WHEN ? THEN 0 ELSE reserved_nano END,latency=? WHERE id=? AND status='pending'").run(knownNotExecuted?'failed':'unknown',error,knownNotExecuted?1:0,knownNotExecuted?1:0,latency,id);this.usageCache=undefined;}
  usage():Usage {
    // Detect other SQLite writers too; reservations still use a fresh atomic SQL sum.
    const version=(this.db.prepare('PRAGMA data_version').get() as {data_version:number}).data_version;
    if(this.usageCache&&version===this.usageDataVersion)return this.usageCache;
    this.usageDataVersion=version;
    const total=this.db.prepare('SELECT COALESCE(SUM(input),0) AS input,COALESCE(SUM(output),0) AS output,COALESCE(SUM(reserved),0) AS reserved,COUNT(*) AS calls FROM calls').get() as {input:number;output:number;reserved:number;calls:number};
    const byProvider:Usage['byProvider']={};
    for(const r of this.db.prepare('SELECT provider,SUM(input) AS input,SUM(output) AS output,COUNT(*) AS calls,CAST(AVG(latency) AS INTEGER) AS latency FROM calls GROUP BY provider').all() as unknown as {provider:string;input:number;output:number;calls:number;latency:number}[])byProvider[r.provider]=r;
    const pools={} as Usage['pools'];
    for(const provider of budgetProviders){
      const r=this.db.prepare('SELECT COALESCE(SUM(cost_nano),0) AS spent,COALESCE(SUM(reserved_nano),0) AS reserved,COALESCE(SUM(legacy_cost),0) AS legacy FROM calls WHERE provider=?').get(provider) as {spent:number;reserved:number;legacy:number};
      const limit=this.limitNano(provider);pools[provider]={limitCny:limit/MONEY_SCALE,spentCny:r.spent/MONEY_SCALE,reservedCny:r.reserved/MONEY_SCALE,remainingCny:Math.max(0,limit-r.spent-r.reserved)/MONEY_SCALE,legacyCalls:r.legacy};
    }
    return this.usageCache={...total,used:total.input+total.output,currency:'CNY',pools,usdCny:this.usdCny,unknown:(this.db.prepare("SELECT COUNT(*) AS n FROM calls WHERE status='unknown'").get() as {n:number}).n,byProvider,recent:this.db.prepare('SELECT * FROM calls ORDER BY created DESC LIMIT 12').all() as unknown as CallRecord[]};
  }
  close(){this.db.close();}
}
