// Import: file pick + paste-JSON emergency path, stats confirmation before saving.

import { useRef, useState } from 'react';
import { parseStjText } from '../loader';
import type { StjTask, TaskStats } from '../loader';
import { putTask } from '../store/db';

interface Parsed {
  task: StjTask;
  stats: TaskStats;
  warnings: string[];
}

export function ImportScreen(props: { onDone(): void; onCancel(): void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleText = (text: string) => {
    const r = parseStjText(text);
    if (r.ok && r.task && r.stats) {
      setParsed({ task: r.task, stats: r.stats, warnings: r.warnings });
      setErrors(null);
    } else {
      setParsed(null);
      setErrors(r.errors);
    }
  };

  const confirm = () => {
    if (!parsed) return;
    const taskId = `${parsed.task.meta.project}`;
    void putTask({
      taskId,
      name: parsed.task.meta.project,
      builtin: false,
      task: parsed.task,
      run: null,
      savedAt: Date.now(),
    }).then(props.onDone);
  };

  return (
    <div class="screen">
      <div class="topbar">
        <h1>导入任务</h1>
        <button class="btn btn-small" onClick={props.onCancel}>返回</button>
      </div>
      <div class="stack">
        {!parsed && (
          <>
            <div
              class="drop"
              onClick={() => fileRef.current?.click()}
              role="button"
            >
              点这里选择任务文件<br />
              <span style={{ fontSize: '0.85rem' }}>.stj.json（焊接任务 JSON）</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.currentTarget.files?.[0];
                if (f) handleText(await f.text());
                e.currentTarget.value = '';
              }}
            />
            {!pasteOpen ? (
              <button class="btn btn-small" onClick={() => setPasteOpen(true)}>
                粘贴 JSON（应急入口）
              </button>
            ) : (
              <div class="stack" style={{ padding: 0 }}>
                <textarea
                  id="paste"
                  placeholder={'{"format":"solder-task-json", ... '}
                  value={pasteText}
                  onInput={(e) => setPasteText(e.currentTarget.value)}
                />
                <button class="btn btn-small" onClick={() => handleText(pasteText)}>
                  校验并继续
                </button>
              </div>
            )}
            {errors && <div class="errors">{errors.join('\n')}</div>}
          </>
        )}

        {parsed && (
          <>
            <div class="task-card">
              <div class="row1">
                <span class="name">{parsed.stats.project}</span>
                <span class="badge">来源 {parsed.stats.source}</span>
              </div>
              <div class="stat-grid">
                <StatCell n={parsed.stats.placements} label="颗" />
                <StatCell n={parsed.stats.groups} label="组" />
                <StatCell n={parsed.stats.polarity} label="极性" />
                <StatCell n={parsed.stats.sides} label="面" />
              </div>
              <div class="muted">
                板框 {parsed.task.meta.board.width_mm} × {parsed.task.meta.board.height_mm} mm ·
                地标 {parsed.stats.landmarks} 个
              </div>
            </div>
            {parsed.warnings.length > 0 && (
              <div class="muted" style={{ fontSize: '0.85rem' }}>
                提示 {parsed.warnings.length} 条（如缺 bbox 走默认尺寸），不影响导入。
              </div>
            )}
            <div style={{ display: 'flex', gap: 12 }}>
              <button class="btn" style={{ flex: 1 }} onClick={() => { setParsed(null); setErrors(null); }}>
                重新选择
              </button>
              <button class="btn btn-primary" style={{ flex: 2 }} onClick={confirm}>
                确认导入
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCell(props: { n: number; label: string }) {
  return (
    <div class="stat-cell">
      <div class="num">{props.n}</div>
      <div class="label">{props.label}</div>
    </div>
  );
}
