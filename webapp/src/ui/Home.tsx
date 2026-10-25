// Home: task library. Demo task is seeded on first visit so a fresh phone can
// run the whole loop without any file. Cards show progress + management actions.

import { useEffect, useState } from 'react';
import type { TaskRecord } from '../store/db';
import { deleteTask, getTask, listTasks, putTask, resetRun } from '../store/db';
import { parseStjText } from '../loader';
import { getSpeaker } from '../app';

export function HomeScreen(props: { onImport(): void; onSettings(): void; onRun(taskId: string): void }) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);

  const refresh = () => {
    void listTasks().then(setTasks);
  };

  useEffect(() => {
    void seedDemo().then(refresh);
  }, []);

  const doneCount = (t: TaskRecord): number =>
    t.run ? Object.values(t.run.statuses).filter((s) => s === 'done').length : 0;
  const skippedCount = (t: TaskRecord): number =>
    t.run ? Object.values(t.run.statuses).filter((s) => s === 'skipped').length : 0;
  const total = (t: TaskRecord): number => t.task.placements.length;

  return (
    <div className="screen">
      <div className="topbar">
        <h1>焊接任务</h1>
        <span class="topbar-actions">
          <button className="btn btn-small" onClick={props.onImport}>导入任务</button>
          <button className="btn btn-small" data-testid="open-settings" onClick={props.onSettings}>⚙ 设置</button>
        </span>
      </div>
      <div className="stack">
        {tasks.map((t) => {
          const done = doneCount(t);
          const skipped = skippedCount(t);
          const n = total(t);
          // `!= null` (not `!== null`): a record stored without a run key
          // (legacy/foreign shape) must not brick the task list render
          const started = t.run != null && !t.run.finishedAt;
          return (
            <div class="task-card" key={t.taskId}>
              <div class="row1">
                <span class="name">{t.name}</span>
                {t.builtin && <span class="badge">内置演示</span>}
                {t.run?.finishedAt && <span class="badge ok">已完成</span>}
                {skipped > 0 && <span class="badge warn">跳过 {skipped}</span>}
              </div>
              <div class="muted">
                {n} 颗 / {t.task.groups.length} 组 · 来源 {t.task.meta.source}
              </div>
              <div class="progress-track">
                <div class="progress-fill" style={{ width: `${n ? (100 * done) / n : 0}%` }} />
              </div>
              <div class="muted">
                {t.run
                  ? `焊到第 ${t.run.resumeAt ?? Math.min(t.run.pointer + 1, n)}/${n} 颗`
                  : '未开始'}
              </div>
              <div class="task-actions">
                <button
                  class="btn btn-primary btn-small"
                  onClick={() => {
                    getSpeaker().unlock(); // iOS speech needs a user gesture
                    props.onRun(t.taskId);
                  }}
                >
                  {started || t.run ? '继续焊接' : '开始焊接'}
                </button>
                <button
                  class="btn btn-small"
                  onClick={() => void resetRun(t.taskId).then(refresh)}
                >
                  重置进度
                </button>
                <button class="btn btn-small" onClick={() => exportTask(t)}>导出 STJ</button>
                <button
                  class="btn btn-small btn-danger"
                  onClick={() => void deleteTask(t.taskId).then(refresh)}
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div class="drop">还没有任务。点右上角「导入任务」，或重启应用以载入内置演示任务。</div>
        )}
      </div>
    </div>
  );
}

async function seedDemo(): Promise<void> {
  const existing = await getTask('demo-board');
  if (existing) return;
  const res = await fetch(`${import.meta.env.BASE_URL}demo/demo.stj.json`);
  const text = await res.text();
  const parsed = parseStjText(text);
  if (!parsed.ok || !parsed.task) return; // frozen file; this should never happen
  await putTask({
    taskId: 'demo-board',
    name: parsed.task.meta.project,
    builtin: true,
    task: parsed.task,
    run: null,
    savedAt: Date.now(),
  });
}

function exportTask(t: TaskRecord) {
  const blob = new Blob([JSON.stringify(t.task, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t.taskId}.stj.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
