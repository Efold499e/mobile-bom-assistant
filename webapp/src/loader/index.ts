// Loader entry: parse + validate STJ text, used by import flow and demo seeding.

import { validateStj } from './validate';
import type { StjTask, TaskStats } from './types';

export type { StjTask, TaskStats } from './types';
export { validateStj, computeStats } from './validate';

export interface ParseResult {
  ok: boolean;
  task: StjTask | null;
  stats: TaskStats | null;
  errors: string[];
  warnings: string[];
}

export function parseStjText(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      task: null,
      stats: null,
      errors: [`E_JSON: not valid JSON: ${e instanceof Error ? e.message : String(e)}`],
      warnings: [],
    };
  }
  const v = validateStj(data);
  return { ok: v.ok, task: v.task, stats: v.stats, errors: v.errors, warnings: v.warnings };
}

/** soak F-UX3: translate validator error lines into welder-facing guidance
 * (what went wrong + what to do next). Unknown codes fall back to a generic
 * line; the caller may still show the raw lines as detail. */
export function friendlyErrors(errors: string[]): string[] {
  if (errors.length === 0) return [];
  const codeOf = (line: string) => line.split(':', 1)[0];
  const first = codeOf(errors[0]);
  switch (first) {
    case 'E_JSON':
      return ['这不是合法的 JSON 文本。请确认粘贴的是完整任务文件：用 PC 端 bom2task 导出的 .stj.json 全文（别只复制一半）。'];
    case 'E_FORMAT':
      return ['这不是焊接任务文件（format 字段不对）。请用 PC 端 bom2task 转换后导入，不要直接用 BOM/坐标 CSV 或其他 JSON。'];
    case 'E_VERSION':
      return ['任务文件版本不认识，目前只支持 v1。请用最新版 bom2task 重新导出。'];
    case 'E_MISSING':
      return [`任务文件缺少必要字段，共 ${errors.length} 处问题。请用 bom2task 重新导出完整文件，不要手改 JSON。`];
    default:
      return [`任务文件内容不符合焊接任务规范，共 ${errors.length} 处问题（如 ${first.replace('E_', '').toLowerCase()} 类错误）。请用 bom2task 重新导出；若文件由 bom2task 生成，请附下方明细反馈。`];
  }
}
