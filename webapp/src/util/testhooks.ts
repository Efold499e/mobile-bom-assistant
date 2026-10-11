// Automation seams: every announcement / feedback blip mirrors its count and
// last text onto <body> data attributes so browser-UI acceptance runs can
// assert them (the acceptance browser cannot read JS state, only the DOM).
// Two attribute writes per announcement; no visual or behavioral effect.

export function recordSay(text: string): void {
  if (typeof document === 'undefined') return;
  const b = document.body;
  if (!b) return;
  const n = Number(b.getAttribute('data-say-count') ?? 0) + 1;
  b.setAttribute('data-say-count', String(n));
  b.setAttribute('data-say-last', text);
}

export function recordBeep(): void {
  if (typeof document === 'undefined') return;
  const b = document.body;
  if (!b) return;
  const n = Number(b.getAttribute('data-beep-count') ?? 0) + 1;
  b.setAttribute('data-beep-count', String(n));
}
