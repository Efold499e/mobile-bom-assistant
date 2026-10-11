// Planner: expand a task into the weld queue.
// - Group order: consume group_order_default as-is (PC pre-computed pick order).
// - Inside a group: serpentine scan -- band placements by y (band height =
//   median effective bbox height * 1.5, gap-clustered), alternate x direction
//   per band so the iron walks the shortest path.
// Pure functions only.

import { effectiveBbox } from '../loader/bbox-defaults';
import type { StjPlacement, StjTask } from '../loader/types';

export interface QueueUnit {
  pid: number;
  gid: string;
  ref: string;
  side: 'top' | 'bottom';
  seq: number; // 1-based position in the whole queue
}

export function planQueue(task: StjTask): QueueUnit[] {
  const byGid = new Map<string, StjPlacement[]>();
  for (const p of task.placements) {
    const arr = byGid.get(p.gid) ?? [];
    arr.push(p);
    byGid.set(p.gid, arr);
  }
  const groupById = new Map(task.groups.map((g) => [g.gid, g] as const));

  const units: QueueUnit[] = [];
  let seq = 0;
  for (const gid of task.group_order_default) {
    const group = groupById.get(gid);
    const placements = byGid.get(gid);
    if (!group || !placements) continue; // validated upstream; defensive
    for (const p of snakeOrder(placements, group.footprint)) {
      seq += 1;
      units.push({ pid: p.pid, gid, ref: p.ref, side: p.side, seq });
    }
  }
  return units;
}

export function snakeOrder(placements: StjPlacement[], footprint: string): StjPlacement[] {
  const withH = placements.map((p) => ({
    p,
    h: effectiveBbox(p.bbox_mm, footprint)[1],
  }));

  // band height = median bbox height * 1.5 (plan section 8)
  const hs = withH.map((x) => x.h).sort((a, b) => a - b);
  const median = hs.length > 0 ? hs[Math.floor(hs.length / 2)] : 1.0;
  const bandH = median * 1.5;

  // gap-cluster by y: new band when y is more than bandH below the band's first y
  const sorted = [...withH].sort((a, b) => a.p.y_mm - b.p.y_mm || a.p.x_mm - b.p.x_mm);
  let band = 0;
  let bandStartY = sorted.length > 0 ? sorted[0].p.y_mm : 0;
  const banded = sorted.map((item) => {
    if (item.p.y_mm - bandStartY > bandH) {
      band += 1;
      bandStartY = item.p.y_mm;
    }
    return { ...item, band };
  });

  const result: StjPlacement[] = [];
  const bands = [...new Set(banded.map((b) => b.band))].sort((a, b) => a - b);
  for (const b of bands) {
    const inBand = banded.filter((x) => x.band === b);
    inBand.sort((a, b2) => (b % 2 === 0 ? a.p.x_mm - b2.p.x_mm : b2.p.x_mm - a.p.x_mm));
    for (const x of inBand) result.push(x.p);
  }
  return result;
}
