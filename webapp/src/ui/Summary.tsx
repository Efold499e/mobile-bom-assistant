// Minimal summary screen (M1): total pieces, elapsed time, skipped count.
// The full closing checklist / makeup-weld flow arrives in M4.

import type { FinishSummary } from '../app';

export function SummaryScreen(props: { finish: FinishSummary; onHome(): void }) {
  const minutes = Math.max(1, Math.round(props.finish.elapsedMs / 60000));
  return (
    <div class="screen">
      <div class="summary">
        <div class="big">收工 🎉</div>
        <div class="lines">
          <span>共 {props.finish.total} 颗</span>
          <span>焊完 {props.finish.done} 颗 · 用时 {minutes} 分钟</span>
          {props.finish.skipped > 0 && (
            <span class="muted">跳过 {props.finish.skipped} 颗（收尾清单将在后续版本提供补焊）</span>
          )}
        </div>
        <button class="btn btn-primary" onClick={props.onHome}>
          返回首页
        </button>
      </div>
    </div>
  );
}
