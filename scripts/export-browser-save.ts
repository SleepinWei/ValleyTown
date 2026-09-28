// Read-only, consistent export. Stop the legacy server before exporting its SQLite world.
import { DatabaseSync } from 'node:sqlite';
import { resolve, join, dirname } from 'node:path';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { emptyTownData, validateTownData } from '../engine/browser-store';
import { migrateWorld } from '../server/migrations';
import { pricing, costNano } from '../server/pricing';
const source=resolve(process.argv[2]??'data'),destination=resolve(process.argv[3]??'output/valleytown-browser-save.json');
if(existsSync(destination))throw new Error('目标文件已存在，请选择新的导出文件名。');
const db=new DatabaseSync(join(source,'valleytown.sqlite'),{readOnly:true});
try{
 db.exec('BEGIN');
 const data=emptyTownData(),tables=new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(x=>x.name));
 const rows=(table:string):any[]=>tables.has(table)?db.prepare(`SELECT * FROM ${table}`).all():[];
 const world=rows('world')[0];if(!world)throw new Error('数据库中没有世界存档');
 data.world=migrateWorld(JSON.parse(world.json));data.world.status='paused_manual';
 const settings=Object.fromEntries(rows('settings').map(r=>[r.key,r.value]));data.usdCny=Number(settings.jev_usd_cny??7);
 for(const provider of ['DeepSeek','Jev'] as const)data.limits[provider]=Number(settings[`budget_cny_${provider}`]??10000000000)/1e9;
 for(const r of rows('events'))data.events[r.id]=JSON.parse(r.json);
 for(const r of rows('calls')){
   const rate=r.pricing?JSON.parse(r.pricing):pricing(r.provider,data.usdCny);
   data.calls[r.id]={...r,pricing:rate,legacy_cost:r.pricing?(r.legacy_cost??0):1,cost_nano:r.pricing?r.cost_nano:costNano(rate,r.input,r.output),reserved_nano:r.pricing?r.reserved_nano:Math.ceil(r.reserved*Math.max(rate.input,rate.output)*1000),cached_input:r.cached_input??0};
 }
 data.saves=rows('saves').sort((a,b)=>b.created-a.created).slice(0,30).map(r=>({id:r.id,label:r.label,created:r.created,world:migrateWorld(JSON.parse(r.json))}));
 for(const r of rows('documents'))data.documents[r.id]={id:r.id,actorId:r.id.split(':')[0],revision:r.revision,text:r.text,file:`浏览器存档 / ${r.id}`,imported:r.imported??undefined,error:r.error??undefined};
 for(const [table,field] of [['action_traces','traces'],['lab_runs','labs'],['story_summaries','summaries']] as const)for(const r of rows(table))data[field][r.id??r.fingerprint]=JSON.parse(r.json);
 db.exec('COMMIT');const text=JSON.stringify(validateTownData(data));if(Buffer.byteLength(text)>10000000)throw new Error('存档超过当前 10 MB 导入上限；原数据库未修改。');
 mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,text,{flag:'wx',mode:0o600});console.log(`已导出到 ${destination}。在网页「设置 → 导入备份」中载入；原数据库未修改。`);
}finally{db.close();}
