// AI menu ordering (2026-10-24 user request): the 报菜名 screen lets the user
// arrange the pick order by tapping group chips; this module adds a natural-
// language path on top -- the user types an instruction (「先焊电阻，IC 放最后」)
// and a chat-completions agent returns the group order. Same shape as the
// converter's ai_loc.py: OpenAI-compatible API, tolerant JSON extraction,
// designed degradation (any failure leaves the manual picks untouched).
//
// Endpoint is user-configured in Settings; the URL guard mirrors ai_loc's
// SSRF rules (https only, no localhost/loopback/private/reserved hosts).

import type { StjTask } from '../loader/types';
import type { AppSettings } from '../store/db';

export const DEFAULT_AI_BASE = 'https://api.deepseek.com';
export const DEFAULT_AI_MODEL = 'deepseek-chat';
const TIMEOUT_MS = 30_000;

export type AiOrderErrorCode =
  | 'E_AI_URL' | 'E_AI_NOKEY' | 'E_AI_NETWORK' | 'E_AI_TIMEOUT'
  | 'E_AI_HTTP' | 'E_AI_FORMAT' | 'E_AI_PERM';

export class AiOrderError extends Error {
  code: AiOrderErrorCode;
  constructor(code: AiOrderErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ── endpoint guard (mirror of converter/ai_loc.py _checked_url) ──

// ai_loc note: local proxy software in fake-IP DNS mode resolves every name
// into 198.18.0.0/15 / 2001:2::/48, so those are accepted.
const BLOCKED_V4: [number, number, number][] = [
  [0, 0, 8], [10, 0, 8], [127, 0, 8], [169, 254, 16], [172, 16, 12], [192, 168, 16],
];

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const o = h.split('.').map(Number);
    for (const [a, b, n] of BLOCKED_V4) {
      const net = a * 256 ** 3 + b * 256 ** 2;
      const addr = ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
      const mask = 256 ** 4 - 256 ** (4 - n / 8);
      if ((addr & mask) === (net & mask)) return true;
      void net;
    }
    return false;
  }
  if (h.includes(':')) {
    const v6 = h.replace(/^\[|\]$/g, '');
    if (v6 === '::1' || v6 === '::') return true;
    const first = v6.split(':')[0] ?? '';
    if (/^f[cd]/i.test(first)) return true; // fc00::/7 unique local
    if (/^fe[89ab]/i.test(first)) return true; // fe80::/10 link local
    if (/^2001:2:/i.test(v6)) return false; // benchmark range = fake-IP proxy
    return false;
  }
  return false;
}

/** Validate + normalize the user-configured API base. Returns the base with no
 * trailing slash; throws E_AI_URL on anything not https or pointing inside. */
export function normalizeApiBase(raw: string): string {
  const t = raw.trim().replace(/\/+$/, '');
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new AiOrderError('E_AI_URL', 'API 地址不是合法 URL');
  }
  if (u.protocol !== 'https:') {
    throw new AiOrderError('E_AI_URL', 'API 地址仅允许 https');
  }
  if (isBlockedHost(u.hostname)) {
    throw new AiOrderError('E_AI_URL', 'API 地址不允许指向内网/本机地址');
  }
  return t;
}

// ── prompt (language mirrors ai_loc.py: plain Chinese, JSON-only reply) ──

const SYSTEM_PROMPT = `你是焊接助手「报菜名」的取料排序助手。焊接前用户把元件袋摆在桌上，需要定一个焊接顺序。你会收到：元件组清单（gid|值|封装|数量|极性）、默认顺序和一句口语指令。

规则：
1. 先焊的排前面；数组元素是 gid 字符串；
2. 数组必须恰好包含清单里的每个 gid 各一次：不增、不减、不重复；
3. 用户指令没提到的组，保持默认顺序接在后面；
4. 指令若与工艺常识冲突（如要求先焊易损 IC 再焊会遮挡它的大件），以用户指令为准；
5. 只输出一个 JSON 数组（形如 ["g2","g0"]），不要 markdown 代码块，不要任何解释。`;

