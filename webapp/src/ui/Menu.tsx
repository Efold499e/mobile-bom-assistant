// 报菜名 menu screen (plan section 8, M4): groups are listed as chips in the
// default order; the user taps them top-to-bottom following the physical
// component bags -- the tap sequence becomes the pick order (no dragging).
// Partial picks are forgiving: picked groups run first, the rest in default
// order. The saved pick order persists (breakpoint resume keeps it).

import { useState } from 'react';
import type { StjTask } from '../loader/types';
import { effectiveGidOrder } from '../planner/snake';
import { speakFootprint, speakValue } from '../speaker/sentence';
import { getSettings } from '../store/db';
import { vibrate } from '../util/hardware';
import { AiOrderError, requestAiOrder } from '../ai/order';

const SEQ = ['第1', '第2', '第3', '第4', '第5', '第6', '第7', '第8', '第9', '第10'];

export function MenuScreen(props: {
  task: StjTask;
  initialPicks?: string[];
  onStart(picks: string[]): void;
  onDefault(): void;
}) {
  const [picked, setPicked] = useState<string[]>(props.initialPicks ?? []);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const defOrder = effectiveGidOrder(props.task, []);
  const finalOrder = effectiveGidOrder(props.task, picked);
  const groupOf = (gid: string) => props.task.groups.find((g) => g.gid === gid);

  const toggle = (gid: string) => {
    vibrate(20);
    setPicked((p) => (p.includes(gid) ? p.filter((x) => x !== gid) : [...p, gid]));
  };

  const runAi = () => {
    const text = aiText.trim();
    if (!text || aiBusy) return;
    vibrate(20);
    setAiBusy(true);
    setAiMsg(null);
    void (async () => {
      try {
        const settings = await getSettings();
        const order = await requestAiOrder({ task: props.task, userText: text, settings });
        setPicked(order);
        vibrate(30);
        setAiMsg({ ok: true, text: `AI 已按指令排好 ${order.length} 组，可直接下一步或手动微调` });
      } catch (e) {
        vibrate(80);
        const msg = e instanceof AiOrderError ? e.message : 'AI 排序失败，请重试或手动点选';
        setAiMsg({ ok: false, text: msg });
      } finally {
        setAiBusy(false);
      }
    })();
  };

  return (
    <div class="screen">
      <div class="topbar">
        <h1>报菜名 · 排取料序</h1>
      </div>
      <div class="menu-hint muted">
        照桌上元件袋从上到下依次点选；点错的再点一下取消。也可以用一句话让 AI 排序。
        {picked.length > 0 && picked.length < props.task.groups.length
          ? '没点的组会按默认序排在后面。'
          : ''}
      </div>

      <div class="menu-ai-row">
        <input
          class="menu-ai-input"
          data-testid="menu-ai-input"
          placeholder="例：先焊电阻，IC 和接插件放最后"
          value={aiText}
          onInput={(e) => setAiText(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && runAi()}
          disabled={aiBusy}
        />
        <button
          class="btn"
          data-testid="menu-ai"
          disabled={aiBusy || !aiText.trim()}
          onClick={runAi}
        >
          {aiBusy ? '排序中…' : 'AI 排序'}
        </button>
      </div>
      {aiMsg && (
        <div
          class={`menu-ai-status ${aiMsg.ok ? 'menu-ai-ok' : 'menu-ai-err'}`}
          data-testid="menu-ai-status"
          data-ai-ok={aiMsg.ok ? '1' : '0'}
          role="status"
        >
          {aiMsg.text}
        </div>
      )}

      <div class="stack">
        <div class="menu-chips">
          {defOrder.map((gid) => {
            const g = groupOf(gid);
            if (!g) return null;
            const seq = picked.indexOf(gid);
            return (
              <button
                key={gid}
                class={`menu-chip ${seq >= 0 ? 'picked' : ''}`}
                data-testid={`menu-${gid}`}
                onClick={() => toggle(gid)}
              >
                {seq >= 0 && <span class="menu-seq">{SEQ[seq] ?? `${seq + 1}`}</span>}
                <span class="menu-value">{speakValue(g)}</span>
                <span class="menu-sub muted">
                  {g.qty} 颗 · {speakFootprint(g)}
                </span>
              </button>
            );
          })}
        </div>

        <div class="menu-preview muted" data-testid="menu-order">
          取料序：{finalOrder.map((gid, i) => `${i + 1}.${speakValue(groupOf(gid)!)}`).join('  ')}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button class="btn" style={{ flex: 1 }} data-testid="menu-default" onClick={() => {
            vibrate(20);
            setPicked([]);
            props.onDefault();
          }}>
            用默认顺序
          </button>
          <button class="btn btn-primary" style={{ flex: 2 }} data-testid="menu-start" onClick={() => {
            vibrate(30);
            props.onStart(picked);
          }}>
            下一步
          </button>
        </div>
      </div>
    </div>
  );
}
