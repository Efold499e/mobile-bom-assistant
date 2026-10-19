// Browser-API shims over Capacitor native bridges.
// The Android WebView has no Web Speech API and no Screen Wake Lock API;
// installing these shims lets Speaker / Settings / WakeLockHolder run
// unmodified inside the native shell (web and native ship the same code).
// Imported only in native builds -- main.tsx, vite mode=native.

import { Capacitor } from '@capacitor/core';
import { TextToSpeech, QueueStrategy } from '@capacitor-community/text-to-speech';
import { KeepAwake } from '@capacitor-community/keep-awake';

class NativeSpeechSynthesis {
  // Order matters: the plugin's `voice` speak option is an index into this
  // list (Android voices sorted by name inside the plugin).
  private voices: SpeechSynthesisVoice[] = [];
  private listeners = new Set<() => void>();
  private attemptsLeft = 20; // engine init takes ~1s; poll until voices show up

  constructor() {
    void this.poll();
  }

  private async poll() {
    try {
      const { voices } = await TextToSpeech.getSupportedVoices();
      if (voices.length > 0) {
        this.voices = voices;
        for (const fn of this.listeners) fn();
        return;
      }
    } catch {
      // engine not ready yet (or no engine at all) -- keep polling
    }
    if (this.attemptsLeft-- > 0) setTimeout(() => void this.poll(), 500);
  }

  getVoices(): SpeechSynthesisVoice[] {
    if (this.voices.length === 0 && this.attemptsLeft <= 0) {
      this.attemptsLeft = 4; // last-chance refresh, e.g. engine warmed up late
      void this.poll();
    }
    return this.voices;
  }

  speak(u: SpeechSynthesisUtterance) {
    if (!u.text) return; // warm-up utterance from unlock(); native needs none
    const idx = u.voice ? this.voices.findIndex((v) => v.name === u.voice!.name) : -1;
    void TextToSpeech.speak({
      text: u.text,
      lang: u.lang || 'zh-CN',
      rate: u.rate || 1,
      pitch: u.pitch || 1,
      volume: u.volume ?? 1,
      ...(idx >= 0 ? { voice: idx } : {}),
      queueStrategy: QueueStrategy.Flush, // plugin stops current speech first, like synth.cancel()
    }).catch((e) => console.warn('native tts speak failed', e));
  }

  cancel() {
    void TextToSpeech.stop().catch(() => undefined);
  }

  addEventListener(type: string, fn: () => void) {
    if (type === 'voiceschanged') this.listeners.add(fn);
  }

  removeEventListener(type: string, fn: () => void) {
    if (type === 'voiceschanged') this.listeners.delete(fn);
  }

  dispatchEvent(): boolean {
    return true;
  }

  pause() {}
  resume() {}
  get pending() {
    return false;
  }
  get speaking() {
    return false;
  }
  get paused() {
    return false;
  }
  onvoiceschanged = null;
  onstart = null;
  onend = null;
  onerror = null;
  onmark = null;
  onpause = null;
  onresume = null;
  onboundary = null;
}

class ShimUtterance extends EventTarget {
  text: string;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  volume = 1;
  rate = 1;
  pitch = 1;
  onstart = null;
  onend = null;
  onerror = null;
  onmark = null;
  onpause = null;
  onresume = null;
  onboundary = null;

  constructor(text = '') {
    super();
    this.text = text;
  }
}

export function installNativeShims() {
  if (!Capacitor.isNativePlatform()) return;
  const define = (obj: object, key: string, value: unknown) => {
    // defineProperty, not assignment: WebView exposes navigator.wakeLock as a
    // getter-only own property, so plain assignment throws a TypeError.
    Object.defineProperty(obj, key, { value, configurable: true, writable: true });
  };
  const w = window as unknown as Record<string, unknown>;
  define(w, 'speechSynthesis', new NativeSpeechSynthesis());
  define(w, 'SpeechSynthesisUtterance', ShimUtterance);
  // Screen Wake Lock is Chromium-browser-only; keep-awake uses an activity
  // window flag instead. WakeLockHolder's visibility re-acquire still works.
  define(navigator, 'wakeLock', {
    request: async () => {
      await KeepAwake.keepAwake();
      return {
        release: async () => {
          try {
            await KeepAwake.allowSleep();
          } catch {
            // already released
          }
        },
      };
    },
  });
}
