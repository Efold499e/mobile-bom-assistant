// STJ v1 validation -- TypeScript mirror of tools/validate_stj.py (M0).
// Rule source of truth: docs/stj-spec.md sections 1-9.
// Same error-code namespace as the Python validator for easy cross-reference.

import type { Side, StjTask, TaskStats } from './types';
import { STJ_FORMAT, STJ_VERSION } from './types';

export const KINDS = ['r', 'c', 'l', 'd', 'led', 'q', 'ic', 'conn', 'sw', 'mech', 'other'] as const;
export const SOURCES = ['kicad', 'jlc', 'ibom', 'hand'] as const;
const GID_RE = /^[A-Za-z0-9_-]+$/;

export interface Validation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  task: StjTask | null;
  stats: TaskStats | null;
}

const isNum = (v: unknown): v is number =>
  (typeof v === 'number' && Number.isFinite(v));
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
// At most 3 decimal places. Tolerant compare: a decimal-clean value like 8.05
// has v*1000 === 8050.000000000001 in IEEE754, so an exact check would reject
// legitimate coordinates (found on the first real-board import, M5).
const dec3 = (v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;

class Rep {
  errors: string[] = [];
  warnings: string[] = [];
  err(code: string, path: string, msg: string) {
    this.errors.push(`${code}: ${msg} (at ${path || '<root>'})`);
  }
  warn(code: string, path: string, msg: string) {
    this.warnings.push(`${code}: ${msg} (at ${path || '<root>'})`);
  }
}

const obj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function needNum(
  rep: Rep, o: Record<string, unknown>, key: string, path: string,
  opt: { min?: number; maxExcl?: number } = {},
): number | null {
  if (!(key in o)) {
    rep.err('E_MISSING', `${path}.${key}`, `missing required field '${key}'`);
    return null;
  }
  const v = o[key];
  if (!isNum(v)) {
    rep.err('E_TYPE', `${path}.${key}`, `'${key}' must be a finite number`);
    return null;
  }
  if (!dec3(v)) {
    rep.err('E_DECIMALS', `${path}.${key}`, `'${key}' has more than 3 decimal places`);
    return null;
  }
  if (opt.min !== undefined && v < opt.min) {
    rep.err('E_RANGE', `${path}.${key}`, `'${key}'=${v} below minimum ${opt.min}`);
  }
  if (opt.maxExcl !== undefined && v >= opt.maxExcl) {
    rep.err('E_RANGE', `${path}.${key}`, `'${key}'=${v} out of range [${opt.min ?? 0}, ${opt.maxExcl})`);
  }
  return v;
}

function needStr(
  rep: Rep, o: Record<string, unknown>, key: string, path: string,
): string | null {
  if (!(key in o)) {
    rep.err('E_MISSING', `${path}.${key}`, `missing required field '${key}'`);
    return null;
  }
  const v = o[key];
  if (typeof v !== 'string' || v === '') {
    rep.err('E_TYPE', `${path}.${key}`, `'${key}' must be a non-empty string`);
    return null;
  }
  return v;
}

function checkOutline(
  rep: Rep, outline: unknown, path: string,
): [number, number, number, number] | null {
  if (!Array.isArray(outline)) {
    rep.err('E_TYPE', path, 'outline must be an array of [x, y] points');
    return null;
  }
  if (outline.length < 3) {
    rep.err('E_OUTLINE', path, `outline needs >= 3 points, got ${outline.length}`);
    return null;
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const pt = outline[i];
    if (!Array.isArray(pt) || pt.length !== 2 || !pt.every(isNum)) {
      rep.err('E_TYPE', `${path}[${i}]`, 'expected [x_mm, y_mm] pair of finite numbers');
      return null;
    }
    if (!dec3(pt[0]) || !dec3(pt[1])) {
      rep.err('E_DECIMALS', `${path}[${i}]`, 'coordinate has more than 3 decimal places');
    }
    if (pt[0] < 0 || pt[1] < 0) {
      rep.err('E_RANGE', `${path}[${i}]`, 'outline coordinate must be >= 0');
    }
    xs.push(pt[0]);
    ys.push(pt[1]);
  }
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  if (Math.round(x0 * 1000) !== 0 || Math.round(y0 * 1000) !== 0) {
    rep.err('E_OUTLINE', path, `outline origin must be board top-left (min x=0, min y=0); got (${x0}, ${y0})`);
  }
  return [x0, y0, Math.max(...xs), Math.max(...ys)];
}

export function validateStj(data: unknown): Validation {
  const rep = new Rep();
  if (!obj(data)) {
    rep.err('E_JSON', '', 'top level must be an object');
    return { ok: false, errors: rep.errors, warnings: [], task: null, stats: null };
  }

  if (data['format'] !== STJ_FORMAT) {
    rep.err('E_FORMAT', 'format', `expected '${STJ_FORMAT}', got ${JSON.stringify(data['format'])}`);
  }
  if (!isInt(data['version']) || data['version'] !== STJ_VERSION) {
    rep.err('E_VERSION', 'version', `expected ${STJ_VERSION}, got ${JSON.stringify(data['version'])}`);
  }

  // meta
  let bbox: [number, number, number, number] | null = null;
  if (!('meta' in data)) {
    rep.err('E_MISSING', '', "missing required field 'meta'");
  } else if (obj(data['meta'])) {
    const meta = data['meta'];
    needStr(rep, meta, 'project', 'meta.project');
    const source = needStr(rep, meta, 'source', 'meta.source');
    if (source !== null && !(SOURCES as readonly string[]).includes(source)) {
      rep.err('E_ENUM', 'meta.source', `'${source}' not in ${[...SOURCES].sort().join('/')}`);
    }
    const created = needStr(rep, meta, 'created_at', 'meta.created_at');
    if (created !== null) {
      const dt = new Date(created);
      if (Number.isNaN(dt.getTime())) {
        rep.err('E_TYPE', 'meta.created_at', 'not a valid ISO 8601 timestamp');
      } else {
        // require an explicit timezone offset (spec section 2)
        const tzless = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(created);
        if (tzless) {
          rep.err('E_TYPE', 'meta.created_at', 'timestamp must carry a timezone offset (ISO 8601)');
        }
      }
    }
    if (!('board' in meta)) {
      rep.err('E_MISSING', 'meta', "missing required field 'board'");
    } else if (obj(meta['board'])) {
      const board = meta['board'];
      const w = needNum(rep, board, 'width_mm', 'meta.board.width_mm', { min: 0 });
      const h = needNum(rep, board, 'height_mm', 'meta.board.height_mm', { min: 0 });
      for (const [label, v] of [['width_mm', w], ['height_mm', h]] as const) {
        if (v !== null && v <= 0) {
          rep.err('E_RANGE', `meta.board.${label}`, `'${label}' must be > 0`);
        }
      }
      if (!('outline' in board)) {
        rep.err('E_MISSING', 'meta.board', "missing required field 'outline'");
      } else {
        bbox = checkOutline(rep, board['outline'], 'meta.board.outline');
      }
      if (bbox) {
        const [x0, y0, x1, y1] = bbox;
        if (w !== null && Math.round(w * 1000) !== Math.round((x1 - x0) * 1000)) {
          rep.err('E_RANGE', 'meta.board.width_mm', `width_mm=${w} does not match outline bbox width ${x1 - x0}`);
        }
        if (h !== null && Math.round(h * 1000) !== Math.round((y1 - y0) * 1000)) {
          rep.err('E_RANGE', 'meta.board.height_mm', `height_mm=${h} does not match outline bbox height ${y1 - y0}`);
        }
      }
    } else {
      rep.err('E_TYPE', 'meta.board', 'board must be an object');
    }

    if (!('landmarks' in meta)) {
      rep.err('E_MISSING', 'meta', "missing required field 'landmarks'");
    } else if (!Array.isArray(meta['landmarks'])) {
      rep.err('E_TYPE', 'meta.landmarks', 'landmarks must be an array');
    } else {
      const lms = meta['landmarks'];
      if (lms.length > 3) {
        rep.err('E_RANGE', 'meta.landmarks', `at most 3 landmarks allowed, got ${lms.length}`);
      }
      const seen = new Set<string>();
      for (let i = 0; i < lms.length; i++) {
        const lm = lms[i];
        const p = `meta.landmarks[${i}]`;
        if (!obj(lm)) {
          rep.err('E_TYPE', p, 'landmark must be an object');
          continue;
        }
        const ref = needStr(rep, lm, 'ref', `${p}.ref`);
        if (ref !== null) {
          if (seen.has(ref)) rep.err('E_DUP', `${p}.ref`, `duplicate landmark ref '${ref}'`);
          seen.add(ref);
        }
        needStr(rep, lm, 'speak', `${p}.speak`);
        const x = needNum(rep, lm, 'x_mm', `${p}.x_mm`, { min: 0 });
        const y = needNum(rep, lm, 'y_mm', `${p}.y_mm`, { min: 0 });
        if (bbox && x !== null && y !== null && !(x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3])) {
          rep.warn('W_LANDMARK', `${p}.x_mm/y_mm`, `landmark '${ref}' (${x}, ${y}) outside board bbox`);
        }
      }
    }
  } else {
    rep.err('E_TYPE', 'meta', 'meta must be an object');
  }

  // sides
  let sidesSet: Set<string> | null = null;
  if (!('sides' in data)) {
    rep.err('E_MISSING', '', "missing required field 'sides'");
  } else if (!Array.isArray(data['sides']) || data['sides'].length === 0) {
    rep.err('E_TYPE', 'sides', 'sides must be a non-empty array');
  } else {
    const sides = data['sides'];
    for (let i = 0; i < sides.length; i++) {
      if (sides[i] !== 'top' && sides[i] !== 'bottom') {
        rep.err('E_ENUM', `sides[${i}]`, `'${sides[i]}' not in top/bottom`);
      }
    }
    if (new Set(sides).size !== sides.length) {
      rep.err('E_DUP', 'sides', 'duplicate entries in sides');
    }
    if (sides.length === 2 && sides[0] === 'bottom' && sides[1] === 'top') {
      rep.err('E_ENUM', 'sides', "when both sides present, order must be ['top', 'bottom']");
    }
    sidesSet = new Set(sides.filter((s): s is Side => s === 'top' || s === 'bottom'));
  }

  // groups
  const gidIndex = new Map<string, number>();
  const groupPolarity = new Map<string, boolean>();
  if (!('groups' in data)) {
    rep.err('E_MISSING', '', "missing required field 'groups'");
  } else if (!Array.isArray(data['groups']) || data['groups'].length === 0) {
    rep.err('E_TYPE', 'groups', 'groups must be a non-empty array');
  } else {
    data['groups'].forEach((g, i) => {
      const p = `groups[${i}]`;
      if (!obj(g)) {
        rep.err('E_TYPE', p, 'group must be an object');
        return;
      }
      const gid = needStr(rep, g, 'gid', `${p}.gid`);
      if (gid !== null) {
        if (!GID_RE.test(gid)) rep.err('E_TYPE', `${p}.gid`, 'gid may only use [A-Za-z0-9_-]');
        if (gidIndex.has(gid)) rep.err('E_DUP', `${p}.gid`, `duplicate gid '${gid}'`);
        else gidIndex.set(gid, i);
      }
      const kind = needStr(rep, g, 'kind', `${p}.kind`);
      if (kind !== null && !(KINDS as readonly string[]).includes(kind)) {
        rep.err('E_ENUM', `${p}.kind`, `'${kind}' not in ${[...KINDS].join('/')}`);
      }
      needStr(rep, g, 'footprint', `${p}.footprint`);
      if (!('footprint_speak' in g)) {
        rep.warn('W_SPEAK', `${p}.footprint_speak`, 'missing; speaker will fall back to raw footprint');
      }
      needStr(rep, g, 'value', `${p}.value`);
      if (!('value_speak' in g)) {
        rep.warn('W_SPEAK', `${p}.value_speak`, 'missing; speaker will fall back to raw value');
      }
      if (!('polarity' in g)) {
        rep.err('E_MISSING', `${p}.polarity`, "missing required field 'polarity'");
      } else if (typeof g['polarity'] !== 'boolean') {
        rep.err('E_TYPE', `${p}.polarity`, 'polarity must be a strict boolean');
      } else if (gid !== null) {
        groupPolarity.set(gid, g['polarity']);
      }
      let qty: number | null = null;
      if (!('qty' in g)) {
        rep.err('E_MISSING', `${p}.qty`, "missing required field 'qty'");
      } else if (!isInt(g['qty'])) {
        rep.err('E_TYPE', `${p}.qty`, 'qty must be an integer');
      } else if (g['qty'] < 1) {
        rep.err('E_RANGE', `${p}.qty`, `qty must be >= 1, got ${g['qty']}`);
      } else {
        qty = g['qty'];
      }
      if (!('refdes' in g)) {
        rep.err('E_MISSING', `${p}.refdes`, "missing required field 'refdes'");
      } else if (!Array.isArray(g['refdes']) || g['refdes'].length === 0) {
        rep.err('E_TYPE', `${p}.refdes`, 'refdes must be a non-empty array');
      } else {
        const rd = g['refdes'];
        if (rd.some((r) => typeof r !== 'string' || r === '')) {
          rep.err('E_TYPE', `${p}.refdes`, 'refdes entries must be non-empty strings');
        }
        if (new Set(rd).size !== rd.length) {
          rep.err('E_DUP', `${p}.refdes`, 'duplicate refdes within group');
        }
        if (qty !== null && rd.length !== qty) {
          rep.err('E_QTY', `${p}.qty`, `qty=${qty} != len(refdes)=${rd.length}`);
        }
      }
    });
  }

  // placements
  const perGroup = new Map<string, string[]>();
  const sideUsed = new Set<string>();
  const pids = new Set<number>();
  const refs = new Set<string>();
  if (!('placements' in data)) {
    rep.err('E_MISSING', '', "missing required field 'placements'");
  } else if (!Array.isArray(data['placements']) || data['placements'].length === 0) {
    rep.err('E_TYPE', 'placements', 'placements must be a non-empty array');
  } else {
    data['placements'].forEach((p0, i) => {
      const p = `placements[${i}]`;
      if (!obj(p0)) {
        rep.err('E_TYPE', p, 'placement must be an object');
        return;
      }
      if (!('pid' in p0)) {
        rep.err('E_MISSING', `${p}.pid`, "missing required field 'pid'");
      } else if (!isInt(p0['pid']) || p0['pid'] < 0) {
        rep.err('E_TYPE', `${p}.pid`, 'pid must be an integer >= 0');
      } else {
        if (pids.has(p0['pid'])) rep.err('E_DUP', `${p}.pid`, `duplicate pid ${p0['pid']}`);
        pids.add(p0['pid']);
      }
      const gid = needStr(rep, p0, 'gid', `${p}.gid`);
      if (gid !== null) {
        if (!gidIndex.has(gid)) rep.err('E_DANGLING', `${p}.gid`, `placement references unknown gid '${gid}'`);
        const arr = perGroup.get(gid) ?? [];
        arr.push(typeof p0['ref'] === 'string' ? p0['ref'] : '');
        perGroup.set(gid, arr);
      }
      const ref = needStr(rep, p0, 'ref', `${p}.ref`);
      if (ref !== null) {
        if (refs.has(ref)) rep.err('E_DUP', `${p}.ref`, `duplicate ref '${ref}'`);
        refs.add(ref);
      }
      const side = needStr(rep, p0, 'side', `${p}.side`);
      if (side !== null) {
        if (side !== 'top' && side !== 'bottom') {
          rep.err('E_ENUM', `${p}.side`, `'${side}' not in top/bottom`);
        } else if (sidesSet && !sidesSet.has(side)) {
          rep.err('E_SIDES', `${p}.side`, `side '${side}' not declared in meta sides ${[...(sidesSet ?? [])].sort()}`);
        }
        sideUsed.add(side);
      }
      const x = needNum(rep, p0, 'x_mm', `${p}.x_mm`, { min: 0 });
      const y = needNum(rep, p0, 'y_mm', `${p}.y_mm`, { min: 0 });
      if (bbox && x !== null && y !== null) {
        const [x0, y0, x1, y1] = bbox;
        const over = Math.max(x0 - x, x - x1, y0 - y, y - y1);
        if (over > 0) {
          const where = `${typeof p0['ref'] === 'string' ? p0['ref'] : 'placement'} (${x}, ${y})`;
          if (over > 1.0) {
            rep.err('E_RANGE', `${p}.x_mm/y_mm`, `${where} outside board bbox by ${over}mm`);
          } else {
            rep.warn('W_EDGE', `${p}.x_mm/y_mm`, `${where} slightly outside board bbox by ${over}mm`);
          }
        }
      }
      needNum(rep, p0, 'rot_deg', `${p}.rot_deg`, { min: 0, maxExcl: 360 });
      if ('bbox_mm' in p0) {
        const bb = p0['bbox_mm'];
        if (!Array.isArray(bb) || bb.length !== 2 || !bb.every(isNum)) {
          rep.err('E_TYPE', `${p}.bbox_mm`, 'bbox_mm must be [w, h] finite numbers');
        } else {
          for (let j = 0; j < 2; j++) {
            if (bb[j] <= 0) rep.err('E_RANGE', `${p}.bbox_mm[${j}]`, 'bbox must be > 0');
            else if (!dec3(bb[j])) rep.err('E_DECIMALS', `${p}.bbox_mm[${j}]`, 'more than 3 decimal places');
          }
        }
      } else {
        rep.warn('W_BBOX', `${p}.bbox_mm`, 'missing; consumer falls back to footprint default table');
      }
      // incremental fields (spec appendix D): pads geometry + loc_speak hint
      if ('pads' in p0) {
        const pads = p0['pads'];
        if (!Array.isArray(pads)) {
          rep.err('E_TYPE', `${p}.pads`, 'pads must be an array');
        } else {
          pads.forEach((pd, j) => {
            const pp = `${p}.pads[${j}]`;
            if (!obj(pd)) {
              rep.err('E_TYPE', pp, 'pad must be an object');
              return;
            }
            for (const [key, lo] of [['x_mm', null], ['y_mm', null], ['w_mm', 0], ['h_mm', 0]] as const) {
              if (!(key in pd)) {
                rep.err('E_MISSING', `${pp}.${key}`, `missing required pad field '${key}'`);
              } else if (!isNum(pd[key])) {
                rep.err('E_TYPE', `${pp}.${key}`, `'${key}' must be a finite number`);
              } else {
                if (!dec3(pd[key])) rep.err('E_DECIMALS', `${pp}.${key}`, 'more than 3 decimal places');
                if (lo !== null && pd[key] <= 0) rep.err('E_RANGE', `${pp}.${key}`, 'pad size must be > 0');
              }
            }
            if ('shape' in pd && pd['shape'] !== 'rect' && pd['shape'] !== 'circle') {
              rep.err('E_ENUM', `${pp}.shape`, `'${pd['shape']}' not in rect/circle`);
            }
          });
        }
      }
      if ('loc_speak' in p0 && (typeof p0['loc_speak'] !== 'string' || p0['loc_speak'].length > 40)) {
        rep.err('E_TYPE', `${p}.loc_speak`, 'loc_speak must be a string of at most 40 chars');
      }
    });
    if (sidesSet && sideUsed.size > 0) {
      const a = [...sidesSet].sort();
      const b = [...sideUsed].sort();
      if (a.join() !== b.join()) {
        rep.err('E_SIDES', 'sides', `sides [${a}] != sides used by placements [${b}]`);
      }
    }
    // qty == placement count per group, and refdes set == placement refs
    if (Array.isArray(data['groups'])) {
      data['groups'].forEach((g, gi) => {
        if (!obj(g) || typeof g['gid'] !== 'string' || !isInt(g['qty'])) return;
        const gid = g['gid'];
        const got = perGroup.get(gid);
        const n = got ? got.length : 0;
        if (g['qty'] >= 1 && n !== g['qty']) {
          rep.err('E_QTY', `groups[${gi}].qty`, `group '${gid}' qty=${g['qty']} but has ${n} placements`);
        }
        if (Array.isArray(g['refdes']) && got) {
          const a = [...g['refdes']].map(String).sort().join();
          const b = got.map(String).sort().join();
          if (a !== b) {
            rep.err('E_QTY', `group '${gid}'`, "refdes set does not match the refs of this group's placements");
          }
        }
      });
    }
  }

  // group_order_default
  if (!('group_order_default' in data)) {
    rep.err('E_MISSING', '', "missing required field 'group_order_default'");
  } else if (!Array.isArray(data['group_order_default']) || data['group_order_default'].length === 0) {
    rep.err('E_TYPE', 'group_order_default', 'group_order_default must be a non-empty array');
  } else {
    const order = data['group_order_default'];
    if (order.some((g) => typeof g !== 'string')) {
      rep.err('E_TYPE', 'group_order_default', 'group_order_default entries must be strings');
    } else {
      for (const gid of order) {
        if (!gidIndex.has(gid)) rep.err('E_DANGLING', 'group_order_default', `unknown gid '${gid}' in group_order_default`);
      }
      if (order.length !== gidIndex.size || new Set(order).size !== order.length) {
        rep.err('E_QTY', 'group_order_default', 'group_order_default must be a permutation of all gids exactly once');
      }
    }
  }

  if (rep.errors.length > 0) {
    return { ok: false, errors: rep.errors, warnings: rep.warnings, task: null, stats: null };
  }
  const task = data as unknown as StjTask;
  const stats = computeStats(task);
  return { ok: true, errors: [], warnings: rep.warnings, task, stats };
}

export function computeStats(task: StjTask): TaskStats {
  const polarityByGid = new Map(task.groups.map((g) => [g.gid, g.polarity] as const));
  return {
    project: task.meta.project,
    source: task.meta.source,
    placements: task.placements.length,
    groups: task.groups.length,
    polarity: task.placements.filter((p) => polarityByGid.get(p.gid) === true).length,
    sides: task.sides.length,
    landmarks: task.meta.landmarks.length,
  };
}
