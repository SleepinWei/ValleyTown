import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Snapshot } from '../shared/types';
import type { IncidentPace } from '../shared/incidents';

export function IncidentSettings({ world, onPace, onTrigger }: {
  world: Snapshot;
  onPace: (pace: IncidentPace) => Promise<unknown>;
  onTrigger: () => Promise<{ event: { text: string } }>;
}) {
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const cooling = world.incidents.lastAt !== null && world.clock - world.incidents.lastAt < 6;
  const act = async (task: () => Promise<string>) => {
    setPending(true); setMessage('');
    try { setMessage(await task()); } catch (e) { setMessage((e as Error).message); }
    finally { setPending(false); }
  };
  return <div className="settings-section incident-settings">
    <h3>突发奇遇</h3>
    <div className="mode-options">
      {([['showcase', '演示高频', '每 14–24 游戏分钟尝试，85% 触发机会'], ['natural', '自然节奏', '每 90–180 游戏分钟尝试，28% 触发机会']] as const).map(([pace, title, detail]) =>
        <button key={pace} className={world.incidents.pace === pace ? 'chosen' : ''} aria-pressed={world.incidents.pace === pace} disabled={pending || world.laboratory?.active} onClick={() => void act(async () => { await onPace(pace); return `已切换为${title}。`; })}><b>{title}</b><span>{detail}</span></button>)}
    </div>
    <p className="hint">10 种生活小插曲，按天气、地点与居民状态发生。演示高频首次在 4 游戏分钟后尝试，连续两次落空后优先补一次；仍需满足现场条件。同类事件与参与居民都有冷却。</p>
    <button className="outline" disabled={pending || world.status !== 'running_live' || world.laboratory?.active || cooling} onClick={() => void act(async () => (await onTrigger()).event.text)}><Sparkles size={16}/>{pending ? '正在安排…' : cooling ? '奇遇冷却中' : '来点惊喜'}</button>
    <p className="hint">开始模拟后可立即尝试一次符合条件的奇遇。现场不合适时会提示稍后重试。事件生成不调用模型，真实 Agent 的后续回应按原有规则计费。</p>
    <p className="hint" role="status">{message}</p>
  </div>;
}
