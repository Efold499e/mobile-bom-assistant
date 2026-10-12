// Loader tests: accept the frozen demo task, reject the M0 negative-sample
// scenarios (TS ports), and keep parity with the Python validator on the
// post-self-review rules (timezone, negative coords).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStjText } from './index';

const DEMO_PATH = fileURLToPath(new URL('../../public/demo/demo.stj.json', import.meta.url));
const demoText = readFileSync(DEMO_PATH, 'utf-8');

describe('demo task acceptance', () => {
  const r = parseStjText(demoText);
  it('validates cleanly', () => {
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it('stats match the M0 appendix B baseline', () => {
    expect(r.stats).toEqual({
      project: 'demo-board',
      source: 'hand',
      placements: 12,
      groups: 5,
      polarity: 3,
      sides: 2,
      landmarks: 2,
    });
  });
});

describe('dec3 tolerant compare (M5 friction: real-board import)', () => {
  // 8.05 and 16.106 are decimal-clean but v*1000 lands on 8050.000000000001 /
  // 16106.000000000002 in IEEE754; the exact check rejected real coordinates.
  const mk = (x: number, y: number) => `{
    "format": "solder-task-json", "version": 1,
    "meta": { "project": "fp", "source": "kicad", "created_at": "2026-10-12T00:00:00+08:00",
      "board": { "width_mm": 30, "height_mm": 20, "outline": [[0,0],[30,0],[30,20],[0,20]] },
      "landmarks": [{ "ref": "J2", "speak": "J2 接插件", "x_mm": ${x}, "y_mm": ${y} }] },
    "sides": ["top"],
    "groups": [{ "gid": "g0", "kind": "r", "footprint": "0603", "value": "10k", "polarity": false, "qty": 1, "refdes": ["R1"] }],
    "placements": [{ "pid": 0, "gid": "g0", "ref": "R1", "side": "top", "x_mm": ${x}, "y_mm": ${y}, "rot_deg": 0, "bbox_mm": [1.6, 0.8] }],
    "group_order_default": ["g0"] }`;
  it('accepts decimal-clean 8.05 / 16.106', () => {
    const r = parseStjText(mk(8.05, 16.106));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it('still rejects a real 4-decimal value', () => {
    const r = parseStjText(mk(8.05001, 10));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('E_DECIMALS'))).toBe(true);
  });
});

describe('rejects bad STJ (M0 negative scenarios, TS ports)', () => {
  const clone = () => JSON.parse(demoText) as Record<string, unknown>;

  it('wrong version', () => {
    const d = clone();
    d['version'] = 2;
    const r = parseStjText(JSON.stringify(d));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('E_VERSION'))).toBe(true);
  });

  it('missing required field (meta)', () => {
    const d = clone();
    delete d['meta'];
    const r = parseStjText(JSON.stringify(d));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('E_MISSING') && e.includes('meta'))).toBe(true);
  });

  it('dangling gid', () => {
    const d = clone();
    (d['placements'] as { gid: string }[])[0].gid = 'g999';
    const r = parseStjText(JSON.stringify(d));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('E_DANGLING'))).toBe(true);
  });

  it('qty inconsistency (parity with M0 E_QTY)', () => {
    const d = clone();
    (d['groups'] as { qty: number }[])[0].qty = 3;
    const r = parseStjText(JSON.stringify(d));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('E_QTY'))).toBe(true);
  });

  it('created_at without timezone (post-M0-review rule)', () => {
    const d = clone();
    ((d['meta'] as Record<string, unknown>)['created_at']) = '2026-10-11T12:00:00';
    const r = parseStjText(JSON.stringify(d));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('timezone'))).toBe(true);
  });

  it('negative coordinate (post-M0-review rule)', () => {
    const d = clone();
    (d['placements'] as { x_mm: number }[])[0].x_mm = -0.4;
    const r = parseStjText(JSON.stringify(d));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('E_RANGE') && e.includes('x_mm'))).toBe(true);
  });

  it('not JSON at all', () => {
    const r = parseStjText('this is not json');
    expect(r.ok).toBe(false);
    expect(r.errors[0].startsWith('E_JSON')).toBe(true);
  });
});
