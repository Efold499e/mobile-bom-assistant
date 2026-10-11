// Sentence composition for TTS announcements.
// Pure functions, testable without a speech engine.
// M1 scope: no orientation words (card location row is blank), no landmarks,
// batch groups are announced piece by piece with the full sentence.

import type { StjGroup, StjTask } from '../loader/types';

export interface UnitAnnouncement {
  index: number; // 1-based queue position
  total: number;
  group: StjGroup;
}

export function speakValue(group: StjGroup): string {
  return group.value_speak ?? group.value;
}

export function speakFootprint(group: StjGroup): string {
  return group.footprint_speak ?? group.footprint;
}

/** "第 5 颗，共 32 颗。0603 电阻，10千欧。注意极性。" (location half omitted in M1) */
export function unitSentence(a: UnitAnnouncement): string {
  const parts = [
    `第 ${a.index} 颗，共 ${a.total} 颗。`,
    `${speakFootprint(a.group)}，${speakValue(a.group)}。`,
  ];
  if (a.group.polarity) parts.push('注意极性。');
  return parts.join('');
}

/** "下一组，10 颗 100纳法，位置都亮出来了，一起焊。" -- reserved for M3/M4 batch mode. */
export function groupIntroSentence(_group: StjGroup, _qty: number): string {
  return '';
}

/** "收工。共 32 颗，用时 47 分钟。" */
export function finishSentence(task: StjTask, elapsedMs: number): string {
  const minutes = Math.max(1, Math.round(elapsedMs / 60000));
  return `收工。共 ${task.placements.length} 颗，用时 ${minutes} 分钟。`;
}

export function sideWord(side: 'top' | 'bottom'): string {
  return side === 'top' ? '正面' : '背面';
}
