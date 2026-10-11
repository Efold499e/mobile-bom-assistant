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

export interface StjPlacement {
  pid: number;
  gid: string;
  ref: string;
  side: Side;
  x_mm: number;
  y_mm: number;
  rot_deg: number;
  bbox_mm?: [number, number];
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
