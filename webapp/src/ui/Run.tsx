// Run screen: the product's heart (plan sections 2 + 5).
// Fixed layout: big card area on top, exactly three buttons below
// (上一个 1fr / 重新播报 1fr / 完成 2fr). Gestures: card tap = replay,
// card swipe-up = skip, prev button short-press = step back (rework),
// long-press 600ms (double-pulse confirm) = undo mistaken completion.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSpeaker, type FinishSummary } from '../app';
import { dispatch, type DispatcherHooks } from '../dispatcher/dispatcher';
import { planQueue } from '../planner/snake';
import type { RunnerState } from '../runner/runner';
import { applyCommand, initialRunner, nextPendingIndex } from '../runner/runner';
import { finishSentence, sideWord, unitSentence } from '../speaker/sentence';
import { getTask, persistRun } from '../store/db';
import type { StjTask } from '../loader';
import { WakeLockHolder, vibrate } from '../util/hardware';

const LONG_PRESS_MS = 600;

interface Unit {
  pid: number;
  gid: string;
  ref: string;
  side: 'top' | 'bottom';
}

function summarize(s: RunnerState): FinishSummary {
  let done = 0;
  let skipped = 0;
  for (const pid of s.order) {
    if (s.statuses[pid] === 'done') done += 1;
    else if (s.statuses[pid] === 'skipped') skipped += 1;
  }
  return {
    total: s.order.length,
    done,
    skipped,
    elapsedMs: Math.max(0, (s.finishedAt ?? Date.now()) - (s.startedAt ?? s.finishedAt ?? Date.now())),
  };
}

