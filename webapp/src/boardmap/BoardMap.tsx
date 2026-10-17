// BoardMap: canvas placement map (plan section 5 + M3 scope).
//
// Power rules (M3 red line): the canvas is STATIC -- it only repaints when run
// state or the view actually changes (gesture input, unit change, resize).
// The current-point pulse is a DOM overlay animated in CSS, so nothing here
// runs a persistent requestAnimationFrame loop. The single exception is the
// ~320ms one-shot follow easing, which cancels itself when done.
//
// All geometry (mirror for the bottom face, calibration rotation, view-frame
// positions) comes from boardmap/geo.ts -- words and pixels share one transform.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Side, StjTask } from '../loader/types';
import type { UnitStatus } from '../runner/runner';
import { effectiveBbox } from '../loader/bbox-defaults';
import {
  normDeg,
  rotatedExtents,
  toViewFrame,
  type Flip,
  type Pt,
} from './geo';

export type MapMode = 'thumb' | 'full' | 'mini';

interface ViewPt {
  pid: number;
  gid: string;
  ref: string;
  side: Side;
  x: number; // view-frame mm
  y: number;
  bw: number; // unrotated bbox mm
  bh: number;
  pads?: { x_mm: number; y_mm: number; w_mm: number; h_mm: number; shape: string }[];
}

interface Geo {
  ext: { w: number; h: number }; // view-frame board extents
  outline: Pt[];
  pts: ViewPt[];
  landmarks: { ref: string; v: Pt }[];
}

interface View {
  cx: number; // view-frame mm at viewport center
  cy: number;
  s: number; // px per mm
}

const COL = {
  outline: '#8a94a0',
  boardFill: '#161c22',
  grid: '#222b34',
  pending: '#47525e',
  pendingStroke: '#6b7885',
  done: 'rgba(55, 200, 113, 0.45)',
  doneStroke: 'rgba(55, 200, 113, 0.8)',
  skip: '#8a94a0',
  batch: 'rgba(245, 166, 35, 0.55)',
  batchStroke: '#f5a623',
  other: 'rgba(138, 148, 160, 0.3)',
  landmark: '#f5a623',
  copper: '#c9a15f',
  copperStroke: '#8a6d3b',
  refText: '#9aa7b2',
};

