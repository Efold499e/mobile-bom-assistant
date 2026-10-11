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
