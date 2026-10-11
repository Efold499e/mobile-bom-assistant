// Pure geometry for the board map and orientation words (plan section 7).
// Conventions (frozen here, every consumer must match):
// - Board coords: mm, origin = board top-left, y down (STJ canonical).
// - Angles: degrees, positive = clockwise AS SEEN ON SCREEN (y-down flips the
//   math sense; rotatePt sends +x (right) toward +y (down)).
// - calibDeg: the rotation applied to the on-screen map so its orientation
//   matches the physical board as the user sees it (calibration screen).
// - flip: how the board was turned over to reach the working face --
//   'lr' = mirrored across the vertical axis (左右翻), 'tb' = across the
//   horizontal axis (上下翻), 'none' = top face (no mirror). Bottom-face
//   placements live in top-view coords (STJ rule), so the working-face view
//   = mirror then rotate. Mirroring applies ONLY on the bottom view.

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  w: number;
  h: number;
}

export type Flip = 'none' | 'lr' | 'tb';

const NINE: readonly string[][] = [
  ['左上', '正上', '右上'],
  ['左中', '正中', '右中'],
  ['左下', '正下', '右下'],
];

/** Visual-clockwise rotation in a y-down frame. */
export function rotatePt(p: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Mirror a board point to the working face (bottom face seen flipped). */
export function mirrorPt(p: Pt, box: Box, flip: Flip): Pt {
  if (flip === 'lr') return { x: box.w - p.x, y: p.y };
  if (flip === 'tb') return { x: p.x, y: box.h - p.y };
  return p;
}

/** Board extents after rotation (w/h swap for odd multiples of 90°). */
export function rotatedExtents(box: Box, deg: number): Box {
  const corners = [
    { x: 0, y: 0 },
    { x: box.w, y: 0 },
    { x: box.w, y: box.h },
    { x: 0, y: box.h },
  ].map((p) => rotatePt(p, deg));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** View-frame position of a board point: mirror to the working face, rotate by
 * the calibration angle, normalize back into [0..w']×[0..h']. This is exactly
 * the transform the map canvas applies, so words and pixels can never drift. */
export function toViewFrame(p: Pt, box: Box, flip: Flip, deg: number): Pt {
  const d = normDeg(deg);
  const m = mirrorPt(p, box, flip);
  const r = rotatePt(m, d);
  const ext = rotatedExtents(box, d);
  const c0 = rotatePt({ x: box.w / 2, y: box.h / 2 }, d);
  return { x: r.x - c0.x + ext.w / 2, y: r.y - c0.y + ext.h / 2 };
}

export function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function band(v: number, span: number): 0 | 1 | 2 {
  if (v < span / 3) return 0;
  if (v < (2 * span) / 3) return 1;
  return 2;
}

/** Nine-grid word in the current view frame (thirds of the rotated extents). */
export function nineGridWord(p: Pt, ext: Box): string {
  return NINE[band(p.y, ext.h)][band(p.x, ext.w)];
}

/** User-frame nine-grid word for a board point under flip + calibration.
 * Before calibration exists the caller must not ask (plan section 7:
 * 宁可少说，不说错的). */
export function directionWord(p: Pt, box: Box, flip: Flip, deg: number): string {
  const d = normDeg(deg);
  const v = toViewFrame(p, box, flip, d);
  return nineGridWord(v, rotatedExtents(box, d));
}

export interface WithXY {
  x_mm: number;
  y_mm: number;
}

/** Nearest landmark to a board point (Euclidean, ties -> first in list).
 * Mirror/rotation preserve the argmin, so raw coords are enough here. */
export function nearestLandmark<L extends WithXY>(p: Pt, landmarks: L[]): L | null {
  let best: L | null = null;
  let bd = Infinity;
  for (const lm of landmarks) {
    const d = (lm.x_mm - p.x) ** 2 + (lm.y_mm - p.y) ** 2;
    if (d < bd) {
      bd = d;
      best = lm;
    }
  }
  return best;
}

/** OS content-rotation compensation (plan section 7, iOS where portrait lock
 * is unavailable): the user frame turns with the OS rotation, so the effective
 * calibration is the sum. Deterministic, no sensor involved. */
export function effectiveDeg(calibDeg: number, screenAngleDeg: number): number {
  return normDeg(calibDeg + screenAngleDeg);
}
