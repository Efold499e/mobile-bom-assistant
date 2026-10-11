// Runner: the core-loop state machine (plan section 2).
// Pure: applyCommand(state, cmd, now) -> { state, events }. The dispatcher
// translates events into speak / vibrate / persist side effects.

export type UnitStatus = 'pending' | 'done' | 'skipped';

export interface RunnerState {
  order: number[]; // pids in weld order (planner output)
  statuses: Record<number, UnitStatus>;
  pointer: number; // index into order; -1 only before start
  startedAt: number | null;
  finishedAt: number | null;
}

export type Command =
  | 'start'
  | 'complete'
  | 'prev-short'
  | 'prev-long'
  | 'replay'
  | 'skip';

export type RunnerEvent =
  | { type: 'unit'; pid: number }
  | { type: 'completed'; pid: number }
  | { type: 'skipped'; pid: number }
  | { type: 'undo-confirmed'; pid: number }
  | { type: 'invalid'; reason: 'queue-head' }
  | { type: 'finished'; total: number; done: number; skipped: number; elapsedMs: number };

export function initialRunner(order: number[]): RunnerState {
  const statuses: Record<number, UnitStatus> = {};
  for (const pid of order) statuses[pid] = 'pending';
  return { order, statuses, pointer: order.length > 0 ? 0 : -1, startedAt: null, finishedAt: null };
}

export function isFinished(state: RunnerState): boolean {
  return state.order.every((pid) => state.statuses[pid] !== 'pending');
}

/** Index of the first pending unit strictly after `from`, wrapping to the front. */
export function nextPendingIndex(state: RunnerState, from: number): number {
  const n = state.order.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (state.statuses[state.order[idx]] === 'pending') return idx;
  }
  return -1;
}

/** 1-based position to resume at: pointer when it sits on a pending unit,
 * otherwise the first pending unit from there (e.g. after skipping, the
 * pointer parks on a skipped unit -- resuming must land on real work). */
export function resumePosition(state: RunnerState): number {
  if (state.pointer < 0) return 1;
  const cur = state.order[state.pointer];
  if (state.statuses[cur] === 'pending') return state.pointer + 1;
  const next = nextPendingIndex(state, state.pointer);
  return next === -1 ? state.order.length : next + 1;
}

export function applyCommand(
  state: RunnerState,
  cmd: Command,
  now: number,
): { state: RunnerState; events: RunnerEvent[] } {
  const events: RunnerEvent[] = [];
  const s: RunnerState = {
    ...state,
    statuses: { ...state.statuses },
    startedAt: state.startedAt ?? (cmd === 'start' ? now : null),
  };

  switch (cmd) {
    case 'start': {
      if (s.pointer >= 0) events.push({ type: 'unit', pid: s.order[s.pointer] });
      break;
    }
    case 'complete': {
      if (s.pointer < 0) break;
      const pid = s.order[s.pointer];
      s.statuses[pid] = 'done';
      events.push({ type: 'completed', pid });
      const next = nextPendingIndex(s, s.pointer);
      if (next === -1) {
        s.finishedAt = now;
        events.push(finishEvent(s, now));
      } else {
        s.pointer = next;
        events.push({ type: 'unit', pid: s.order[next] });
      }
      break;
    }
    case 'skip': {
      if (s.pointer < 0) break;
      const pid = s.order[s.pointer];
      s.statuses[pid] = 'skipped';
      events.push({ type: 'skipped', pid });
      const next = nextPendingIndex(s, s.pointer);
      if (next === -1) {
        s.finishedAt = now;
        events.push(finishEvent(s, now));
      } else {
        s.pointer = next;
        events.push({ type: 'unit', pid: s.order[next] });
      }
      break;
    }
    case 'prev-short': {
      if (s.pointer <= 0) {
        events.push({ type: 'invalid', reason: 'queue-head' });
        break;
      }
      s.pointer -= 1; // statuses untouched -- rework semantics (plan 2.2)
      events.push({ type: 'unit', pid: s.order[s.pointer] });
      break;
    }
    case 'prev-long': {
      if (s.pointer <= 0) {
        events.push({ type: 'invalid', reason: 'queue-head' });
        break;
      }
      s.pointer -= 1;
      const pid = s.order[s.pointer];
      s.statuses[pid] = 'pending'; // undo mistaken completion
      events.push({ type: 'undo-confirmed', pid });
      events.push({ type: 'unit', pid });
      break;
    }
    case 'replay': {
      if (s.pointer >= 0) events.push({ type: 'unit', pid: s.order[s.pointer] });
      break;
    }
  }
  return { state: s, events };
}

function finishEvent(s: RunnerState, now: number): RunnerEvent {
  let done = 0;
  let skipped = 0;
  for (const pid of s.order) {
    if (s.statuses[pid] === 'done') done += 1;
    else if (s.statuses[pid] === 'skipped') skipped += 1;
  }
  const started = s.startedAt ?? now;
  return {
    type: 'finished',
    total: s.order.length,
    done,
    skipped,
    elapsedMs: Math.max(0, now - started),
  };
}
