// Hardware-ish helpers: vibration + screen wake lock.

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // no vibration (iOS desktop, etc.) -- visual feedback still applies
  }
}

type WakeLockLike = { release(): Promise<void> };

export class WakeLockHolder {
  private lock: WakeLockLike | null = null;
  private wanted = false;

  async acquire() {
    this.wanted = true;
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockLike> } }).wakeLock;
      if (wl) this.lock = await wl.request('screen');
    } catch {
      // denied / unsupported -- app still works, screen may sleep
    }
  }

  release() {
    this.wanted = false;
    void this.lock?.release().catch(() => undefined);
    this.lock = null;
  }

  /** Re-acquire when the page becomes visible again (plan section 5). */
  onVisibilityChange() {
    if (this.wanted && document.visibilityState === 'visible' && !this.lock) {
      void this.acquire();
    }
  }
}
