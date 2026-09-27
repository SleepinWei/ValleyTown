"""Build a benchmark-only code copy and consistent SQLite snapshot; never edit production."""
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

root=Path(__file__).resolve().parents[1]
out=root/'output/system-measure'
code=out/'replacement-code'
data=out/'replacement'
if code.exists() or data.exists():
    raise SystemExit('Replacement directory already exists; preserve its ledger and choose a new run explicitly.')
baseline=json.loads((out/'summary.json').read_text())
for path,digest in baseline['sourceHashes'].items():
    if hashlib.sha256((root/path).read_bytes()).hexdigest()!=digest:
        raise SystemExit(f'Baseline source changed: {path}')
for name in ['server','shared']:
    shutil.copytree(root/name,code/name)
data.mkdir()
source=sqlite3.connect(f'file:{root/"data/valleytown.sqlite"}?mode=ro',uri=True)
dest=sqlite3.connect(data/'valleytown.sqlite');source.backup(dest)
world=json.loads(dest.execute('select json from world').fetchone()[0])
if world['clock']!=baseline['startClock']:
    raise SystemExit('Starting world clock no longer matches baseline.')
initial_hash=hashlib.sha256(json.dumps(world,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
dest.close();source.close()
model=code/'server/models.ts'
text=model.read_text()
start=text.index('  async jev(')
end=text.index('  async chooseText(',start)
text=text[:start]+'''  async jev(state:unknown,questions:Record<string,Question>,purpose='decision'):Promise<JevResult>{
    const result=await this.text(replacementInstruction,{state,questions},`replacement:${purpose}`,Math.max(128,Object.keys(questions).length*96));
    return {answers:replacementAnswers(result.text,questions),model:result.model,input:result.input,output:result.output,latency:result.latency};
  }
'''+text[end:]
text="import { replacementInstruction, replacementAnswers } from '../../../../scripts/deepseek-replacement-adapter';\n"+text
old="...purpose==='benchmark-action'?{response_format:{type:'json_object'}}:{}"
if old not in text: raise SystemExit('Structured output patch target changed')
text=text.replace(old,"...(purpose==='benchmark-action'||purpose.startsWith('replacement:'))?{response_format:{type:'json_object'}}:{}")
model.write_text(text)
manifest={'baselineSourceCommit':baseline['sourceCommit'],'startingClock':world['clock'],'initialWorldSha256':initial_hash,
  'substitution':'All ModelGateway.jev calls replaced by non-thinking DeepSeek JSON; original text calls unchanged.',
  'confidence':'Self-rated DS confidence with unchanged runtime thresholds; no fabricated probabilities.',
  'outputCap':'max(128,96 * questionCount)', 'codeDirectory':str(code), 'dataDirectory':str(data)}
(out/'replacement-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(manifest,ensure_ascii=False))
