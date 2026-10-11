// Dispatcher semantics tests: the plan 2.2 walkthroughs are designated test
// cases -- assert complete state sequences (statuses + pointer) and every
// side-effect the dispatcher fires.

import { describe, expect, it } from 'vitest';
import { dispatch, type DispatcherHooks } from './dispatcher';
import type { Command, RunnerEvent, RunnerState } from '../runner/runner';
import { applyCommand, initialRunner, resumePosition } from '../runner/runner';

function makeHarness(order: number[]) {
  let state = initialRunner(order);
  const stateSeq: RunnerState[] = [{ ...state, statuses: { ...state.statuses } }];
  const announced: number[] = []; // pids
  const vibrations: (number | number[])[] = [];
  const persisted: RunnerState[] = [];
  let finished: Extract<RunnerEvent, { type: 'finished' }> | null = null;

  const hooks: DispatcherHooks = {
    apply: (cmd: Command, now: number) => applyCommand(state, cmd, now),
    setState: (s) => {
      state = s;
      stateSeq.push({ ...s, statuses: { ...s.statuses } });
    },
    announce: (_s, ev) => void announced.push(ev.pid),
    finish: (ev) => {
      finished = ev;
    },
    vibrate: (p) => void vibrations.push(p),
    persist: (s) => void persisted.push(s),
  };
  const run = (cmds: Command[]) => cmds.forEach((c) => dispatch(hooks, c, 1000));
  return { run, stateSeq, announced, vibrations, persisted, get state() { return state; }, get finished() { return finished; } };
}

const ALL = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('plan 2.2 rework walkthrough (5th piece crooked)', () => {
  it('short-prev keeps status; completing again moves on to the 6th', () => {
    const h = makeHarness(ALL(12));
    h.run(['complete', 'complete', 'complete', 'complete', 'complete']);
    expect(h.state.pointer).toBe(5); // on the 6th
    h.run(['prev-short']);
    expect(h.state.pointer).toBe(4); // back on the 5th
    expect(h.state.statuses[4]).toBe('done'); // status untouched
    h.run(['complete']);
    expect(h.state.pointer).toBe(5); // 6th again
    expect(h.state.statuses[4]).toBe('done');
    expect(h.announced).toEqual([1, 2, 3, 4, 5, 4, 5]); // announce-on-move semantics
  });
});

describe('plan 2.2 mistaken-completion undo (long press)', () => {
  it('clears the previous unit back to pending and parks the pointer on it', () => {
    const h = makeHarness(ALL(12));
    h.run(['complete', 'complete', 'complete', 'complete', 'complete']);
    h.run(['prev-long']);
    expect(h.state.pointer).toBe(4);
    expect(h.state.statuses[4]).toBe('pending'); // cleared
    expect(h.state.statuses[3]).toBe('done'); // earlier completions kept
    expect(h.vibrations.at(-1)).toEqual([30, 60, 30]); // double-pulse confirm
    h.run(['complete']); // re-weld and complete -> moves to 6th
    expect(h.state.pointer).toBe(5);
    expect(h.state.statuses[4]).toBe('done');
  });
});

describe('queue-head short press is invalid', () => {
  it('stays put, buzzes, announces nothing', () => {
    const h = makeHarness(ALL(3));
    h.run(['prev-short']);
    expect(h.state.pointer).toBe(0);
    expect(h.state.statuses[0]).toBe('pending');
    expect(h.vibrations).toEqual([120]);
    expect(h.announced).toEqual([]);
    // long press at head is invalid too
    h.run(['prev-long']);
    expect(h.state.pointer).toBe(0);
    expect(h.state.statuses[0]).toBe('pending');
  });
});

describe('skip semantics', () => {
  it('marks skipped and jumps to the next pending unit', () => {
    const h = makeHarness(ALL(4));
    h.run(['skip']);
    expect(h.state.statuses[0]).toBe('skipped');
    expect(h.state.pointer).toBe(1);
    expect(h.announced).toEqual([1]);
    h.run(['complete', 'complete', 'complete']);
    expect(h.finished).toMatchObject({ total: 4, done: 3, skipped: 1 });
  });
});

describe('finish semantics', () => {
  it('reports totals and elapsed time once nothing is pending', () => {
    const h = makeHarness(ALL(3));
    h.run(['complete', 'complete', 'complete']);
    expect(h.finished).not.toBeNull();
    expect(h.finished).toMatchObject({ total: 3, done: 3, skipped: 0, elapsedMs: 0 });
    // completing again after finish: nothing pending -> finish fires with stable numbers
    const h2 = makeHarness(ALL(1));
    h2.run(['complete']);
    expect(h2.finished).toMatchObject({ total: 1, done: 1 });
  });
});

describe('persistence happens after every command', () => {
  it('writes state on each dispatch, including invalid ones', () => {
    const h = makeHarness(ALL(2));
    h.run(['prev-short', 'complete', 'complete']);
    expect(h.persisted.length).toBe(3);
    expect(h.persisted[1].statuses[0]).toBe('done');
  });
});

describe('resume position (breakpoint resume display)', () => {
  it('lands on the first pending unit even after skip/undo maneuvers', () => {
    const h = makeHarness(ALL(4));
    h.run(['complete', 'complete']); // 0,1 done
    h.run(['skip']); // 2 skipped, pointer -> 3
    expect(resumePosition(h.state)).toBe(4); // 1-based, on pending unit already
    h.run(['prev-long']); // back to 2 (skipped -> cleared to pending by undo)
    expect(resumePosition(h.state)).toBe(3);
    // walk to the very end: nothing pending -> last position
    const h2 = makeHarness(ALL(1));
    h2.run(['complete']);
    expect(resumePosition(h2.state)).toBe(1);
  });
});
