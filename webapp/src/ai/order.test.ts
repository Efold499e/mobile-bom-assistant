// AI menu ordering (2026-10-24): endpoint URL guard, prompt shape, tolerant
// reply parsing with strict permutation validation, request error mapping.

import { describe, expect, it, vi } from 'vitest';
import {
  AiOrderError,
  DEFAULT_AI_BASE,
  buildOrderMessages,
  normalizeApiBase,
  parseAiOrder,
  requestAiOrder,
} from './order';
import { DEFAULT_SETTINGS } from '../store/db';
import type { StjTask } from '../loader/types';

const task = {
  format: 'solder-task-json',
  version: 1,
  meta: {
    project: 't',
    source: 'hand',
    created_at: '2026-10-24T00:00:00+08:00',
    board: { width_mm: 30, height_mm: 20, outline: [[0, 0], [30, 0], [30, 20], [0, 20]] },
    landmarks: [],
  },
  sides: ['top'],
  groups: [
    { gid: 'g0', kind: 'r', footprint: '0603', value: '10k', polarity: false, qty: 4, refdes: ['R1'] },
    { gid: 'g1', kind: 'ic', footprint: 'SOT-23-5', value: 'ME6211', polarity: true, qty: 1, refdes: ['U1'] },
    { gid: 'g2', kind: 'c', footprint: '0603', value: '100nF', polarity: false, qty: 3, refdes: ['C1'] },
  ],
  placements: [],
  group_order_default: ['g0', 'g1', 'g2'],
} as unknown as StjTask;

const okSettings = { ...DEFAULT_SETTINGS, aiApiKey: 'sk-test' };

describe('normalizeApiBase (endpoint guard, mirrors ai_loc.py)', () => {
  it('accepts https and strips trailing slashes', () => {
    expect(normalizeApiBase('https://api.deepseek.com')).toBe('https://api.deepseek.com');
    expect(normalizeApiBase('  https://api.deepseek.com/  ')).toBe('https://api.deepseek.com');
    expect(normalizeApiBase('https://api.example.com/v1///')).toBe('https://api.example.com/v1');
  });
  it('rejects non-https and garbage', () => {
    expect(() => normalizeApiBase('http://api.deepseek.com')).toThrow(AiOrderError);
    expect(() => normalizeApiBase('not a url')).toThrow(AiOrderError);
  });
  it('rejects localhost and .local names', () => {
    for (const host of ['https://localhost', 'https://localhost:8000', 'https://foo.localhost', 'https://nas.local']) {
      expect(() => normalizeApiBase(host)).toThrow(/内网|本机/);
    }
  });
  it('rejects loopback / private / link-local literal IPs', () => {
    for (const host of [
      'https://127.0.0.1', 'https://10.1.2.3', 'https://172.16.0.9', 'https://192.168.1.1',
      'https://169.254.1.1', 'https://0.0.0.0', 'https://[::1]',
    ]) {
      expect(() => normalizeApiBase(host)).toThrow(/内网|本机/);
    }
  });
  it('allows fake-IP proxy ranges and public hosts', () => {
    expect(normalizeApiBase('https://198.18.0.1')).toBe('https://198.18.0.1');
    expect(normalizeApiBase('https://[2001:2::10]')).toBe('https://[2001:2::10]');
    expect(normalizeApiBase('https://api.deepseek.com')).toBe(DEFAULT_AI_BASE);
  });
});

describe('buildOrderMessages', () => {
  it('includes system rules, default order, group lines and the user text', () => {
    const msgs = buildOrderMessages(task, '先焊电阻，IC 放最后');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('恰好包含');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('[默认顺序]\ng0, g1, g2');
    expect(msgs[1].content).toContain('g0|10k|0603|x4|无极性|电阻');
    expect(msgs[1].content).toContain('g1|ME6211|SOT-23-5|x1|极性|IC');
    expect(msgs[1].content).toContain('[用户指令]\n先焊电阻，IC 放最后');
  });
});

describe('parseAiOrder (tolerant extract, strict permutation)', () => {
  it('accepts a plain array and a fenced array', () => {
    expect(parseAiOrder('["g2","g0","g1"]', ['g0', 'g1', 'g2'])).toEqual(['g2', 'g0', 'g1']);
    expect(parseAiOrder('好的：\n```json\n["g1", "g2", "g0"]\n```\n完成', ['g0', 'g1', 'g2']))
      .toEqual(['g1', 'g2', 'g0']);
  });
  it('rejects non-array garbage and unknown/dup/missing gids', () => {
    expect(() => parseAiOrder('我排好了 g0 g1 g2', ['g0', 'g1', 'g2'])).toThrow(/JSON 数组/);
    expect(() => parseAiOrder('["g0","x9"]', ['g0', 'g1', 'g2'])).toThrow(/未知分组/);
    expect(() => parseAiOrder('["g0","g0","g1"]', ['g0', 'g1', 'g2'])).toThrow(/重复/);
    expect(() => parseAiOrder('["g0","g1"]', ['g0', 'g1', 'g2'])).toThrow(/缺少/);
    expect(() => parseAiOrder('["g0",1,"g1"]', ['g0', 'g1', 'g2'])).toThrow(/gid 字符串数组/);
  });
});

// OpenAI-shaped reply builder for fetch stubs
function jsonResp(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('requestAiOrder (fetch stubbed)', () => {
  it('posts to base/chat/completions with bearer key and returns the order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(jsonResp('["g2","g0","g1"]')), { status: 200 }));
    const order = await requestAiOrder({
      task,
      userText: '电容先焊',
      settings: okSettings,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(order).toEqual(['g2', 'g0', 'g1']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('deepseek-chat');
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content).toContain('电容先焊');
  });
  it('uses configured base and model overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(jsonResp('["g0","g1","g2"]')), { status: 200 }));
    await requestAiOrder({
      task,
      userText: '默认即可',
      settings: { ...okSettings, aiBaseUrl: 'https://api.example.com/v1', aiModel: 'test-model' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('test-model');
  });
  it('missing key -> E_AI_NOKEY before any network call', async () => {
    const fetchMock = vi.fn();
    await expect(requestAiOrder({
      task, userText: 'x', settings: { ...DEFAULT_SETTINGS }, fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow(/API Key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('bad endpoint -> E_AI_URL before any network call', async () => {
    const fetchMock = vi.fn();
    await expect(requestAiOrder({
      task, userText: 'x', settings: { ...okSettings, aiBaseUrl: 'http://localhost:9' }, fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow(/仅允许 https/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('maps HTTP 401/429/500 to friendly messages', async () => {
    for (const [status, re] of [[401, /Key 无效/], [429, /限流/], [500, /HTTP 500/]] as const) {
      const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status }));
      await expect(requestAiOrder({
        task, userText: 'x', settings: okSettings, fetchImpl: fetchMock as unknown as typeof fetch,
      })).rejects.toThrow(re);
    }
  });
  it('maps network failure and abort timeout', async () => {
    const netFail = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(requestAiOrder({
      task, userText: 'x', settings: okSettings, fetchImpl: netFail as unknown as typeof fetch,
    })).rejects.toThrow(/网络请求失败/);
    const aborting = vi.fn().mockImplementation((_u, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    await expect(requestAiOrder({
      task, userText: 'x', settings: okSettings, fetchImpl: aborting as unknown as typeof fetch, timeoutMs: 20,
    })).rejects.toThrow(/超时/);
  });
  it('surfaces parse/permutation errors from the reply content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(jsonResp('["g0","g1"]')), { status: 200 }));
    await expect(requestAiOrder({
      task, userText: 'x', settings: okSettings, fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow(/缺少/);
  });
});
