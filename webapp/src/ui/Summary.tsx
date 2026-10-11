// Summary screen (M4): total pieces, elapsed time, per-side completion.

import type { FinishSummary } from '../app';
import { sideWord } from '../speaker/sentence';

export function SummaryScreen(props: { finish: FinishSummary; onHome(): void }) {
  const minutes = Math.max(1, Math.round(props.finish.elapsedMs / 60000));
  return (
    <div class="screen">
      <div class="summary">
        <div class="big">收工 🎉</div>
        <div class="lines">
          <span>共 {props.finish.total} 颗</span>
          <span>焊完 {props.finish.done} 颗 · 用时 {minutes} 分钟</span>
          {props.finish.sides.map((s) => (
            <span key={s.side} data-testid={`side-${s.side}`}>
              {sideWord(s.side)} {s.done}/{s.total}
              {s.done === s.total ? ' ✓' : ''}
            </span>
          ))}
          {props.finish.skipped > 0 && (
            <span class="muted">未焊 {props.finish.skipped} 颗（留在任务里，下次继续）</span>
          )}
        </div>
        <button class="btn btn-primary" onClick={props.onHome}>
          返回首页
        </button>
      </div>
    </div>
  );
}