export function buildOrderMessages(task: StjTask, userText: string) {
  const kinds: Record<string, string> = {
    r: '电阻', c: '电容', l: '电感', d: '二极管', led: 'LED', q: '三极管',
    ic: 'IC', conn: '接插件', sw: '开关', mech: '机械件', other: '其他',
  };
  const lines = task.groups.map((g) =>
    `${g.gid}|${g.value}|${g.footprint}|x${g.qty}|${g.polarity ? '极性' : '无极性'}|${kinds[g.kind] ?? g.kind}`,
  );
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `[默认顺序]\n${task.group_order_default.join(', ')}\n\n[元件组清单]\n${lines.join('\n')}\n\n[用户指令]\n${userText}`,
    },
  ];
}

// ── reply parsing (tolerant extraction, strict permutation check) ──

/** Extract and validate a gid permutation from the model reply. Throws
 * E_AI_FORMAT / E_AI_PERM with a human-readable message on any problem. */
export function parseAiOrder(text: string, validGids: string[]): string[] {
  const body = text.replace(/```(?:json)?|```/g, '');
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end <= start) {
    throw new AiOrderError('E_AI_FORMAT', 'AI 没有返回 JSON 数组');
  }
  let arr: unknown;
  try {
    arr = JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new AiOrderError('E_AI_FORMAT', 'AI 返回的数组无法解析');
  }
  if (!Array.isArray(arr) || arr.some((x) => typeof x !== 'string')) {
    throw new AiOrderError('E_AI_FORMAT', 'AI 返回的不是 gid 字符串数组');
  }
  const want = new Set(validGids);
  const seen = new Set<string>();
  for (const gid of arr as string[]) {
    if (!want.has(gid)) {
      throw new AiOrderError('E_AI_PERM', `AI 返回了未知分组 ${gid}`);
    }
    if (seen.has(gid)) {
      throw new AiOrderError('E_AI_PERM', `AI 返回的顺序里 ${gid} 重复`);
    }
    seen.add(gid);
  }
  if (seen.size !== validGids.length) {
    const missing = validGids.filter((g) => !seen.has(g));
    throw new AiOrderError('E_AI_PERM', `AI 返回的顺序缺少 ${missing.join('、')}`);
  }
  return arr as string[];
}

// ── request ──

export async function requestAiOrder(opts: {
  task: StjTask;
  userText: string;
  settings: AppSettings;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const base = normalizeApiBase(opts.settings.aiBaseUrl || DEFAULT_AI_BASE);
  const key = (opts.settings.aiApiKey ?? '').trim();
  if (!key) {
    throw new AiOrderError('E_AI_NOKEY', '未配置 API Key：请到 设置 → AI 排序 填写');
  }
  const model = opts.settings.aiModel?.trim() || DEFAULT_AI_MODEL;
  const url = `${base}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  const doFetch = opts.fetchImpl ?? fetch;
  let reply: unknown;
  try {
    const resp = await doFetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: buildOrderMessages(opts.task, opts.userText),
        temperature: 0,
        stream: false,
      }),
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new AiOrderError('E_AI_HTTP', 'API Key 无效或没有权限');
    }
    if (resp.status === 429) {
      throw new AiOrderError('E_AI_HTTP', '请求过于频繁（服务商限流），稍后再试');
    }
    if (!resp.ok) {
      throw new AiOrderError('E_AI_HTTP', `服务商返回错误（HTTP ${resp.status}）`);
    }
    reply = await resp.json();
  } catch (e) {
    if (e instanceof AiOrderError) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new AiOrderError('E_AI_TIMEOUT', '请求超时，请检查网络后重试');
    }
    throw new AiOrderError('E_AI_NETWORK', '网络请求失败（检查联网；APK/PWA 需放行该域名）');
  } finally {
    clearTimeout(timer);
  }
  const content = (reply as { choices?: { message?: { content?: string } }[] })
    ?.choices?.[0]?.message?.content ?? '';
  return parseAiOrder(content, opts.task.group_order_default);
}
