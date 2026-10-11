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
