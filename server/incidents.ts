import { clamp, freeAdult, type Actor } from '../shared/types';
import { distance, items, location, locations } from '../shared/map';
import { incidentPacing, type IncidentPace } from '../shared/incidents';
import { random } from './society';
import type { World } from './world';

type Cast = Actor[];
interface Incident {
  id: string; title: string; weight: number;
  casts: (w: World, available: Actor[]) => Cast[];
  apply: (w: World, cast: Cast) => string;
}
const daytime = (w: World) => w.state.clock % 1440 >= 360 && w.state.clock % 1440 < 1200;
const calm = (w: World) => ['晴朗', '多云'].includes(w.state.weather);
const near = (a: Actor, site: string) => distance(a, location(site).door) <= 7;
const singles = (actors: Actor[]) => actors.map(a => [a]);
const pairs = (actors: Actor[]) => actors.flatMap((a, i) => actors.slice(i + 1).filter(b => distance(a, b) <= 6).map(b => [a, b]));
const friendly = ([a, b]: Cast) => (a.relations[b.id]?.resentment ?? 0) < 30 && (b.relations[a.id]?.resentment ?? 0) < 30;
const bond = (w: World, a: Actor, b: Actor) => { w.relationship(a, b.id, { affection: 2, trust: 1 }); w.relationship(b, a.id, { affection: 2, trust: 1 }); };

// These are local world occurrences, not model dialogue or predetermined romance.
export const incidentCatalog: Incident[] = [
  { id: 'cat', title: '猫咪带路', weight: 5,
    casts: (w, a) => daytime(w) && calm(w) ? singles(a) : [],
    apply: (_w, [a]) => { a.mood = '忍俊不禁'; return `一只橘猫绕着${a.name}转了三圈，又一本正经地坐在路中央，像是在收过路费。${a.name}被逗笑了。`; } },
  { id: 'hat', title: '飞帽奇遇', weight: 5,
    casts: (w, a) => daytime(w) && calm(w) ? pairs(a).filter(friendly) : [],
    apply: (w, [a, b]) => { bond(w, a, b); a.mood = b.mood = '开心'; return `一阵风吹走${a.name}的帽子，恰好被旁边的${b.name}接住。两人笑着道谢，多了一点亲近。`; } },
  { id: 'parcel', title: '失物归还', weight: 4,
    casts: (w, a) => daytime(w) ? pairs(a).filter(([owner]) => Object.keys(owner.inventory).some(k => items[k] && owner.inventory[k] > 0)) : [],
    apply: (w, [a, b]) => { const item = Object.keys(a.inventory).find(k => items[k] && a.inventory[k] > 0)!; w.relationship(a, b.id, { trust: 3, affection: 2 }); return `${a.name}的一份${items[item].name}从口袋滑落，${b.name}当场捡起归还。物品完好，${a.name}更信任这位邻居了。`; } },
  { id: 'bread', title: '爱心面包', weight: 4,
    casts: (w, a) => daytime(w) ? singles(a.filter(p => p.role === '面包师' && near(p, 'bakery') && (p.inventory.bread ?? 0) > 0)) : [],
    apply: (_w, [a]) => { a.mood = '惊喜'; return `${a.name}整理刚做好的面包时，发现其中一只意外长成了爱心形状，决定把它留作今天的小彩蛋。`; } },
  { id: 'music', title: '街角即兴曲', weight: 5,
    casts: (w, a) => daytime(w) && calm(w) ? a.filter(p => p.role === '乐师').map(p => [p, ...a.filter(b => b !== p && distance(p, b) <= 6).slice(0, 3)]) : [],
    apply: (w, [a, ...listeners]) => { for (const b of [a, ...listeners]) { b.mood = '轻快'; b.energy = clamp(b.energy + 3, 0, 100); } return `${a.name}即兴弹起一段欢快的旋律。${listeners.length ? `${listeners.map(b => b.name).join('、')}在旁听见，跟着打起拍子。` : '曲子把平常的街角变成了一座小舞台。'}`; } },
  { id: 'portrait', title: '速写赠礼', weight: 4,
    casts: (w, a) => daytime(w) && calm(w) ? a.filter(p => p.role === '画师' && (p.inventory.paper ?? 0) > 0).flatMap(p => a.filter(b => b !== p && distance(p, b) <= 6 && friendly([p, b])).map(b => [p, b])) : [],
    apply: (w, [a, b]) => { a.inventory.paper--; b.inventory.note = (b.inventory.note ?? 0) + 1; bond(w, a, b); return `${a.name}用一张画纸给身旁的${b.name}画了张趣味速写。${b.name}笑着收下，背包里多了一份画着小像的便条。`; } },
  { id: 'berries', title: '野莓惊喜', weight: 3,
    casts: (w, a) => daytime(w) && calm(w) ? singles(a.filter(p => ['garden', 'foresttrail', 'lakecamp'].some(site => near(p, site)))) : [],
    apply: (_w, [a]) => { a.inventory.berries = (a.inventory.berries ?? 0) + 1; a.mood = '惊喜'; return `${a.name}在路边发现一小簇熟透的野莓，采下一份放进背包，留下其余的给鸟儿。`; } },
  { id: 'rain', title: '屋檐听雨', weight: 5,
    casts: (w, a) => ['细雨', '雷雨'].includes(w.state.weather) ? pairs(a).filter(c => friendly(c) && locations.some(l => ['shop', 'home'].includes(l.kind) && c.every(p => distance(p, l.door) <= 4))) : [],
    apply: (w, [a, b]) => { bond(w, a, b); a.mood = b.mood = '放松'; return `${a.name}和${b.name}在同一处屋檐下避雨，发现雨点敲在桶上恰好像一段鼓点，两人相视一笑。`; } },
  { id: 'fireflies', title: '萤火微光', weight: 5,
    casts: (w, a) => !daytime(w) && calm(w) ? singles(a.filter(p => ['garden', 'riverside', 'lakecamp', 'foresttrail'].some(site => near(p, site)))) : [],
    apply: (_w, [a]) => { a.mood = '宁静'; a.energy = clamp(a.energy + 5, 0, 100); return `${a.name}在草丛边发现一小群萤火虫，停下来静静看了一会儿，疲惫也消散了一些。`; } },
  { id: 'mixup', title: '同款包裹乌龙', weight: 2,
    casts: (w, a) => daytime(w) ? pairs(a).filter(([x, y]) => near(x, 'market') && near(y, 'market') && friendly([x, y])) : [],
    apply: (w, [a, b]) => { w.relationship(a, b.id, { resentment: 2 }); w.relationship(b, a.id, { resentment: 2 }); return `${a.name}和${b.name}差点在杂货铺门口拿错同款包裹。核对后各自拿回东西，但一句急话让两人都有点介意。`; } },
];

