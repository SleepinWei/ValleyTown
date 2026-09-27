import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { Store } from '../server/store';
import { World } from '../server/world';
import { advanceIncidents, incidentCatalog, setIncidentPace, triggerIncident } from '../server/incidents';
import { location } from '../shared/map';
import { freshIncidents } from '../shared/incidents';
import { createApp } from '../server/app';

function fixture() {
  const dir = mkdtempSync('/private/tmp/valley-incidents-'), store = new Store(dir), w = new World(store, 'demo');
  for (const a of w.state.actors) { a.nextDecision = a.nextPlan = 1e9; }
  return { w, store, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function only(w: World, id: string) {
  w.state.incidents.cooldowns = Object.fromEntries(incidentCatalog.filter(e => e.id !== id).map(e => [e.id, 1e9]));
}

test('first incident follows game time, freezes on pause, and persists without replay after restart', async () => {
  const f = fixture(); try {
    const { w } = f;
    w.tick(1); assert.equal(w.state.incidents.lastAt, null);
    w.resume(); for (let i = 0; i < 4; i++) w.tick(1);
    assert.equal(w.state.incidents.lastAt, null);
    for (let i = 0; i < 3; i++) w.tick(1);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(w.state.events.some(e => e.kind === 'incident'));
    const state = structuredClone(w.state.incidents), count = w.state.events.length;
    w.pause(); w.tick(1); assert.deepEqual(w.state.incidents, state);
    const restarted = new World(f.store); assert.deepEqual(restarted.state.incidents, state);
    restarted.resume(); advanceIncidents(restarted); assert.equal(restarted.state.events.length, count);
    assert.equal(f.store.usage().calls, 0);
  } finally { f.close(); }
});

test('portrait consumes real materials, records only participants, and respects cooldowns', () => {
  const f = fixture(); try {
    const { w } = f; w.resume(); only(w, 'portrait');
    const a = w.actor('painter'), b = w.actor('baker'), outsider = w.actor('fisher');
    for (const p of w.state.actors) p.busy = true;
    a.busy = b.busy = false; Object.assign(a, location('square').door); Object.assign(b, location('square').door);
    a.inventory.paper = 2; const notes = b.inventory.note ?? 0, trust = b.relations[a.id].trust, memories = outsider.memories.length;
    const e = triggerIncident(w, true)!; assert.ok(e); assert.match(e.text, /速写赠礼/);
    assert.equal(a.inventory.paper, 1); assert.equal(b.inventory.note, notes + 1); assert.equal(b.relations[a.id].trust, trust + 1);
    assert.ok(a.memories.some(m => m.source === e.id)); assert.ok(b.memories.some(m => m.source === e.id)); assert.equal(outsider.memories.length, memories);
    assert.equal(triggerIncident(w, true), null); assert.equal(a.inventory.paper, 1);
    assert.ok(w.snapshot().events.some(x => x.id === e.id));
  } finally { f.close(); }
});

test('weather, distance, life state, busy work and absent inventory block unsuitable scenes', () => {
  const f = fixture(); try {
    const { w } = f; w.resume(); only(w, 'portrait');
    const a = w.actor('painter'), b = w.actor('baker');
    for (const p of w.state.actors) p.busy = true;
    a.busy = b.busy = false; Object.assign(a, location('square').door); Object.assign(b, location('square').door); a.inventory.paper = 1;
    w.state.weather = '雷雨'; assert.equal(triggerIncident(w), null); w.state.weather = '晴朗';
    b.x += 10; assert.equal(triggerIncident(w), null); b.x -= 10;
    b.life.status = 'dead'; assert.equal(triggerIncident(w), null); b.life.status = 'alive';
    b.life.custody = { caseId: 'test', releaseAt: 900 }; assert.equal(triggerIncident(w), null); b.life.custody = null;
    b.busy = true; assert.equal(triggerIncident(w), null); b.busy = false;
    a.localTask = { candidate: { kind: 'work', label: '工作' }, startedAt: 480, endsAt: 520 }; assert.equal(triggerIncident(w), null); a.localTask = null;
    a.inventory.paper = 0; assert.equal(triggerIncident(w), null); a.inventory.paper = 1;
    assert.ok(triggerIncident(w));
  } finally { f.close(); }
});

test('showcase delivers substantially more varied events than natural pace without consecutive repeats', () => {
  const run = (pace: 'natural' | 'showcase') => {
    const f = fixture(); try {
      const { w } = f; w.resume(); setIncidentPace(w, pace);
      for (const a of w.state.actors) { Object.assign(a, location('market').door); a.inventory.paper = 100; }
      for (let minute = 480; minute < 1200; minute++) { w.state.clock = minute; advanceIncidents(w); }
      const events = w.state.events.filter(e => e.kind === 'incident');
      for (let i = 1; i < events.length; i++) assert.notEqual(events[i].source, events[i - 1].source);
      return { count: events.length, types: new Set(events.map(e => e.source)).size };
    } finally { f.close(); }
  };
  const lively = run('showcase'), natural = run('natural');
  assert.ok(lively.count >= 15, JSON.stringify(lively)); assert.ok(lively.types >= 5); assert.ok(lively.count > natural.count * 3);
});

test('legacy save gets showcase defaults while chosen pace and cooldowns survive reload', () => {
  const f = fixture(); try {
    const legacy = structuredClone(f.w.state); delete (legacy as Partial<typeof legacy>).incidents; f.store.save(legacy);
    const migrated = new World(f.store); assert.deepEqual(migrated.state.incidents, freshIncidents(legacy.clock));
    setIncidentPace(migrated, 'natural'); migrated.persist(); assert.equal(new World(f.store).state.incidents.pace, 'natural');
  } finally { f.close(); }
});

test('a single eligible type can return after cooldown instead of permanently starving the director', () => {
  const f = fixture(); try {
    const { w } = f; w.resume(); only(w, 'cat');
    assert.ok(triggerIncident(w));
    w.state.clock += 20; assert.equal(triggerIncident(w), null);
    w.state.clock += 80; assert.ok(triggerIncident(w));
  } finally { f.close(); }
});

test('API validates pace and manual trigger is paused-safe and idempotent', async () => {
  const f = fixture(), app = await createApp(f.w); try {
    const bootstrap = await app.inject('/api/bootstrap'), headers = { cookie: String(bootstrap.headers['set-cookie']).split(';')[0] };
    const send = (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers, payload: payload as any });
    assert.equal((await send('/api/control', { action: 'incident-pace', value: 'wild' })).statusCode, 400);
    assert.equal((await send('/api/control', { action: 'incident-pace', value: 'natural' })).statusCode, 200);
    assert.equal(f.w.snapshot().incidents.pace, 'natural');
    const payload = { commandId: 'one-incident', type: 'incident' };
    assert.equal((await send('/api/commands', payload)).statusCode, 400);
    f.w.resume(); const first = await send('/api/commands', payload); assert.equal(first.statusCode, 200);
    const second = await send('/api/commands', payload); assert.equal(second.json().event.id, first.json().event.id);
    assert.equal(f.w.state.events.filter(e => e.kind === 'incident').length, 1);
  } finally { await app.close(); f.close(); }
});
