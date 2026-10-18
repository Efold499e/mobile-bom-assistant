// STJ v1 types -- mirror of docs/stj-spec.md (frozen, tag m0-stj-v1-frozen).
// Keep field-for-field in sync with the spec; unknown fields are ignored
// (forward compatible) but the ones below are what the app consumes.

export const STJ_FORMAT = 'solder-task-json';
export const STJ_VERSION = 1;

export type Side = 'top' | 'bottom';

export type GroupKind =
  | 'r' | 'c' | 'l' | 'd' | 'led' | 'q'
  | 'ic' | 'conn' | 'sw' | 'mech' | 'other';

export interface Landmark {
  ref: string;
  speak: string;
  x_mm: number;
  y_mm: number;
}

export interface Board {
  width_mm: number;
  height_mm: number;
  outline: [number, number][];
}

export interface StjMeta {
  project: string;
  source: string;
  created_at: string;
  board: Board;
  landmarks: Landmark[];
}

export interface StjGroup {
  gid: string;
  kind: GroupKind;
  footprint: string;
  footprint_speak?: string;
  value: string;
  value_speak?: string;
  polarity: boolean;
  qty: number;
  refdes: string[];
}

/** Incremental field (spec appendix D): footprint pad geometry relative to
 * the placement center, in the placement's LOCAL frame (rot_deg applies at
 * render). Emitted by the KiCad/iBOM parsers; JLC CSV has no geometry. */
export interface StjPad {
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  shape: 'rect' | 'circle';
}

/** Incremental field (spec appendix D): silkscreen graphics of the part's own
 * face, local frame — the outline that makes a part recognisable (Gerber-ish
 * rendering). lines: [x1,y1,x2,y2]; circles: [cx,cy,r]. */
export interface StjSilk {
  lines: number[][];
  circles: number[][];
}

export interface StjPlacement {
  pid: number;
  gid: string;
  ref: string;
  side: Side;
  x_mm: number;
  y_mm: number;
  rot_deg: number;
  bbox_mm?: [number, number];
  pads?: StjPad[];
  silk?: StjSilk;
  /** Incremental field (spec appendix D): AI/baked spoken location hint,
   * precomputed at conversion time (e.g. 「MP8760 左下侧」). */
  loc_speak?: string;
}

export interface StjTask {
  format: string;
  version: number;
  meta: StjMeta;
  sides: Side[];
  groups: StjGroup[];
  placements: StjPlacement[];
  group_order_default: string[];
}

export interface TaskStats {
  project: string;
  source: string;
  placements: number;
  groups: number;
  polarity: number;
  sides: number;
  landmarks: number;
}
