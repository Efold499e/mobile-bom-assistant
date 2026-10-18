// M4 tests: pick-order queue generation, makeup-weld state machine (no new
// dispatcher commands), settings normalization round-trip.

import { describe, expect, it } from 'vitest';
import { effectiveGidOrder, planQueue } from '../planner/snake';
import { finishListPids, makeupRunner, mergeMakeup } from './makeup';
import { applyCommand, initialRunner } from './runner';
import { DEFAULT_SETTINGS, normalizeSettings } from '../store/db';
import type { StjTask } from '../loader/types';

// Minimal 3-group / 6-placement task: A, B on top, C on the bottom.
const task = {
  format: 'solder-task-json',
  version: 1,
  meta: {
    project: 't',
    source: 'hand',
    created_at: '2026-10-11T00:00:00+08:00',
    board: { width_mm: 30, height_mm: 20, outline: [[0, 0], [30, 0], [30, 20], [0, 20]] },
    landmarks: [],
  },
  sides: ['top', 'bottom'],
  groups: [
    { gid: 'A', kind: 'r', footprint: '0603', value: '10k', polarity: false, qty: 2, refdes: ['R1', 'R2'] },
    { gid: 'B', kind: 'c', footprint: '0603', value: '100nF', polarity: false, qty: 2, refdes: ['C1', 'C2'] },
    { gid: 'C', kind: 'r', footprint: '0603', value: '4k7', polarity: false, qty: 2, refdes: ['R3', 'R4'] },
  ],
  placements: [
    { pid: 0, gid: 'A', ref: 'R1', side: 'top', x_mm: 5, y_mm: 5, rot_deg: 0 },
    { pid: 1, gid: 'A', ref: 'R2', side: 'top', x_mm: 15, y_mm: 5, rot_deg: 0 },
    { pid: 2, gid: 'B', ref: 'C1', side: 'top', x_mm: 5, y_mm: 10, rot_deg: 0 },
    { pid: 3, gid: 'B', ref: 'C2', side: 'top', x_mm: 15, y_mm: 10, rot_deg: 0 },
    { pid: 4, gid: 'C', ref: 'R3', side: 'bottom', x_mm: 5, y_mm: 15, rot_deg: 0 },
    { pid: 5, gid: 'C', ref: 'R4', side: 'bottom', x_mm: 15, y_mm: 15, rot_deg: 0 },
  ],
  group_order_default: ['A', 'B', 'C'],
} as unknown as StjTask;

describe('pick order -> run queue (报菜名)', () => {
  it('A,C,B pick order reorders the queue and the first card is A', () => {
    const q = planQueue(task, ['A', 'C', 'B']);
    expect(q.map((u) => u.gid)).toEqual(['A', 'A', 'C', 'C', 'B', 'B']);
    expect(q[0].ref).toBe('R1'); // first unit belongs to group A
  });
  it('partial picks run first, the rest in default order after', () => {
    expect(effectiveGidOrder(task, ['C'])).toEqual(['C', 'A', 'B']);
    expect(planQueue(task, ['C']).map((u) => u.gid)).toEqual(['C', 'C', 'A', 'A', 'B', 'B']);
  });
  it('unknown / duplicate picks are ignored; no picks -> default', () => {
    expect(effectiveGidOrder(task, ['X', 'B', 'B'])).toEqual(['B', 'A', 'C']);
    expect(effectiveGidOrder(task)).toEqual(['A', 'B', 'C']);
    expect(effectiveGidOrder(task, [])).toEqual(['A', 'B', 'C']);
  });
});

describe('makeup-weld state machine (finishing list -> temp queue -> merge)', () => {
  const exhausted = () => {
    // queue-exhaust time: everything is done except the two skipped units
    const st = initialRunner([0, 1, 2, 3, 4, 5]);
    for (const pid of [0, 2, 3, 5]) st.statuses[pid] = 'done';
    st.statuses[1] = 'skipped';
    st.statuses[4] = 'skipped';
    st.startedAt = 1000;
    return st;
  };

  it('finish list holds exactly the non-done units in queue order', () => {
    const st = exhausted();
    expect(finishListPids(st.order, st.statuses)).toEqual([1, 4]);
  });
  it('makeup reuses the unchanged runner to completion, then merges back', () => {
    const main = exhausted();
    main.startedAt = 1000;

    const leftovers = finishListPids(main.order, main.statuses);
    const mk = makeupRunner(leftovers); // temp queue over [1, 4]
    expect(mk.order).toEqual([1, 4]);
    // same commands as the normal loop -- no new dispatcher semantics
    applyCommand(mk, 'start', 2000);
    const r1 = applyCommand(mk, 'complete', 2000);
    const r2 = applyCommand(r1.state, 'complete', 3000);
    expect(r2.events.some((e) => e.type === 'finished')).toBe(true);

    const merged = mergeMakeup(main, r2.state);
    expect(Object.values(merged.statuses).every((s) => s === 'done')).toBe(true);
    expect(merged.startedAt).toBe(1000); // main timing preserved
  });
});

describe('settings normalization round-trip', () => {
  it('defaults apply to missing/garbage fields', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ rate: 'x', batchThreshold: 0 })).toEqual(DEFAULT_SETTINGS);
  });
  it('valid values survive; rate clamps to 0.7-1.2; threshold null = off', () => {
    expect(normalizeSettings({ rate: 1.1, batchThreshold: 6 })).toEqual({ rate: 1.1, batchThreshold: 6, conciseTts: true });
    expect(normalizeSettings({ rate: 2, batchThreshold: null })).toEqual({ rate: 1.2, batchThreshold: null, conciseTts: true });
    expect(normalizeSettings({ rate: 0.1, batchThreshold: 99 })).toEqual({ rate: 0.7, batchThreshold: 4, conciseTts: true });
    expect(normalizeSettings({ rate: 0.75, batchThreshold: 2 })).toEqual({ rate: 0.75, batchThreshold: 2, conciseTts: true });
  });
  it('written settings read back equal (normalize is idempotent)', () => {
    const s = normalizeSettings({ rate: 0.8, batchThreshold: 8 });
    expect(normalizeSettings(s)).toEqual(s);
  });
});
