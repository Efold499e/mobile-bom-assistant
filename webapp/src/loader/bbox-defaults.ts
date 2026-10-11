// Default bbox sizes when a placement omits bbox_mm.
// Source of truth: docs/stj-spec.md appendix C (frozen). Keep in sync.
// Consumer-side lookup is case-insensitive exact match; misses fall back to 1.0 x 1.0.

export const BBOX_DEFAULTS: Record<string, [number, number]> = {
  '0402': [1.0, 0.5],
  '0603': [1.6, 0.8],
  '0805': [2.0, 1.25],
  '1206': [3.2, 1.6],
  '1210': [3.2, 2.5],
  'sod-123': [3.7, 1.6],
  'sot-23': [2.9, 2.4],
  'sot-23-5': [2.9, 1.6],
  'sot-223': [6.5, 3.5],
  'soic-8': [4.9, 3.9],
  'soic-16': [4.9, 6.4],
};

export const BBOX_FALLBACK: [number, number] = [1.0, 1.0];

export function effectiveBbox(
  bbox_mm: [number, number] | undefined,
  footprint: string,
): [number, number] {
  if (bbox_mm) return bbox_mm;
  return BBOX_DEFAULTS[footprint.trim().toLowerCase()] ?? BBOX_FALLBACK;
}