export function RunScreen(props: {
  taskId: string;
  onFinish(finish: FinishSummary): void;
  onExit(): void;
}) {
  const [task, setTask] = useState<StjTask | null>(null);
  const [, setTick] = useState(0); // re-render after each dispatch
  const queue = useRef<Unit[]>([]);
  const runnerRef = useRef<RunnerState | null>(null);
  const wakeLock = useRef(new WakeLockHolder());
  const taskRef = useRef<StjTask | null>(null);

  useEffect(() => {
    void (async () => {
      const rec = await getTask(props.taskId);
      if (!rec) return;
      const t = rec.task;
      taskRef.current = t;
      setTask(t);
      const planned = planQueue(t);
      queue.current = planned;
      const order = planned.map((u) => u.pid);
      runnerRef.current = rec.run
        ? { ...initialRunner(order), ...rec.run, order }
        : initialRunner(order);
      // resume on real work: if the stored pointer parks on a skipped/done
      // unit (e.g. right after a swipe-skip + refresh), advance to first pending
      if (rec.run) {
        const s = runnerRef.current;
        if (s.pointer >= 0 && s.statuses[s.order[s.pointer]] !== 'pending') {
          const next = nextPendingIndex(s, s.pointer);
          if (next !== -1) s.pointer = next;
        }
      }
      // resume straight into the summary if this task was already finished
      if (rec.run?.finishedAt) {
        const s = runnerRef.current;
        props.onFinish(summarize(s));
        return;
      }
      setTick((x) => x + 1);
      // entering the loop announces the current unit and locks the screen on
      const wl = wakeLock.current;
      void wl.acquire();
      document.addEventListener('visibilitychange', wl.onVisibilityChange);
      dispatch(hooksRef.current, 'start', Date.now());
    })();
    return () => {
      wakeLock.current.release();
      document.removeEventListener('visibilitychange', wakeLock.current.onVisibilityChange);
      getSpeaker().dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.taskId]);

  const groupOf = (gid: string) => taskRef.current?.groups.find((g) => g.gid === gid);

  const hooks = useMemo<DispatcherHooks>(
    () => ({
      apply: (cmd, now) => {
        const cur = runnerRef.current ?? initialRunner([]);
        return applyCommand(cur, cmd, now);
      },
      setState: (s) => {
        runnerRef.current = s;
        setTick((x) => x + 1);
      },
      announce: (s, ev) => {
        const t = taskRef.current;
        if (!t) return;
        const idx = s.order.indexOf(ev.pid);
        const unit = queue.current[idx];
        const group = unit && groupOf(unit.gid);
        if (!group) return;
        getSpeaker().say(unitSentence({ index: idx + 1, total: s.order.length, group }));
      },
      finish: (ev) => {
        const t = taskRef.current;
        if (t) getSpeaker().say(finishSentence(t, ev.elapsedMs));
        setTimeout(
          () =>
            props.onFinish({
              total: ev.total,
              done: ev.done,
              skipped: ev.skipped,
              elapsedMs: ev.elapsedMs,
            }),
          400,
        );
      },
      vibrate: (pattern) => vibrate(pattern),
      persist: (s) => void persistRun(props.taskId, s),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.taskId],
  );
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  const doDispatch = (cmd: Parameters<typeof dispatch>[1]) => dispatch(hooks, cmd, Date.now());

  // ---- prev button: short press vs 600ms long press (undo) ----
  const holdTimer = useRef<number | null>(null);
  const armedLong = useRef(false);
  const [holdArmed, setHoldArmed] = useState(false);

  const onPrevDown = () => {
    armedLong.current = false;
    holdTimer.current = window.setTimeout(() => {
      armedLong.current = true;
      setHoldArmed(true);
      vibrate([40, 60, 40]); // double-pulse: undo armed
    }, LONG_PRESS_MS);
  };
  const onPrevUp = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHoldArmed(false);
    doDispatch(armedLong.current ? 'prev-long' : 'prev-short');
    armedLong.current = false;
  };
  const onPrevCancel = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHoldArmed(false);
    armedLong.current = false;
  };

  // ---- card gestures: tap = replay, swipe up = skip ----
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const onCardTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onCardTouchEnd = (e: TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - s.y;
    const dx = t.clientX - s.x;
    if (dy < -50 && Math.abs(dx) < 80) {
      doDispatch('skip'); // swipe up: skip
    } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && Date.now() - s.t < 500) {
      doDispatch('replay'); // card tap: replay
    }
  };

  if (!task || !runnerRef.current) {
    return <div class="screen" />;
  }
  const state = runnerRef.current;
  const total = state.order.length;
  const unit = state.pointer >= 0 ? queue.current[state.pointer] : null;
  const group = unit ? groupOf(unit.gid) : undefined;
  const doneCount = state.order.filter((pid) => state.statuses[pid] === 'done').length;

  return (
    <div class="screen">
      <div class="run-meta">
        <span class="idx">
          第 {Math.min(state.pointer + 1, total)}/{total} 颗
        </span>
        <span>
          {unit && <span class="badge">{sideWord(unit.side)}</span>}{' '}
          {group?.polarity && <span class="badge warn">⚠极性</span>}
        </span>
      </div>
      <div class="run-progress">
        <div class="fill" style={{ width: `${(100 * doneCount) / total}%` }} />
      </div>

      <div class="run-card-zone">
        <div
          class="run-card"
          data-testid="run-card"
          onTouchStart={onCardTouchStart}
          onTouchEnd={onCardTouchEnd}
        >
          <div class="value">{group?.value ?? '—'}</div>
          <div class="fp">{group ? (group.footprint_speak ?? group.footprint) : ''}</div>
          <div class="loc">{/* M1: orientation left blank by design */}</div>
          <div class="hint">点卡片重听 · 上滑跳过</div>
        </div>
      </div>

      <div class="controls">
        <button
          class={`btn ${holdArmed ? 'pressed' : ''}`}
          data-testid="btn-prev"
          onPointerDown={onPrevDown}
          onPointerUp={onPrevUp}
          onPointerLeave={onPrevCancel}
          onPointerCancel={onPrevCancel}
        >
          {holdArmed ? '撤销待焊' : '上一个'}
        </button>
        <button
          class="btn"
          data-testid="btn-replay"
          onClick={() => {
            vibrate(30);
            doDispatch('replay');
          }}
        >
          重新播报
        </button>
        <button
          class="btn btn-primary"
          data-testid="btn-complete"
          onClick={(e) => {
            vibrate(30);
            (e.currentTarget as HTMLButtonElement).blur();
            doDispatch('complete');
          }}
        >
          完成
        </button>
      </div>
    </div>
  );
}
