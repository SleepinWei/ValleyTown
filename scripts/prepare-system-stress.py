"""Prepare an isolated speed-ceiling test; production source and database stay untouched."""
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

root=Path(__file__).resolve().parents[1]
out=root/'output/system-stress'
if out.exists(): raise SystemExit('Stress output already exists; preserve ledger and choose a new run explicitly.')
out.mkdir()
for name in ['server','shared']: shutil.copytree(root/name,out/'code'/name)
source=sqlite3.connect(f'file:{root/"data/valleytown.sqlite"}?mode=ro',uri=True)
dest=sqlite3.connect(out/'initial.sqlite');source.backup(dest)
world=json.loads(dest.execute('select json from world').fetchone()[0]);dest.close();source.close()
for speed in [6,12,24,48,96,192]:
    target=out/f'x{speed}';target.mkdir();shutil.copy2(out/'initial.sqlite',target/'valleytown.sqlite')

def patch(path,old,new):
    s=path.read_text()
    if s.count(old)!=1: raise SystemExit(f'Patch target not unique: {path.name}: {old}')
    path.write_text(s.replace(old,new))

code=out/'code/server'
patch(code/'app.ts','z.number().finite().min(5).max(120).parse(b.value)','z.number().finite().min(30/192).max(120).parse(b.value)')
patch(code/'world.ts','  private lastSync?:','  stressStats={syncCount:0,syncMs:0};\n  private lastSync?:')
patch(code/'world.ts','this.lastSync={reason,actors,waitMs:Date.now()-startedAt};this.syncing=null;',
      'this.lastSync={reason,actors,waitMs:Date.now()-startedAt};this.stressStats.syncCount++;this.stressStats.syncMs+=this.lastSync.waitMs;this.syncing=null;')
patch(code/'worker-runtime.ts','const world=new World(store,workerData.mode);',
'''const world=new World(store,workerData.mode);
const tickStats={count:0,totalMs:0,maxMs:0,over100ms:0};const cpuStart=process.cpuUsage();
const originalTick=world.tick.bind(world);
world.tick=(seconds:number)=>{const start=performance.now();try{originalTick(seconds);}finally{const ms=performance.now()-start;tickStats.count++;tickStats.totalMs+=ms;tickStats.maxMs=Math.max(tickStats.maxMs,ms);if(ms>100)tickStats.over100ms++;}};
function stressMetrics(){return {ticks:{...tickStats},cpu:process.cpuUsage(cpuStart),sync:{...world.stressStats}};}
''')
patch(code/'worker-runtime.ts','player:{...world.snapshot(false),runtime:', 'player:{...world.snapshot(false),stressBenchmark:stressMetrics(),runtime:')
manifest={'speeds':[6,12,24,48,96,192],'durationSecondsPerStage':45,'additionalBudgetCny':{'Jev':2.4,'DeepSeek':.6},
  'initialClock':world['clock'],'population':len(world['actors']),
  'initialWorldSha256':hashlib.sha256(json.dumps(world,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),
  'sourceHashes':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for name in ['server','shared'] for p in (root/name).glob('*') if p.is_file()},
  'changes':['Speed validation permits up to 192x in isolated copy only.','Lightweight tick/CPU/synchronization timing.'],
  'unchanged':['Model routes and prompts','Action candidate generation and validation','Action/dialogue/background pools 12/3/4','1.5 second per-actor scheduling throttle','Simulation synchronization rules']}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in manifest.items() if k!='sourceHashes'},ensure_ascii=False))