export function setIncidentPace(w: World, pace: IncidentPace) {
  if (w.state.incidents.pace === pace) return;
  w.state.incidents.pace = pace;
  w.state.incidents.misses = 0;
  w.state.incidents.nextAt = w.state.clock + (pace === 'showcase' ? 4 : incidentPacing.natural.minDelay);
}

export function triggerIncident(w: World, manual = false) {
  if (w.state.status !== 'running_live' || w.lab?.active) return null;
  const s = w.state.incidents, now = w.state.clock, rules = incidentPacing[s.pace];
  if (s.lastAt !== null && now - s.lastAt < 6) return null;
  const available = w.state.actors.filter(a => freeAdult(a) && !a.busy && !a.conversation && !a.outdoor.task && !a.path.length &&
    (!a.localTask || ['wait', 'rest'].includes(a.localTask.candidate.kind)) && (s.actorCooldowns[a.id] ?? 0) <= now &&
    !w.state.appointments.some(p => p.status === 'accepted' && (p.from === a.id || p.to === a.id) && now >= p.at - 30 && now <= p.at + 60));
  const eligible = incidentCatalog.filter(e => (s.cooldowns[e.id] ?? 0) <= now)
    .map(e => ({ e, casts: e.casts(w, available) })).filter(c => c.casts.length);
  const varied = eligible.filter(c => !s.recent.slice(-3).includes(c.e.id));
  const choices = varied.length ? varied : eligible;
  if (!choices.length) return null;
  let roll = random(w) * choices.reduce((n, c) => n + c.e.weight, 0);
  const choice = choices.find(c => (roll -= c.e.weight) < 0) ?? choices[choices.length - 1];
  const cast = choice.casts[Math.floor(random(w) * choice.casts.length)];
  const detail = choice.e.apply(w, cast);
  const event = w.event('incident', `【${choice.e.title}】${detail}`, cast.map(a => a.id), ['public'], `${manual ? '演示触发' : '本地突发事件'} · ${choice.e.id}`);
  for (const a of cast) {
    w.memory(a, event.text, event.id, true);
    a.revision++;
    a.decisionReason = `突发事件：${choice.e.title}`;
    if (!a.localTask) a.nextDecision = now;
    s.actorCooldowns[a.id] = now + rules.actorCooldown;
  }
  s.lastAt = now; s.misses = 0;
  s.recent = [...s.recent, choice.e.id].slice(-6);
  s.cooldowns[choice.e.id] = now + rules.typeCooldown;
  s.nextAt = now + rules.minDelay + random(w) * rules.jitter;
  w.persist();
  return event;
}

export function advanceIncidents(w: World) {
  if (w.state.status !== 'running_live' || w.lab?.active || w.state.clock < w.state.incidents.nextAt) return;
  const s = w.state.incidents, rules = incidentPacing[s.pace];
  s.nextAt = w.state.clock + rules.minDelay + random(w) * rules.jitter;
  const guaranteed = s.pace === 'showcase' && (s.lastAt === null || s.misses >= 2);
  if ((guaranteed || random(w) < rules.chance) && triggerIncident(w)) return;
  s.misses++;
  // A busy cast retries soon, but never loops or teleports residents to force a scene.
  if (guaranteed) s.nextAt = w.state.clock + 4;
}
