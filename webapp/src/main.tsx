import { Capacitor } from '@capacitor/core';
import { render } from 'react';
import './index.css';
import { App } from './app';

// Native shell (Capacitor): install the TTS / wake-lock shims before the app
// mounts so Speaker and Settings see window.speechSynthesis from the start.
const bootError = (e: unknown) => {
  console.error('boot failed', e);
  const el = document.getElementById('app');
  if (el && !el.childElementCount) {
    const box = document.createElement('pre');
    box.style.cssText = 'color:#f66;font:12px monospace;padding:16px;white-space:pre-wrap;';
    box.textContent = 'BOOT ERROR: ' + String((e as Error)?.stack ?? e);
    el.appendChild(box);
  }
};

const mount = () => {
  render(<App />, document.getElementById('app')!);
  (window as { __bootOk?: () => void }).__bootOk?.();
};

if (import.meta.env.MODE === 'native' || Capacitor.isNativePlatform()) {
  import('./native/native')
    .then((m) => m.installNativeShims())
    .then(mount)
    .catch(bootError);
} else {
  mount();
}
