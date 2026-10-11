#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""STJ (solder-task-json) v1 validator -- Python stdlib only.

Spec: docs/stj-spec.md (frozen at M0, tag m0-stj-v1-frozen).
Exit codes: 0 = valid (warnings allowed), 1 = invalid, 2 = usage/IO error.
Output is pure ASCII for grep-friendly archiving.
"""

import argparse
import datetime
import json
import math
import sys

FORMAT_ID = "solder-task-json"
VERSION = 1
KINDS = {"r", "c", "l", "d", "led", "q", "ic", "conn", "sw", "mech", "other"}
SOURCES = {"kicad", "jlc", "ibom", "hand"}
SIDES = ("top", "bottom")
MAX_LANDMARKS = 3
MAX_DECIMALS = 3
EDGE_TOL_MM = 1.0  # placement center may sit outside the outline bbox by up to this (warn, not error)

GID_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, code, path, msg):
        self.errors.append(f"ERROR {code}: {msg} (at {path or '<root>'})")

    def warn(self, code, path, msg):
        self.warnings.append(f"WARN {code}: {msg} (at {path or '<root>'})")


def is_num(v):
    return type(v) in (int, float) and math.isfinite(v)


def decimals_ok(v):
    return round(float(v), MAX_DECIMALS) == float(v)


def need_object(rep, v, path):
    if not isinstance(v, dict):
        rep.error("E_TYPE", path, "expected object")
        return False
    return True


def need_num(rep, obj, key, path, *, minimum=None, maximum=None):
    """Validate obj[key] as a finite number with <=3 decimals. Returns float or None."""
    if key not in obj:
        rep.error("E_MISSING", path, f"missing required field '{key}'")
        return None
    v = obj[key]
    if not is_num(v):
        rep.error("E_TYPE", path, f"'{key}' must be a finite number")
        return None
    if not decimals_ok(v):
        rep.error("E_DECIMALS", path, f"'{key}' has more than {MAX_DECIMALS} decimal places")
        return None
    f = float(v)
    if minimum is not None and f < minimum:
        rep.error("E_RANGE", path, f"'{key}'={f} below minimum {minimum}")
    if maximum is not None and f >= maximum:
        rep.error("E_RANGE", path, f"'{key}'={f} out of range [{minimum}, {maximum})")
    return f


def need_str(rep, obj, key, path, *, allow_empty=False):
    if key not in obj:
        rep.error("E_MISSING", path, f"missing required field '{key}'")
        return None
    v = obj[key]
    if not isinstance(v, str) or (not allow_empty and v == ""):
        rep.error("E_TYPE", path, f"'{key}' must be a non-empty string")
        return None
    return v


def check_outline(rep, outline, path):
    """Returns (x0, y0, x1, y1) bbox of the outline, or None if unusable."""
    if not isinstance(outline, list):
        rep.error("E_TYPE", path, "outline must be an array of [x_mm, y_mm] points")
        return None
    if len(outline) < 3:
        rep.error("E_OUTLINE", path, f"outline needs >= 3 points, got {len(outline)}")
        return None
    xs, ys = [], []
    for i, pt in enumerate(outline):
        ppath = f"{path}[{i}]"
        if not isinstance(pt, list) or len(pt) != 2 or not all(is_num(n) for n in pt):
            rep.error("E_TYPE", ppath, "expected [x_mm, y_mm] pair of finite numbers")
            return None
        for j, n in enumerate(pt):
            if not decimals_ok(n):
                rep.error("E_DECIMALS", ppath, "coordinate has more than 3 decimal places")
            if n < 0:
                rep.error("E_RANGE", ppath, "outline coordinate must be >= 0")
        xs.append(float(pt[0]))
        ys.append(float(pt[1]))
    x0, y0 = min(xs), min(ys)
    if round(x0, MAX_DECIMALS) != 0 or round(y0, MAX_DECIMALS) != 0:
        rep.error("E_OUTLINE", path,
                  f"outline origin must be board top-left (min x = 0, min y = 0); got ({x0}, {y0})")
    return (x0, y0, max(xs), max(ys))


def check_meta(rep, meta):
    path = "meta"
    if not need_object(rep, meta, path):
        return None
    need_str(rep, meta, "project", f"{path}.project")
    source = need_str(rep, meta, "source", f"{path}.source")
    if source is not None and source not in SOURCES:
        rep.error("E_ENUM", f"{path}.source",
                  f"'{source}' not in {sorted(SOURCES)}")
    created = need_str(rep, meta, "created_at", f"{path}.created_at")
    if created is not None:
        try:
            datetime.datetime.fromisoformat(created)
        except ValueError:
            rep.error("E_TYPE", f"{path}.created_at", "not a valid ISO 8601 timestamp")

    bbox = None
    if "board" not in meta:
        rep.error("E_MISSING", path, "missing required field 'board'")
    elif need_object(rep, meta["board"], f"{path}.board"):
        board = meta["board"]
        bpath = f"{path}.board"
        w = need_num(rep, board, "width_mm", f"{bpath}.width_mm", minimum=0)
        h = need_num(rep, board, "height_mm", f"{bpath}.height_mm", minimum=0)
        if "outline" not in board:
            rep.error("E_MISSING", bpath, "missing required field 'outline'")
        else:
            bbox = check_outline(rep, board["outline"], f"{bpath}.outline")
        if bbox is not None:
            x0, y0, x1, y1 = bbox
            if w is not None and round(w, MAX_DECIMALS) != round(x1 - x0, MAX_DECIMALS):
                rep.error("E_RANGE", f"{bpath}.width_mm",
                          f"width_mm={w} does not match outline bbox width {round(x1 - x0, MAX_DECIMALS)}")
            if h is not None and round(h, MAX_DECIMALS) != round(y1 - y0, MAX_DECIMALS):
                rep.error("E_RANGE", f"{bpath}.height_mm",
                          f"height_mm={h} does not match outline bbox height {round(y1 - y0, MAX_DECIMALS)}")

    if "landmarks" not in meta:
        rep.error("E_MISSING", path, "missing required field 'landmarks'")
    elif not isinstance(meta["landmarks"], list):
        rep.error("E_TYPE", f"{path}.landmarks", "landmarks must be an array")
    else:
        if len(meta["landmarks"]) > MAX_LANDMARKS:
            rep.error("E_RANGE", f"{path}.landmarks",
                      f"at most {MAX_LANDMARKS} landmarks allowed, got {len(meta['landmarks'])}")
        seen_refs = set()
        for i, lm in enumerate(meta["landmarks"]):
            lpath = f"{path}.landmarks[{i}]"
            if not need_object(rep, lm, lpath):
                continue
            ref = need_str(rep, lm, "ref", f"{lpath}.ref")
            if ref is not None:
                if ref in seen_refs:
                    rep.error("E_DUP", f"{lpath}.ref", f"duplicate landmark ref '{ref}'")
                seen_refs.add(ref)
            need_str(rep, lm, "speak", f"{lpath}.speak")
            need_num(rep, lm, "x_mm", f"{lpath}.x_mm")
            need_num(rep, lm, "y_mm", f"{lpath}.y_mm")
    return bbox


def check_sides(rep, data):
    if "sides" not in data:
        rep.error("E_MISSING", "", "missing required field 'sides'")
        return None
    sides = data["sides"]
    path = "sides"
    if not isinstance(sides, list) or not sides:
        rep.error("E_TYPE", path, "sides must be a non-empty array")
        return None
    for i, s in enumerate(sides):
        if s not in SIDES:
            rep.error("E_ENUM", f"{path}[{i}]", f"'{s}' not in {list(SIDES)}")
    if len(set(map(str, sides))) != len(sides):
        rep.error("E_DUP", path, "duplicate entries in sides")
    if sides and list(map(str, sides)) == ["bottom", "top"]:
        rep.error("E_ENUM", path, "when both sides present, order must be ['top', 'bottom']")
    return set(s for s in sides if s in SIDES)


def check_groups(rep, data):
    if "groups" not in data:
        rep.error("E_MISSING", "", "missing required field 'groups'")
        return None
    groups = data["groups"]
    if not isinstance(groups, list) or not groups:
        rep.error("E_TYPE", "groups", "groups must be a non-empty array")
        return None
    gids = {}
    for i, g in enumerate(groups):
        gpath = f"groups[{i}]"
        if not need_object(rep, g, gpath):
            continue
        gid = need_str(rep, g, "gid", f"{gpath}.gid")
        if gid is not None:
            if not set(gid) <= GID_CHARS:
                rep.error("E_TYPE", f"{gpath}.gid",
                          "gid may only use [A-Za-z0-9_-]")
            if gid in gids:
                rep.error("E_DUP", f"{gpath}.gid", f"duplicate gid '{gid}'")
            gids[gid] = i
        kind = need_str(rep, g, "kind", f"{gpath}.kind")
        if kind is not None and kind not in KINDS:
            rep.error("E_ENUM", f"{gpath}.kind", f"'{kind}' not in {sorted(KINDS)}")
        need_str(rep, g, "footprint", f"{gpath}.footprint")
        if "footprint_speak" not in g:
            rep.warn("W_SPEAK", f"{gpath}.footprint_speak",
                     "missing; speaker will fall back to raw footprint")
        need_str(rep, g, "value", f"{gpath}.value")
        if "value_speak" not in g:
            rep.warn("W_SPEAK", f"{gpath}.value_speak",
                     "missing; speaker will fall back to raw value")
        if "polarity" not in g:
            rep.error("E_MISSING", f"{gpath}.polarity", "missing required field 'polarity'")
        elif type(g["polarity"]) is not bool:
            rep.error("E_TYPE", f"{gpath}.polarity", "polarity must be a strict boolean")
        qty = None
        if "qty" not in g:
            rep.error("E_MISSING", f"{gpath}.qty", "missing required field 'qty'")
        elif type(g["qty"]) is not int or g["qty"] < 1:
            rep.error("E_TYPE", f"{gpath}.qty", "qty must be an integer >= 1")
        else:
            qty = g["qty"]
        refdes = None
        if "refdes" not in g:
            rep.error("E_MISSING", f"{gpath}.refdes", "missing required field 'refdes'")
        elif not isinstance(g["refdes"], list) or not g["refdes"]:
            rep.error("E_TYPE", f"{gpath}.refdes", "refdes must be a non-empty array")
        else:
            refdes = g["refdes"]
            if any(not isinstance(r, str) or r == "" for r in refdes):
                rep.error("E_TYPE", f"{gpath}.refdes", "refdes entries must be non-empty strings")
            if len(set(map(str, refdes))) != len(refdes):
                rep.error("E_DUP", f"{gpath}.refdes", "duplicate refdes within group")
            if qty is not None and len(refdes) != qty:
                rep.error("E_QTY", f"{gpath}.qty",
                          f"qty={qty} != len(refdes)={len(refdes)}")
    return gids


def check_placements(rep, data, gids, sides_set, board_bbox):
    if "placements" not in data:
        rep.error("E_MISSING", "", "missing required field 'placements'")
        return
    placements = data["placements"]
    if not isinstance(placements, list) or not placements:
        rep.error("E_TYPE", "placements", "placements must be a non-empty array")
        return
    pids = set()
    refs = set()
    per_group = {}   # gid -> list of refs
    side_used = set()
    for i, p in enumerate(placements):
        ppath = f"placements[{i}]"
        if not need_object(rep, p, ppath):
            continue
        pid = None
        if "pid" not in p:
            rep.error("E_MISSING", f"{ppath}.pid", "missing required field 'pid'")
        elif type(p["pid"]) is not int or p["pid"] < 0:
            rep.error("E_TYPE", f"{ppath}.pid", "pid must be an integer >= 0")
        else:
            pid = p["pid"]
            if pid in pids:
                rep.error("E_DUP", f"{ppath}.pid", f"duplicate pid {pid}")
            pids.add(pid)
        gid = need_str(rep, p, "gid", f"{ppath}.gid")
        if gid is not None:
            if gids is not None and gid not in gids:
                rep.error("E_DANGLING", f"{ppath}.gid",
                          f"placement references unknown gid '{gid}'")
            per_group.setdefault(gid, []).append(p.get("ref"))
        ref = need_str(rep, p, "ref", f"{ppath}.ref")
        if ref is not None:
            if ref in refs:
                rep.error("E_DUP", f"{ppath}.ref", f"duplicate ref '{ref}'")
            refs.add(ref)
        side = need_str(rep, p, "side", f"{ppath}.side")
        if side is not None:
            if side not in SIDES:
                rep.error("E_ENUM", f"{ppath}.side", f"'{side}' not in {list(SIDES)}")
            elif sides_set is not None and side not in sides_set:
                rep.error("E_SIDES", f"{ppath}.side",
                          f"side '{side}' not declared in meta sides {sorted(sides_set)}")
            side_used.add(side)
        x = need_num(rep, p, "x_mm", f"{ppath}.x_mm")
        y = need_num(rep, p, "y_mm", f"{ppath}.y_mm")
        if board_bbox is not None and x is not None and y is not None:
            x0, y0, x1, y1 = board_bbox
            over = max(x0 - x, x - x1, y0 - y, y - y1)
            if over > 0:
                where = f"{p.get('ref', 'placement')} ({x}, {y})"
                if over > EDGE_TOL_MM:
                    rep.error("E_RANGE", f"{ppath}.x_mm/y_mm",
                              f"{where} outside board bbox by {round(over, 3)}mm")
                else:
                    rep.warn("W_EDGE", f"{ppath}.x_mm/y_mm",
                             f"{where} slightly outside board bbox by {round(over, 3)}mm")
        need_num(rep, p, "rot_deg", f"{ppath}.rot_deg", minimum=0, maximum=360)
        if "bbox_mm" in p:
            bb = p["bbox_mm"]
            if not isinstance(bb, list) or len(bb) != 2 or not all(is_num(n) for n in bb):
                rep.error("E_TYPE", f"{ppath}.bbox_mm", "bbox_mm must be [w, h] finite numbers")
            else:
                for j, n in enumerate(bb):
                    if n <= 0:
                        rep.error("E_RANGE", f"{ppath}.bbox_mm[{j}]", "bbox must be > 0")
                    elif not decimals_ok(n):
                        rep.error("E_DECIMALS", f"{ppath}.bbox_mm[{j}]",
                                  "more than 3 decimal places")
        elif pid is not None:
            rep.warn("W_BBOX", f"{ppath}.bbox_mm", "missing; consumer falls back to footprint default table")
    if sides_set is not None and side_used and side_used != sides_set:
        rep.error("E_SIDES", "sides",
                  f"sides {sorted(sides_set)} != sides used by placements {sorted(side_used)}")
    # per-group qty consistency (count side)
    if "groups" in data and isinstance(data["groups"], list):
        for g in data["groups"]:
            if not isinstance(g, dict) or "gid" not in g or "qty" not in g:
                continue
            gid = g["gid"]
            got = per_group.get(gid)
            n = len(got) if got is not None else 0
            if type(g["qty"]) is int and g["qty"] >= 1 and n != g["qty"]:
                rep.error("E_QTY", f"groups[{gids[gid]}].qty" if gids is not None and gid in gids else f"groups[?].{gid}",
                          f"group '{gid}' qty={g['qty']} but has {n} placements")
            refdes = g.get("refdes")
            if isinstance(refdes, list) and got is not None:
                if set(map(str, refdes)) != set(map(str, got)):
                    rep.error("E_QTY", f"group '{gid}'",
                              "refdes set does not match the refs of this group's placements")


def check_group_order(rep, data, gids):
    if "group_order_default" not in data:
        rep.error("E_MISSING", "", "missing required field 'group_order_default'")
        return
    order = data["group_order_default"]
    path = "group_order_default"
    if not isinstance(order, list) or not order:
        rep.error("E_TYPE", path, "group_order_default must be a non-empty array")
        return
    if any(not isinstance(x, str) for x in order):
        rep.error("E_TYPE", path, "group_order_default entries must be strings")
        return
    if gids is not None:
        for x in order:
            if x not in gids:
                rep.error("E_DANGLING", path, f"unknown gid '{x}' in group_order_default")
        if len(order) != len(gids) or set(order) != set(gids):
            rep.error("E_QTY", path,
                      "group_order_default must be a permutation of all gids exactly once")


def validate_data(data, rep):
    if not isinstance(data, dict):
        rep.error("E_JSON", "", "top level must be an object")
        return None, None, None
    fmt = data.get("format")
    if fmt != FORMAT_ID:
        rep.error("E_FORMAT", "format", f"expected '{FORMAT_ID}', got {fmt!r}")
    ver = data.get("version")
    if type(ver) is not int or ver != VERSION:
        rep.error("E_VERSION", "version", f"expected {VERSION}, got {ver!r}")

    bbox = None
    if "meta" not in data:
        rep.error("E_MISSING", "", "missing required field 'meta'")
    elif need_object(rep, data["meta"], "meta"):
        bbox = check_meta(rep, data["meta"])
    sides_set = check_sides(rep, data)
    gids = check_groups(rep, data)
    check_placements(rep, data, gids, sides_set, bbox)
    check_group_order(rep, data, gids)
    return bbox, sides_set, gids


def compute_stats(data):
    placements = data.get("placements") or []
    groups = data.get("groups") or []
    polarity_by_gid = {g.get("gid"): bool(g.get("polarity")) for g in groups if isinstance(g, dict)}
    n_polarity = sum(1 for p in placements
                     if isinstance(p, dict) and polarity_by_gid.get(p.get("gid"), False))
    n_sides = len(data.get("sides") or [])
    n_landmarks = len(((data.get("meta") or {}).get("landmarks")) or [])
    return (len(placements), len(groups), n_polarity, n_sides, n_landmarks)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Validate a solder-task-json (STJ) v1 file.")
    ap.add_argument("file", help="path to the .stj.json file")
    args = ap.parse_args(argv)

    try:
        with open(args.file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except OSError as e:
        print(f"Cannot read {args.file}: {e}")
        return 2
    except json.JSONDecodeError as e:
        print(f"[FAIL] {args.file}")
        print(f"ERROR E_JSON: not valid JSON: {e}")
        return 1

    rep = Report()
    validate_data(data, rep)

    if rep.errors:
        print(f"[FAIL] {args.file}")
        for line in rep.errors:
            print(line)
        return 1

    project = (data.get("meta") or {}).get("project", "?")
    source = (data.get("meta") or {}).get("source", "?")
    p, g, k, s, l = compute_stats(data)
    print(f"[OK] {FORMAT_ID} v{VERSION}: {project} (source={source})")
    for line in rep.warnings:
        print(line)
    print(f"STATS placements={p} groups={g} polarity={k} sides={s} landmarks={l}")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
