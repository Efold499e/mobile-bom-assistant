import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStjText } from '../loader';
import { planQueue, snakeOrder } from './snake';

const DEMO_PATH = fileURLToPath(new URL('../../public/demo/demo.stj.json', import.meta.url));

describe('planQueue on the frozen demo task', () => {
  const task = parseStjText(readFileSync(DEMO_PATH, 'utf-8')).task!;
  it('follows group_order_default, serpentining inside each group', () => {
    const refs = planQueue(task).map((u) => u.ref);
    // g0 R1-R4 (y=6, x asc), g1 C1-C3 (y=12), g2 LED1-2 (y=20), g3 U1, g4 R5-R6 (y=26)
    expect(refs).toEqual([
      'R1', 'R2', 'R3', 'R4',
      'C1', 'C2', 'C3',
      'LED1', 'LED2',
      'U1',
      'R5', 'R6',
    ]);
  });
  it('assigns 1-based sequential positions', () => {
    const seqs = planQueue(task).map((u) => u.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('snakeOrder serpentine behavior', () => {
  it('reverses direction on every other band (wrap-around case)', () => {
    const mk = (pid: number, x: number, y: number) => ({
      pid, gid: 'g0', ref: `p${pid}`, side: 'top' as const,
      x_mm: x, y_mm: y, rot_deg: 0, bbox_mm: [1.0, 1.0] as [number, number],
    });
    // two rows 2mm apart, bbox height 1 -> band height 1.5 -> two bands
    const row1 = [mk(0, 0, 0), mk(1, 10, 0), mk(2, 20, 0)];
    const row2 = [mk(3, 0, 2), mk(4, 10, 2), mk(5, 20, 2)];
    const out = snakeOrder([...row2, ...row1], '0603');
    expect(out.map((p) => p.pid)).toEqual([0, 1, 2, 5, 4, 3]); // asc, then desc
  });
  it('keeps one row in a single band even when unordered', () => {
    const mk = (pid: number, x: number, y: number) => ({
      pid, gid: 'g0', ref: `p${pid}`, side: 'top' as const,
      x_mm: x, y_mm: y, rot_deg: 0,
    });
    const out = snakeOrder([mk(2, 20, 6), mk(0, 0, 6.2), mk(1, 10, 5.8)], '0603');
    expect(out.map((p) => p.pid)).toEqual([0, 1, 2]);
  });
});
