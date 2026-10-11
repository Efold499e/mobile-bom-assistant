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

/** Android: lock portrait for the weld loop (plan section 7). Best effort --
 * iOS Safari and desktop reject or ignore it. */
export async function lockPortrait(): Promise<void> {
  try {
    const o = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    await o?.lock?.('portrait');
  } catch {
    // unsupported / denied -- the app still works, rotation compensation kicks in
  }
}

/** OS-reported content rotation (0/90/180/270). Feeds effectiveDeg() to
 * compensate the user frame where the portrait lock above fails (iOS). */
export function screenAngleDeg(): number {
  try {
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
      return screen.orientation.angle;
    }
  } catch {
    // fall through
  }
  return (window as unknown as { orientation?: number }).orientation ?? 0;
}
