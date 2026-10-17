// Speaker: speechSynthesis wrapper.
// - cancel() before every speak so announcements never queue up (plan section 6)
// - utterance is rebuilt per announcement with rate 0.9 (default, adjustable later)
// - voices load asynchronously (voiceschanged) -- retried lazily at speak time
// - if TTS is unavailable at all: WebAudio beep + vibration fallback, flow goes on

import { WebAudioBeep } from './beep';
import { recordSay } from '../util/testhooks';

export interface SpeakerOptions {
  rate?: number;
  lang?: string;
  onFallback?: () => void; // called when speechSynthesis is unusable
}

// Natural-sounding Chinese voice name fragments, best first. Windows ships
// Huihui/Yaoyao/Kangkang (robotic SAPI voices) and often better "Natural"
// online voices; the emulator ships Google voices. Score = earlier hint match
// wins, a zh voice always beats a non-zh one.
const ZH_VOICE_HINTS = ['xiaoxiao', 'yunxi', 'yunyang', 'xiaoyi', 'yunjian',
  'natural', 'google', 'xiaobei', 'li-mu', 'yunye',
  'huihui', 'yaoyao', 'kangkang', 'tingting', 'meijia', 'sinji'];

function scoreVoice(v: SpeechSynthesisVoice, lang: string): number {
  const zhis = v.lang.toLowerCase().startsWith('zh') ? 100 : 0;
  const name = v.name.toLowerCase();
  const hint = ZH_VOICE_HINTS.findIndex((h) => name.includes(h));
  const hintScore = hint >= 0 ? (ZH_VOICE_HINTS.length - hint) : 0;
  const localBonus = v.localService ? 1 : 0; // offline-capable
  const langBonus = v.lang.toLowerCase() === lang.toLowerCase() ? 2 : 0;
  return zhis + hintScore + langBonus + localBonus;
}

export class Speaker {
  private synth: SpeechSynthesis | null;
  private rate: number;
  private lang: string;
  private voiceName: string | null = null; // user-pinned voice (settings)
  private voices: SpeechSynthesisVoice[] = [];
  private voicesReady = false;
  private beeper: WebAudioBeep;
  private onFallback?: () => void;

  constructor(synth: SpeechSynthesis | null = defaultSynth(), opts: SpeakerOptions = {}) {
    this.synth = synth;
    this.rate = opts.rate ?? 0.9;
    this.lang = opts.lang ?? 'zh-CN';
    this.onFallback = opts.onFallback;
    this.beeper = new WebAudioBeep();
    if (this.synth) {
      this.loadVoices();
      this.synth.addEventListener?.('voiceschanged', () => this.loadVoices());
    }
  }

  private loadVoices() {
    if (!this.synth) return;
    const v = this.synth.getVoices();
    if (v.length > 0) {
      this.voices = v;
      this.voicesReady = true;
    }
  }

  /** iOS needs a user gesture before speech works; call from the start button. */
  unlock() {
    if (!this.synth) return;
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      this.synth.speak(u);
    } catch {
      // engine refused the warm-up; real announcements will fall back if needed
    }
  }

  get available(): boolean {
    return this.synth !== null;
  }

  /** Settings screen: adjust the speech rate (0.7-1.2, plan section 6). */
  setRate(rate: number) {
    this.rate = Math.min(1.2, Math.max(0.7, rate));
  }

  get currentRate(): number {
    return this.rate;
  }

  /** Pin a voice by name (settings picker); null = automatic best pick. */
  setVoice(name: string | null) {
    this.voiceName = name || null;
  }

  listVoices(): SpeechSynthesisVoice[] {
    if (!this.voicesReady) this.loadVoices();
    return this.voices;
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    if (!this.voicesReady) this.loadVoices();
    if (this.voiceName) {
      const pinned = this.voices.find((v) => v.name === this.voiceName);
      if (pinned) return pinned;
    }
    const zh = this.voices.filter((v) => v.lang.toLowerCase().startsWith('zh'));
    const pool = zh.length > 0 ? zh : this.voices;
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = -1;
    for (const v of pool) {
      const sc = scoreVoice(v, this.lang);
      if (sc > bestScore) {
        best = v;
        bestScore = sc;
      }
    }
    return best;
  }

  /** Announce text immediately; cancels any queued speech first. */
  say(text: string) {
    recordSay(text);
    if (!this.synth) {
      this.fallback();
      return;
    }
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = this.rate;
    u.lang = this.lang;
    const voice = this.pickVoice();
    if (voice) u.voice = voice;
    try {
      this.synth.speak(u);
    } catch {
      this.fallback();
    }
  }

  /** Short feedback blip (batch mode piece confirmation, plan section 9). */
  blip() {
    this.beeper.play(1250, 70); // play() records the beep-count seam
  }

  private fallback() {
    this.beeper.play();
    this.onFallback?.();
  }

  dispose() {
    this.synth?.cancel();
  }
}

function defaultSynth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null;
}
