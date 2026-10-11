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

export class Speaker {
  private synth: SpeechSynthesis | null;
  private rate: number;
  private lang: string;
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

  private pickVoice(): SpeechSynthesisVoice | null {
    if (!this.voicesReady) this.loadVoices();
    return (
      this.voices.find((v) => v.lang === this.lang) ??
      this.voices.find((v) => v.lang.startsWith('zh')) ??
      null
    );
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
