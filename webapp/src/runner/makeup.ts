// Finish-list / makeup-weld helpers (plan section 9, M4): pure, UI-layer only.
// When the queue exhausts, the skipped units come back on a finishing list;
// 开始补焊 builds a TEMP runner over exactly those pids and reuses the
// unchanged runner/dispatcher (no new command semantics). When the temp queue
// drains, its statuses merge back into the main run.

import { initialRunner, type RunnerState, type UnitStatus } from './runner';

/** Pids the finishing list must show: everything not 'done' at queue-exhaust
 * time (i.e. the skipped ones), in main-queue order. */
export function finishListPids(order: number[], statuses: Record<number, UnitStatus>): number[] {
  return order.filter((pid) => statuses[pid] !== 'done');
}

/** Temp runner state for the makeup pass: fresh, only the leftover pids. */
export function makeupRunner(pids: number[]): RunnerState {
  return initialRunner(pids);
}

/** Merge a drained makeup pass into the main state: everything welded in the
 * temp pass counts as done on the main run too. */
export function mergeMakeup(main: RunnerState, makeup: RunnerState): RunnerState {
  const statuses = { ...main.statuses };
  for (const pid of makeup.order) statuses[pid] = 'done';
  return { ...main, statuses, finishedAt: main.finishedAt ?? makeup.finishedAt };
}
