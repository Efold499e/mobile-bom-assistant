// Batch mode tests: threshold decision, once-per-group asking, batch counting
// and the remaining-pending number that drives 剩3/剩1 milestones.

import { describe, expect, it } from 'vitest';
import {
  BATCH_THRESHOLD,
  BatchTracker,
  batchCountOf,
  remainingPendingInGroup,
  shouldAskBatch,
  type BatchDecision,
} from './batch';
import type { StjGroup } from '../loader/types';

const g4: StjGroup = {
  gid: 'g0', kind: 'r', footprint: '0603', value: '10k',
  polarity: false, qty: 4, refdes: ['R1', 'R2', 'R3', 'R4'],
};
const g3: StjGroup = { ...g4, gid: 'g1', qty: 3, refdes: ['C1', 'C2', 'C3'] };

describe('batch trigger threshold (M3 constant = 4)', () => {
  it('qty >= 4 asks, qty < 4 does not', () => {
    expect(BATCH_THRESHOLD).toBe(4);
    expect(shouldAskBatch(4)).toBe(true);
    expect(shouldAskBatch(10)).toBe(true);
    expect(shouldAskBatch(3)).toBe(false);
    expect(shouldAskBatch(1)).toBe(false);
  });
});

describe('BatchTracker: one decision per group', () => {
  it('asks below-threshold groups never, eligible groups once', () => {
    const t = new BatchTracker();
    expect(t.shouldAsk(g3)).toBe(false); // under threshold
    expect(t.shouldAsk(g4)).toBe(true);
    t.decide(g4, 'single');
    expect(t.shouldAsk(g4)).toBe(false); // decided
    expect(t.isBatch(g4.gid)).toBe(false);
  });

  it('accepting lights the batch; the decision survives leaving and re-entering', () => {
    const t = new BatchTracker();
    t.decide(g4, 'batch');
    expect(t.isBatch(g4.gid)).toBe(true);
    expect(t.shouldAsk(g4)).toBe(false);
    expect(t.isBatch(g3.gid)).toBe(false); // other groups unaffected
  });

  it('re-deciding a group switches the mode', () => {
    const t = new BatchTracker();
    const decisions: BatchDecision[] = ['batch', 'single'];
    for (const d of decisions) t.decide(g4, d);
    expect(t.isBatch(g4.gid)).toBe(false);
  });

  it('reset clears everything (fresh run)', () => {
    const t = new BatchTracker();
    t.decide(g4, 'batch');
    t.reset();
    expect(t.shouldAsk(g4)).toBe(true);
    expect(t.isBatch(g4.gid)).toBe(false);
  });
});

describe('batch counting (card 第 x/N 颗)', () => {
  const units = [
    { pid: 0, gid: 'g0' },
    { pid: 1, gid: 'g0' },
    { pid: 2, gid: 'g0' },
    { pid: 3, gid: 'g0' },
    { pid: 4, gid: 'g1' },
    { pid: 5, gid: 'g1' },
  ];
  it('counts position within the group in queue order', () => {
    expect(batchCountOf(units, 0)).toEqual({ x: 1, n: 4 });
    expect(batchCountOf(units, 2)).toEqual({ x: 3, n: 4 });
    expect(batchCountOf(units, 5)).toEqual({ x: 2, n: 2 });
  });
  it('out-of-range pointer -> null', () => {
    expect(batchCountOf(units, -1)).toBeNull();
    expect(batchCountOf(units, 6)).toBeNull();
  });
});

describe('remaining pending in group (milestone driver)', () => {
  const units = [
    { pid: 0, gid: 'g0' },
    { pid: 1, gid: 'g0' },
    { pid: 2, gid: 'g0' },
    { pid: 3, gid: 'g0' },
  ];
  it('counts only pending units of that group', () => {
    const st: Record<number, 'pending' | 'done' | 'skipped'> = { 0: 'done', 1: 'pending', 2: 'pending', 3: 'pending' };
    expect(remainingPendingInGroup(units, st, 'g0')).toBe(3);
    st[3] = 'skipped';
    expect(remainingPendingInGroup(units, st, 'g0')).toBe(2);
  });
});
