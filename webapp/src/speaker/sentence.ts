// Sentence composition for TTS announcements.
// Pure functions, testable without a speech engine.
// Text atoms (value_speak / footprint_speak / landmark speak) come from the
// STJ data; orientation words are computed on-device from x/y + calibration
// (plan sections 4 + 6 + 7).

import type { Side, StjGroup, StjTask } from '../loader/types';
import { directionWord, nearestLandmark, type Flip } from '../boardmap/geo';

export interface UnitAnnouncement {
  index: number; // 1-based queue position
  total: number;
  group: StjGroup;
  /** User-frame location phrase (e.g. 板子右上，靠 Type-C 座), precomposed by
   * locationPhrase. Omitted before calibration -- 宁可少说，不说错的. */
  loc?: string;
}

export function speakValue(group: StjGroup): string {
  return group.value_speak ?? group.value;
}

export function speakFootprint(group: StjGroup): string {
  return group.footprint_speak ?? group.footprint;
}

/** 「第 5 颗，共 32 颗。0603 电阻，10千欧，板子右上，靠 Type-C 座。注意极性。」 */
export function unitSentence(a: UnitAnnouncement): string {
  const parts = [
    `第 ${a.index} 颗，共 ${a.total} 颗。`,
    `${speakFootprint(a.group)}，${speakValue(a.group)}${a.loc ? `，${a.loc}` : ''}。`,
  ];
  if (a.group.polarity) parts.push('注意极性。');
  return parts.join('');
}

/** TTS form of the location phrase: 「板子右上，靠 Type-C 座」 (landmark half
 * omitted when the task has none; null before calibration). */
export function locationPhrase(
  x_mm: number,
  y_mm: number,
  task: StjTask,
  flip: Flip,
  calibDeg: number | null,
): string | null {
  if (calibDeg === null) return null;
  const box = { w: task.meta.board.width_mm, h: task.meta.board.height_mm };
  const word = directionWord({ x: x_mm, y: y_mm }, box, flip, calibDeg);
  const lm = nearestLandmark({ x: x_mm, y: y_mm }, task.meta.landmarks);
  return lm ? `板子${word}，靠${lm.speak}` : `板子${word}`;
}

/** Card form: 「板子右上 · 靠 Type-C」 (shorter separator, no speak suffix). */
export function locationCardText(
  x_mm: number,
  y_mm: number,
  task: StjTask,
  flip: Flip,
  calibDeg: number | null,
): string | null {
  if (calibDeg === null) return null;
  const box = { w: task.meta.board.width_mm, h: task.meta.board.height_mm };
  const word = directionWord({ x: x_mm, y: y_mm }, box, flip, calibDeg);
  const lm = nearestLandmark({ x: x_mm, y: y_mm }, task.meta.landmarks);
  return lm ? `板子${word} · 靠${lm.speak}` : `板子${word}`;
}

/** 「下一组，10 颗 100纳法，位置都亮出来了，一起焊。」 (plan section 6). */
export function groupIntroSentence(group: StjGroup, qty: number): string {
  return `下一组，${qty} 颗 ${speakValue(group)}，位置都亮出来了，一起焊。`;
}

/** Ask dialog text: 「4 颗 10千欧，一起焊？」 */
export function askBatchSentence(group: StjGroup, qty: number): string {
  return `${qty} 颗 ${speakValue(group)}，一起焊？`;
}

/** Milestone inside a batch group; null = stay silent this piece. */
export function batchMilestoneSentence(remaining: number): string | null {
  if (remaining === 3) return '这组还剩 3 颗。';
  if (remaining === 1) return '这组还剩最后 1 颗。';
  return null;
}

/** 「全部播完了，进入收尾清单。」 -- queue exhausted with leftovers (plan §6). */
export function finishListSentence(): string {
  return '全部播完了，进入收尾清单。';
}

/** 「正面焊完了，翻面继续。」 / 「背面焊完了，翻面继续。」 (plan §9). */
export function faceDoneSentence(side: Side): string {
  return `${side === 'top' ? '正面' : '背面'}焊完了，翻面继续。`;
}

/** 「收工。共 32 颗，用时 47 分钟。」 */
export function finishSentence(task: StjTask, elapsedMs: number): string {
  const minutes = Math.max(1, Math.round(elapsedMs / 60000));
  return `收工。共 ${task.placements.length} 颗，用时 ${minutes} 分钟。`;
}

export function sideWord(side: Side): string {
  return side === 'top' ? '正面' : '背面';
}
