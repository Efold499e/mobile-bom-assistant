// Speaker tests: sentence composition (pure) + Speaker.say against a mock
// speechSynthesis (cancel-before-speak, rate, fallback path).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishSentence, sideWord, speakFootprint, speakValue, unitSentence } from './sentence';
import { Speaker } from './speaker';
import type { StjGroup, StjTask } from '../loader/types';

const g0: StjGroup = {
  gid: 'g0', kind: 'r', footprint: '0603', footprint_speak: '0603 电阻',
  value: '10k', value_speak: '10千欧', polarity: false, qty: 4, refdes: ['R1'],
};
const led: StjGroup = {
  gid: 'g2', kind: 'led', footprint: '0805', footprint_speak: '0805 发光二极管',
  value: 'RED', value_speak: '红色', polarity: true, qty: 2, refdes: ['LED1'],
};
const noSpeak: StjGroup = {
  gid: 'gx', kind: 'c', footprint: 'C0402', value: '104', polarity: false,
  qty: 1, refdes: ['C9'],
};

describe('sentence composition', () => {
  it('normal piece follows the plan template (location half omitted in M1)', () => {
    expect(unitSentence({ index: 5, total: 32, group: g0 })).toBe(
      '第 5 颗，共 32 颗。0603 电阻，10千欧。',
    );
  });
  it('polarity pieces append the warning', () => {
    const s = unitSentence({ index: 8, total: 12, group: led });
    expect(s).toBe('第 8 颗，共 12 颗。0805 发光二极管，红色。注意极性。');
  });
  it('falls back to raw value/footprint when speak atoms are missing', () => {
    expect(speakValue(noSpeak)).toBe('104');
    expect(speakFootprint(noSpeak)).toBe('C0402');
  });
  it('finish sentence reports count and minutes', () => {
    const task = { placements: new Array(12) } as unknown as StjTask;
    expect(finishSentence(task, 47 * 60 * 1000)).toBe('收工。共 12 颗，用时 47 分钟。');
    expect(finishSentence(task, 10 * 1000)).toBe('收工。共 12 颗，用时 1 分钟。');
  });
  it('side word', () => {
    expect(sideWord('top')).toBe('正面');
    expect(sideWord('bottom')).toBe('背面');
  });
});

class FakeUtterance {
  text: string;
  rate = 1;
  lang = '';
  voice: unknown = null;
  constructor(text: string) {
    this.text = text;
  }
}

function makeFakeSynth() {
  const calls: { cancel: number; spoken: FakeUtterance[] } = { cancel: 0, spoken: [] };
  const synth = {
    cancel() {
      calls.cancel += 1;
    },
    speak(u: FakeUtterance) {
      calls.spoken.push(u);
    },
    getVoices(): unknown[] {
      return [];
    },
    addEventListener() {},
  };
  return { synth, calls };
}

describe('Speaker with mock speechSynthesis', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancels before speaking, applies rate 0.9', () => {
    const { synth, calls } = makeFakeSynth();
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    const sp = new Speaker(synth as unknown as SpeechSynthesis);
    sp.say('第 1 颗');
    sp.say('第 2 颗');
    expect(calls.cancel).toBe(2);
    expect(calls.spoken).toHaveLength(2);
    expect(calls.spoken[0].text).toBe('第 1 颗');
    expect(calls.spoken[0].rate).toBe(0.9);
    expect(calls.spoken[1].text).toBe('第 2 颗'); // never queued: second cancel() before speak
    expect(calls.spoken[1].rate).toBe(0.9);
  });

  it('falls back to beep+vibrate path when speechSynthesis is absent', () => {
    const sp = new Speaker(null, { onFallback: () => {
      // flag via closure
    } });
    // no crash; available=false drives the UI fallback chain
    expect(sp.available).toBe(false);
  });
});
