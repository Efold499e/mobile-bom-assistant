// 报菜名 menu screen (plan section 8, M4): groups are listed as chips in the
// default order; the user taps them top-to-bottom following the physical
// component bags -- the tap sequence becomes the pick order (no dragging).
// Partial picks are forgiving: picked groups run first, the rest in default
// order. The saved pick order persists (breakpoint resume keeps it).

import { useState } from 'react';
import type { StjTask } from '../loader/types';
import { effectiveGidOrder } from '../planner/snake';
import { speakFootprint, speakValue } from '../speaker/sentence';
import { vibrate } from '../util/hardware';

const SEQ = ['第1', '第2', '第3', '第4', '第5', '第6', '第7', '第8', '第9', '第10'];

export function MenuScreen(props: {
  task: StjTask;
  initialPicks?: string[];
  onStart(picks: string[]): void;
  onDefault(): void;
}) {
  const [picked, setPicked] = useState<string[]>(props.initialPicks ?? []);
  const defOrder = effectiveGidOrder(props.task, []);
  const finalOrder = effectiveGidOrder(props.task, picked);
  const groupOf = (gid: string) => props.task.groups.find((g) => g.gid === gid);

  const toggle = (gid: string) => {
    vibrate(20);
    setPicked((p) => (p.includes(gid) ? p.filter((x) => x !== gid) : [...p, gid]));
  };

  return (
    <div class="screen">
      <div class="topbar">
        <h1>报菜名 · 排取料序</h1>
      </div>
      <div class="menu-hint muted">
        照桌上元件袋从上到下依次点选；点错的再点一下取消。
        {picked.length > 0 && picked.length < props.task.groups.length
          ? '没点的组会按默认序排在后面。'
          : ''}
      </div>

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
