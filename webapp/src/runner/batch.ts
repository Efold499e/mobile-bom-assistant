// Batch mode decision tracking (plan section 9): pure, UI-layer only --
// runner/dispatcher command semantics stay untouched (M3 boundary).
// Entering a group with qty >= threshold asks once: weld together (all group
// points lit, one blip per piece) or piece by piece (full announcements).

import type { StjGroup } from '../loader/types';

/** M3: code constant; M4 moves it into settings (default 4, can be off). */
export const BATCH_THRESHOLD = 4;

export function shouldAskBatch(qty: number, threshold: number = BATCH_THRESHOLD): boolean {
  return qty >= threshold;
}

export type BatchDecision = 'batch' | 'single';

/** One decision per group per session; a refresh re-asks (harmless, and the
 * plan wants the question at group entry). */
export class BatchTracker {
  private decided = new Map<string, BatchDecision>();
  private activeBatch = new Set<string>();

  shouldAsk(group: StjGroup): boolean {
    return shouldAskBatch(group.qty) && !this.decided.has(group.gid);
  }

  decide(group: StjGroup, d: BatchDecision): void {
    this.decided.set(group.gid, d);
    if (d === 'batch') this.activeBatch.add(group.gid);
    else this.activeBatch.delete(group.gid);
  }

  isBatch(gid: string): boolean {
    return this.activeBatch.has(gid);
  }

  reset(): void {
    this.decided.clear();
    this.activeBatch.clear();
  }
}

/** 1-based position of the current unit within its group, following the queue
 * order (card shows 第 x/N 颗 in batch mode). */
export function batchCountOf(
  units: { pid: number; gid: string }[],
  pointer: number,
): { x: number; n: number } | null {
  if (pointer < 0 || pointer >= units.length) return null;
  const gid = units[pointer].gid;
  const idxs: number[] = [];
  for (let i = 0; i < units.length; i++) if (units[i].gid === gid) idxs.push(i);
  const x = idxs.indexOf(pointer);
  return x === -1 ? null : { x: x + 1, n: idxs.length };
}

/** How many units of the group are still pending (drives the 剩3/剩1
 * milestone announcements after each batch completion). */
export function remainingPendingInGroup(
  units: { pid: number; gid: string }[],
  statuses: Record<number, 'pending' | 'done' | 'skipped'>,
  gid: string,
): number {
  let n = 0;
  for (const u of units) if (u.gid === gid && statuses[u.pid] === 'pending') n += 1;
  return n;
}
