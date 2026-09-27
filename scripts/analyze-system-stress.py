"""Read-only analysis of the completed stress stages."""
import json
from pathlib import Path

root=Path(__file__).resolve().parents[1]
out=root/'output/system-stress'
data=json.loads((out/'results.json').read_text())
rows=[]
for s in data['stages']:
    stage_id=s.get('stageId',f'x{s["speed"]}')
    raw=json.loads((out/f'{stage_id}-results.json').read_text())
    m=s['instrumentation'];last=raw['samples'][-1] if raw['samples'] else None
    partial=0
    if last and last['performance'].get('synchronization') and last['metrics']['sync']['syncCount']==m['sync']['syncCount']:
        partial=last['performance']['synchronization']['waitMs']
    cost=sum(p['costCny'] for p in s['providers'].values())
    reserved=sum(p['reservedCny'] for p in s['providers'].values())
    rows.append({'stageId':stage_id,'target':s['speed'],'actual':s['actualMultiplier'],'targetAttainment':s['actualMultiplier']/s['speed'],
      'wallSeconds':s['seconds'],'gameHours':s['gameHours'],'stopReason':s['reason'],
      'appliedActionsPerSecond':s['actions']['appliedPerSecond'],'actionsPerGameHour':s['actions']['applied']/s['gameHours'],
      'actionEndToEndP50Ms':s['actions']['endToEndP50'],'actionEndToEndP95Ms':s['actions']['endToEndP95'],
      'queueP95Ms':s['actions']['queueP95'],'logicalActions':s['actions']['count'],'actionStatuses':s['actions']['statuses'],
      'localActivitiesPerGameHour':s['completedLocalActivitiesPerGameHour'],
      'completedWork':s['events'].get('work',0),'completedReadRest':s['events'].get('activity',0),'dialogueMessages':s['events'].get('dialogue',0),
      'httpAttempts':s['attempts'],'httpStatuses':s['calls'],
      'synchronizationMs':m['sync']['syncMs']+partial,'synchronizationFraction':(m['sync']['syncMs']+partial)/1000/s['seconds'],
      'tickHz':m['ticks']['count']/s['seconds'],'tickMeanMs':m['ticks']['totalMs']/max(1,m['ticks']['count']),
      'tickMaxMs':m['ticks']['maxMs'],'ticksOver100Ms':m['ticks']['over100ms'],
      'processCpuCoreFraction':(m['cpu']['user']+m['cpu']['system'])/1e6/s['seconds'],
      'knownCostCny':cost,'unknownReserveCny':reserved,'costPerGameHourCny':s['costPerGameHour']})
repeated={str(t):[r['actual'] for r in rows if r['target']==t] for t in sorted({r['target'] for r in rows}) if sum(r['target']==t for r in rows)>1}
analysis={'rows':rows,'maxObservedActualMultiplier':max(r['actual'] for r in rows),
  'highestSingleRunTargetWith90PercentAttainment':max([r['target'] for r in rows if r['targetAttainment']>=.9],default=None),
  'repeatedTargetActuals':repeated,
  'repeatedTargetsMeeting90PercentInEveryRun':[int(t) for t,values in repeated.items() if min(values)>=int(t)*.9],
  'totalCostCny':sum(r['knownCostCny'] for r in rows),'totalReservedCny':sum(r['unknownReserveCny'] for r in rows),
  'remainingTestAllowance':data['remaining'],
  'limitations':['Short single run per target, sequential ascending order, network and cache conditions can vary.',
    'Same starting snapshot; different decisions and simulated horizons change activity and planning load.',
    '90% target attainment is a reporting criterion, not a guarantee of model quality or long-duration stability.',
    'Tick timings exclude asynchronous model completion processing; process CPU includes the measurement process.',
    'Game clock throughput alone does not establish behavior fidelity; inspect activities per game hour.',
    'The stress test changes only isolated speed validation and instrumentation, not model prompts or pool limits.']}
(out/'analysis.json').write_text(json.dumps(analysis,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(analysis,ensure_ascii=False,indent=2))