export function BoardMap(props: {
  task: StjTask;
  statuses: Record<number, UnitStatus>;
  currentPid: number | null;
  viewSide: Side;
  calibDeg: number;
  flip: Flip;
  batchGids?: Set<string>;
  mode: MapMode;
  onTap?: () => void;
  onFollowChange?: (follow: boolean) => void;
}) {
  const { task, statuses, currentPid, viewSide, calibDeg, flip, mode } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ cx: 0, cy: 0, s: 1 });
  const followRef = useRef(true);
  const animRef = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mid: Pt; view: View } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const [sizeVer, setSizeVer] = useState(0);

  // ---- geometry: board frame -> view frame (mirror + rotation baked in) ----
  const geo = useMemo<Geo>(() => {
    const box = { w: task.meta.board.width_mm, h: task.meta.board.height_mm };
    const deg = normDeg(calibDeg);
    const outline = task.meta.board.outline.map(([x, y]) => toViewFrame({ x, y }, box, flip, deg));
    const gById = new Map(task.groups.map((g) => [g.gid, g] as const));
    const pts = task.placements.map((p) => {
      const v = toViewFrame({ x: p.x_mm, y: p.y_mm }, box, flip, deg);
      const bb = effectiveBbox(p.bbox_mm, gById.get(p.gid)?.footprint ?? '');
      return {
        pid: p.pid, gid: p.gid, ref: p.ref, side: p.side,
        x: v.x, y: v.y, bw: bb[0], bh: bb[1],
        pads: p.pads,
      };
    });
    const landmarks = task.meta.landmarks.map((lm) => ({
      ref: lm.ref,
      v: toViewFrame({ x: lm.x_mm, y: lm.y_mm }, box, flip, deg),
    }));
    return { ext: rotatedExtents(box, deg), outline, pts, landmarks };
  }, [task, flip, calibDeg]);
  const geoRef = useRef(geo);
  geoRef.current = geo;

  const clampView = (v: View): View => {
    const g = geoRef.current;
    const m = Math.max(g.ext.w, g.ext.h);
    return {
      s: v.s,
      cx: Math.min(Math.max(v.cx, -m), g.ext.w + m),
      cy: Math.min(Math.max(v.cy, -m), g.ext.h + m),
    };
  };

  // ---- painting (view-frame mm -> screen px) ----
  const draw = () => {
    const cont = containerRef.current;
    const canvas = canvasRef.current;
    if (!cont || !canvas) return;
    const cw = cont.clientWidth;
    const ch = cont.clientHeight;
    if (cw === 0 || ch === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pw = Math.round(cw * dpr);
    const ph = Math.round(ch * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const v = viewRef.current;
    const g = geoRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const k = dpr * v.s;
    ctx.setTransform(k, 0, 0, k, dpr * (cw / 2 - v.cx * v.s), dpr * (ch / 2 - v.cy * v.s));

    // board outline
    ctx.beginPath();
    g.outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = COL.boardFill;
    ctx.fill();
    ctx.lineWidth = 0.25;
    ctx.strokeStyle = COL.outline;
    ctx.stroke();

    // 5 mm reference grid (full/mini only) -- helps reading positions at a glance
    if (mode !== 'thumb') {
      ctx.fillStyle = COL.grid;
      for (let gx = 5; gx < g.ext.w; gx += 5) {
        for (let gy = 5; gy < g.ext.h; gy += 5) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // placements -- true scale everywhere: body rect (status colored), copper
    // pads on top when the source carries geometry, refdes labels when zoomed
    const thumb = mode === 'thumb';
    for (const p of g.pts) {
      const st: UnitStatus = statuses[p.pid] ?? 'pending';
      const other = p.side !== viewSide;
      const batch = !other && st === 'pending' && (props.batchGids?.has(p.gid) ?? false);
      ctx.save();
      ctx.translate(p.x, p.y);
      if (thumb) {
        // true scale; fall back to a small dot only when the part is sub-pixel
        const wpx = p.bw * v.s;
        const hpx = p.bh * v.s;
        const color =
          other ? COL.other
          : batch ? COL.batch
          : st === 'done' ? COL.doneStroke
          : st === 'skipped' ? COL.skip
          : p.pid === currentPid ? COL.batchStroke
          : COL.pendingStroke;
        ctx.fillStyle = color;
        if (Math.max(wpx, hpx) >= 2.2) {
          ctx.rotate((normDeg(calibDeg) * Math.PI) / 180);
          ctx.fillRect(-p.bw / 2, -p.bh / 2, p.bw, p.bh);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, 1.1 / v.s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        continue;
      }
      ctx.rotate((normDeg(calibDeg) * Math.PI) / 180);
      const hw = p.bw / 2;
      const hh = p.bh / 2;
      ctx.beginPath();
      if (other) {
        ctx.strokeStyle = COL.other;
        ctx.lineWidth = 0.12;
        ctx.strokeRect(-hw, -hh, p.bw, p.bh);
      } else if (st === 'skipped') {
        ctx.setLineDash([0.5, 0.35]);
        ctx.strokeStyle = COL.skip;
        ctx.lineWidth = 0.16;
        ctx.strokeRect(-hw, -hh, p.bw, p.bh);
        ctx.setLineDash([]);
      } else {
        const r = Math.min(0.18, hw / 3, hh / 3);
        ctx.roundRect?.(-hw, -hh, p.bw, p.bh, r);
        if (!ctx.roundRect) ctx.rect(-hw, -hh, p.bw, p.bh);
        ctx.fillStyle = st === 'done' ? COL.done : batch ? COL.batch : COL.pending;
        ctx.fill();
        ctx.strokeStyle = st === 'done' ? COL.doneStroke : batch ? COL.batchStroke : COL.pendingStroke;
        ctx.lineWidth = 0.12;
        ctx.stroke();
        // copper pads (only when the source knows the geometry)
        if (p.pads && v.s >= 2.5) {
          ctx.fillStyle = COL.copper;
          ctx.strokeStyle = COL.copperStroke;
          ctx.lineWidth = 0.04;
          for (const pd of p.pads) {
            ctx.beginPath();
            if (pd.shape === 'circle') {
              ctx.arc(pd.x_mm, pd.y_mm, pd.w_mm / 2, 0, Math.PI * 2);
            } else {
              const r2 = Math.min(0.1, pd.w_mm / 4, pd.h_mm / 4);
              ctx.roundRect?.(pd.x_mm - pd.w_mm / 2, pd.y_mm - pd.h_mm / 2, pd.w_mm, pd.h_mm, r2);
              if (!ctx.roundRect) ctx.rect(pd.x_mm - pd.w_mm / 2, pd.y_mm - pd.h_mm / 2, pd.w_mm, pd.h_mm);
            }
            ctx.fill();
            ctx.stroke();
          }
        }
      }
      ctx.restore();
      // refdes labels (unrotated screen space, zoomed-in full map only)
      if (mode === 'full' && !other && v.s >= 5 && st !== 'skipped') {
        ctx.fillStyle = COL.refText;
        ctx.font = '1.9px system-ui, sans-serif';
        ctx.fillText(p.ref, p.x + p.bw / 2 + 0.5, p.y + 0.7);
      }
    }

    // landmarks (mini/full only)
    if (mode !== 'thumb') {
      ctx.fillStyle = COL.landmark;
      ctx.strokeStyle = COL.landmark;
      ctx.lineWidth = 0.14;
      for (const lm of g.landmarks) {
        ctx.beginPath();
        ctx.rect(lm.v.x - 0.9, lm.v.y - 0.9, 1.8, 1.8);
        ctx.fill();
        ctx.font = '2.8px system-ui, sans-serif';
        ctx.fillText(lm.ref, lm.v.x + 1.4, lm.v.y - 1.2);
      }
    }

    // current-point DOM overlay position (screen px)
    const dot = dotRef.current;
    if (dot) {
      const cur = currentPid !== null ? g.pts.find((p) => p.pid === currentPid) : undefined;
      if (cur && mode !== 'mini' && cur.side === viewSide) {
        const sx = (cur.x - v.cx) * v.s + cw / 2;
        const sy = (cur.y - v.cy) * v.s + ch / 2;
        dot.style.display = 'block';
        dot.style.left = `${sx}px`;
        dot.style.top = `${sy}px`;
      } else {
        dot.style.display = 'none';
      }
    }
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // ---- view helpers ----
  const fitView = (): View => {
    const cont = containerRef.current;
    if (!cont) return { cx: 0, cy: 0, s: 1 };
    const g = geoRef.current;
    const s = Math.min(cont.clientWidth / g.ext.w, cont.clientHeight / g.ext.h) * 0.92;
    return { cx: g.ext.w / 2, cy: g.ext.h / 2, s };
  };
  const followTarget = (): View => {
    const cont = containerRef.current;
    const g = geoRef.current;
    const fit = fitView();
    if (!cont || currentPid === null) return fit;
    const cur = g.pts.find((p) => p.pid === currentPid);
    if (!cur) return fit;
    const s = Math.min(Math.max(fit.s * 2.4, fit.s), fit.s * 8);
    return clampView({ cx: cur.x, cy: cur.y, s });
  };

  // One-shot 320ms easing; self-cancelling, NOT a persistent animation loop.
  const animateTo = (target: View) => {
    const from = { ...viewRef.current };
    const t0 = performance.now();
    cancelAnimationFrame(animRef.current);
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 320);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      viewRef.current = {
        cx: from.cx + (target.cx - from.cx) * e,
        cy: from.cy + (target.cy - from.cy) * e,
        s: from.s * (target.s / from.s) ** e,
      };
      drawRef.current();
      if (k < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  };

  // refit when the geometry (side/flip/angle) or mode changes
  useEffect(() => {
    if (mode === 'full' && followRef.current) {
      viewRef.current = followTarget();
    } else if (mode !== 'full') {
      followRef.current = true;
      viewRef.current = fitView();
    }
    drawRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, mode]);

  // repaint on state changes
  useEffect(() => {
    drawRef.current();
  }, [statuses, props.batchGids, currentPid, viewSide, sizeVer]);

  // follow easing when the current unit changes (full mode only)
  const lastPid = useRef<number | null>(null);
  useEffect(() => {
    if (mode !== 'full') return;
    if (lastPid.current !== currentPid) {
      lastPid.current = currentPid;
      if (followRef.current) animateTo(followTarget());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPid, mode]);

  // resize: re-fit thumb/mini, redraw full
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return;
    const ro = new ResizeObserver(() => {
      if (mode !== 'full') viewRef.current = fitView();
      setSizeVer((x) => x + 1);
      drawRef.current();
    });
    ro.observe(cont);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  // ---- gestures (full mode only) ----
  const setFollow = (f: boolean) => {
    if (followRef.current !== f) {
      followRef.current = f;
      props.onFollowChange?.(f);
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (mode !== 'full') return;
    cancelAnimationFrame(animRef.current);
    const cont = containerRef.current!;
    cont.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view: { ...viewRef.current },
      };
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (mode !== 'full') return;
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cont = containerRef.current!;
    const cw = cont.clientWidth;
    const ch = cont.clientHeight;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p0 = pinch.current;
      if (p0.dist > 0) {
        const fit = fitView();
        const s = Math.min(Math.max((p0.view.s * dist) / p0.dist, fit.s * 0.7), fit.s * 10);
        // keep the board point that was under the original midpoint under the current one
        const wx = (p0.mid.x - cw / 2) / p0.view.s + p0.view.cx;
        const wy = (p0.mid.y - ch / 2) / p0.view.s + p0.view.cy;
        viewRef.current = clampView({
          cx: wx - (mid.x - cw / 2) / s,
          cy: wy - (mid.y - ch / 2) / s,
          s,
        });
        drawRef.current();
      }
    } else {
      const v = viewRef.current;
      viewRef.current = clampView({
        cx: v.cx - (e.clientX - prev.x) / v.s,
        cy: v.cy - (e.clientY - prev.y) / v.s,
        s: v.s,
      });
      setFollow(false);
      drawRef.current();
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (mode !== 'full') return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // double-tap -> back to the whole-board view and re-follow
    const now = Date.now();
    const lt = lastTap.current;
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    if (lt && now - lt.t < 300 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 24) {
      setFollow(true);
      animateTo(fitView());
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (mode !== 'full') return;
    e.preventDefault();
    cancelAnimationFrame(animRef.current);
    const cont = containerRef.current!;
    const rect = cont.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const v = viewRef.current;
    const fit = fitView();
    const s = Math.min(Math.max(v.s * Math.exp(-e.deltaY * 0.0015), fit.s * 0.7), fit.s * 10);
    const wx = (mx - cont.clientWidth / 2) / v.s + v.cx;
    const wy = (my - cont.clientHeight / 2) / v.s + v.cy;
    viewRef.current = clampView({
      cx: wx - (mx - cont.clientWidth / 2) / s,
      cy: wy - (my - cont.clientHeight / 2) / s,
      s,
    });
    setFollow(false);
    drawRef.current();
  };

  return (
    <div
      class={`boardmap boardmap-${mode}`}
      data-testid={`map-${mode}`}
      ref={containerRef}
      style={{ touchAction: mode === 'full' ? 'none' : 'auto' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onClick={mode === 'thumb' ? props.onTap : undefined}
      role={mode === 'thumb' ? 'button' : undefined}
    >
      <canvas class="boardmap-canvas" ref={canvasRef} />
      <div class="map-dot" ref={dotRef}>
        <span class="map-dot-core" />
      </div>
    </div>
  );
}
