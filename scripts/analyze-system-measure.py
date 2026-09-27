"""Summarize the isolated live measurement without exporting private prompt text."""
import collections
import datetime
import json
import math
import sqlite3
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / 'output/system-measure'
name='replacement' if '--deepseek-replacement' in sys.argv else 'current'
run = json.loads((out / f'{name}-results.json').read_text())
db = sqlite3.connect(f'file:{out / name / "valleytown.sqlite"}?mode=ro', uri=True)
db.row_factory = sqlite3.Row
calls = [dict(r) for r in db.execute('SELECT * FROM calls WHERE created >= ?', (run['start'],))]
traces = [json.loads(r['json']) for r in db.execute('SELECT json FROM action_traces WHERE created >= ?', (run['start'],))]
events = [json.loads(r['json']) for r in db.execute('SELECT json FROM events')]
events = [e for e in events if run['startClock'] < e['at'] <= run['endClock']]

def percentile(values, p):
    values = sorted(values)
    return values[max(0, math.ceil(len(values)*p)-1)] if values else None

def stats(rows):
    good = [r for r in rows if r['status'] == 'complete']
    return dict(attempts=len(rows), statuses=dict(collections.Counter(r['status'] for r in rows)),
        input=sum(r['input'] for r in rows), output=sum(r['output'] for r in rows),
        cachedInput=sum(r['cached_input'] for r in rows),
        costCny=sum(r['cost_nano'] for r in rows)/1e9,
        reservedCny=sum(r['reserved_nano'] for r in rows)/1e9,
        successP50Ms=percentile([r['latency'] for r in good], .5),
        successP95Ms=percentile([r['latency'] for r in good], .95),
        allAttemptsP95Ms=percentile([r['latency'] for r in rows], .95))

samples = run['samples']
waiting = sum(s['timing']['waitingForApi'] for s in samples)
groups = {}
for r in calls:
    groups.setdefault(r['provider'] + ':' + r['purpose'], []).append(r)
action_times = [t['modelMs'] for t in traces if 'finishedAt' in t]
applied = sum(t['status'] in ['applied', 'overridden'] for t in traces)
summary = {k:v for k,v in run.items() if k != 'samples'}
summary.update({
    'startedAtBeijing': datetime.datetime.fromtimestamp(run['start']/1000, datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
    'endedAtBeijing': datetime.datetime.fromtimestamp(run['stop']/1000, datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
    'validPerformanceMeasurement': any(r['status']=='complete' for r in calls),
    'total': stats(calls),
    'providers': {p:stats([r for r in calls if r['provider']==p]) for p in ['Jev','DeepSeek']},
    'purposes': {p:stats(rows) for p,rows in groups.items()},
    'actions': dict(logicalDecisions=len(traces), statuses=dict(collections.Counter(t['status'] for t in traces)),
        selected=dict(collections.Counter(t.get('selected','missing') for t in traces)),
        triggers=dict(collections.Counter(t['facts'].get('trigger','unknown') for t in traces)),
        modelP50Ms=percentile(action_times,.5), modelP95Ms=percentile(action_times,.95),
        queueP50Ms=percentile([t['queueMs'] for t in traces],.5), queueP95Ms=percentile([t['queueMs'] for t in traces],.95),
        appliedPerWallMinute=applied/run['seconds']*60,
        decisionsWithRetry=sum(len(t['attempts'])>1 for t in traces)),
    'events': dict(collections.Counter(e['kind'] for e in events)),
    'sampledSynchronization': dict(waitingSamples=waiting,totalSamples=len(samples),
        reasons=dict(collections.Counter(s['performance']['synchronization']['reason'] for s in samples if s['performance'].get('synchronization')))),
    'averageActive': {lane:sum(s['performance']['active'][lane] for s in samples)/len(samples) for lane in ['action','dialogue','background']},
    'peakActive': {lane:max(s['performance']['active'][lane] for s in samples) for lane in ['action','dialogue','background']},
    'knownCostPerGameHourCny': sum(r['cost_nano'] for r in calls)/1e9/run['gameMinutes']*60,
    'failureReasons': [dict(provider=p,reason=e,count=n) for (p,e),n in collections.Counter((r['provider'],r['error']) for r in calls if r['status']!='complete').items()],
    'maxLogicalActionMs': max(action_times, default=None),
    'notes': [
        'Fees use returned usage, recorded cache hits and local prices; supplier invoices are authoritative.',
        'Requests begun in the window include settlement after pausing; unknown reservations are separate.',
        'Applied actions include movement and waiting, and are not equivalent to completed productive activities.',
        'Event counts include completion of activities inherited from the starting save.',
        'Synchronization counts are one-second samples, not precise blocked-time measurements.',
        'Single 24-resident run, no browser FPS measurement; comparison requires the other arm.'
    ]
})
(out/('replacement-summary.json' if name=='replacement' else 'summary.json')).write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
