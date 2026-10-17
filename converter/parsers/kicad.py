# -*- coding: utf-8 -*-
"""KiCad .kicad_pcb (v6+) parser -- direct S-expression parsing, no kicad-cli.

Frame notes: KiCad file coordinates are mm, y points DOWN (screen convention),
rotation angles are CCW positive in top view -- identical to STJ canonical, so
only the origin rebase is needed, no flip and no rotation remap.
"""

import math
from pathlib import Path

from model import Part, TOP, BOTTOM

# ------------------------------------------------------------------ sexprs


def parse_sexpr(text: str):
    """Parse KiCad S-expressions into nested lists of strings."""
    tokens = _tokenize(text)
    pos = 0
    value, pos = _parse_expr(tokens, pos)
    return value


def _tokenize(text: str):
    tokens = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
        elif c == "(":
            tokens.append("(")
            i += 1
        elif c == ")":
            tokens.append(")")
            i += 1
        elif c == '"':
            j = i + 1
            buf = []
            while j < n:
                ch = text[j]
                if ch == "\\" and j + 1 < n:
                    buf.append(text[j + 1])
                    j += 2
                elif ch == '"':
                    break
                else:
                    buf.append(ch)
                    j += 1
            tokens.append(("str", "".join(buf)))
            i = j + 1
        else:
            j = i
            while j < n and text[j] not in ' \t\r\n()"':
                j += 1
            tokens.append(("sym", text[i:j]))
            i = j
    return tokens


def _parse_expr(tokens, pos):
    assert tokens[pos] == "(", f"expected ( at token {pos}"
    pos += 1
    out = []
    while tokens[pos] != ")":
        tok = tokens[pos]
        if tok == "(":
            sub, pos = _parse_expr(tokens, pos)
            out.append(sub)
        else:
            out.append(tok[1])
            pos += 1
    return out, pos + 1


# --------------------------------------------------------------- traversal


def _children(node, name):
    return [c for c in node if isinstance(c, list) and c and c[0] == name]


def _child(node, name):
    kids = _children(node, name)
    return kids[0] if kids else None


def _num(node, idx):
    try:
        return float(node[idx])
    except (TypeError, ValueError, IndexError):
        return 0.0


def _at(node):
    """(at x y [rot]) -> (x, y, rot)."""
    at = _child(node, "at")
    if at is None:
        return 0.0, 0.0, 0.0
    x = _num(at, 1)
    y = _num(at, 2)
    rot = _num(at, 3) if len(at) > 3 else 0.0
    return x, y, rot


def _prop(node, key):
    # KiCad 7/8: (property "Reference" "R1" ...) ; KiCad 5/6: (fp_text reference R1 ...)
    for p in _children(node, "property"):
        if len(p) > 2 and p[1] == key:
            return p[2]
    token = {"Reference": "reference", "Value": "value"}.get(key, key)
    for p in _children(node, "fp_text"):
        if len(p) > 2 and p[1] == token:
            return p[2]
    return ""


def _is_excluded_attr(fp_node):
    attr = _child(fp_node, "attr")
    if attr is None:
        return False
    return "board_only" in attr or "exclude_from_bom" in attr


# ------------------------------------------------------------ outline build


def _collect_edge_segments(tree):
    segs = []
    for name in ("gr_line", "gr_rect", "gr_arc"):
        for g in _children(tree, name):
            layer = _child(g, "layer")
            if not layer or layer[1] != "Edge.Cuts":
                continue
            if name == "gr_line":
                s, e = _child(g, "start"), _child(g, "end")
                segs.append((_num(s, 1), _num(s, 2), _num(e, 1), _num(e, 2)))
            elif name == "gr_rect":
                s, e = _child(g, "start"), _child(g, "end")
                x0, y0, x1, y1 = _num(s, 1), _num(s, 2), _num(e, 1), _num(e, 2)
                segs.extend([
                    (x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0),
                ])
            else:  # gr_arc: sample start->mid->end
                s, mid, e = _child(g, "start"), _child(g, "mid"), _child(g, "end")
                segs.extend(_sample_arc(
                    (_num(s, 1), _num(s, 2)), (_num(mid, 1), _num(mid, 2)),
                    (_num(e, 1), _num(e, 2)),
                ))
    return segs


def _sample_arc(start, mid, end, samples=16):
    """Approximate an arc through 3 points with a polyline."""
    (x1, y1), (x2, y2), (x3, y3) = start, mid, end
    d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
    if abs(d) < 1e-9:
        return [(x1, y1, x3, y3)]
    ux = ((x1**2 + y1**2) * (y2 - y3) + (x2**2 + y2**2) * (y3 - y1) + (x3**2 + y3**2) * (y1 - y2)) / d
    uy = ((x1**2 + y1**2) * (x3 - x2) + (x2**2 + y2**2) * (x1 - x3) + (x3**2 + y3**2) * (x2 - x1)) / d
    r = math.hypot(x1 - ux, y1 - uy)
    a1 = math.atan2(y1 - uy, x1 - ux)
    am = math.atan2(y2 - uy, x2 - ux)
    a3 = math.atan2(y3 - uy, x3 - ux)
    # choose the sweep direction that passes through mid
    def norm(a):
        return (a + 2 * math.pi) % (2 * math.pi)
    if norm(am - a1) < norm(a3 - a1):
        a_start, a_end = a1, a3
    else:
        a_start, a_end = a1, a3 - 2 * math.pi
    pts = [
        (ux + r * math.cos(a_start + (a_end - a_start) * i / samples),
         uy + r * math.sin(a_start + (a_end - a_start) * i / samples))
        for i in range(samples + 1)
    ]
    return [(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) for i in range(len(pts) - 1)]


def _largest_loop(segs, tol=0.02):
    """Chain segments into loops, return the polygon with the largest bbox area."""
    remaining = list(segs)
    loops = []
    while remaining:
        chain = [remaining.pop(0)]
        extended = True
        while extended:
            extended = False
            ex0, ey0 = chain[0][0], chain[0][1]
            ex1, ey1 = chain[-1][2], chain[-1][3]
            for i, s in enumerate(remaining):
                if math.hypot(s[0] - ex1, s[1] - ey1) < tol:
                    chain.append(s)
                    remaining.pop(i)
                    extended = True
                    break
                if math.hypot(s[2] - ex1, s[3] - ey1) < tol:
                    chain.append((s[2], s[3], s[0], s[1]))
                    remaining.pop(i)
                    extended = True
                    break
                if math.hypot(s[2] - ex0, s[3] - ey0) < tol:
                    chain.insert(0, (s[2], s[3], s[0], s[1]))
                    remaining.pop(i)
                    extended = True
                    break
                if math.hypot(s[0] - ex0, s[1] - ey0) < tol:
                    chain.insert(0, (s[0], s[1], s[2], s[3]))
                    remaining.pop(i)
                    extended = True
                    break
        loops.append(chain)
    best, best_area = None, -1.0
    for chain in loops:
        xs = [s[0] for s in chain] + [s[2] for s in chain]
        ys = [s[1] for s in chain] + [s[3] for s in chain]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if area > best_area:
            best_area = area
            poly = [[round(chain[0][0], 3), round(chain[0][1], 3)]]
            for s in chain:
                pt = [round(s[2], 3), round(s[3], 3)]
                if pt != poly[-1]:
                    poly.append(pt)
            if len(poly) > 1 and poly[0] == poly[-1]:
                poly.pop()
            best = poly
    return best


# --------------------------------------------------------------- footprints


def _footprint_bbox(fp_node, fx, fy, rot):
    """Axis-aligned bbox (w, h) from pad extents, rotation-aware."""
    rad = math.radians(rot)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    xs, ys = [], []
    for pad in _children(fp_node, "pad"):
        at = _child(pad, "at")
        size = _child(pad, "size")
        if at is None or size is None:
            continue
        px, py = _num(at, 1), _num(at, 2)
        if len(at) > 3:
            pr = math.radians(_num(at, 3))
            px, py = px * math.cos(pr) + py * math.sin(pr), -px * math.sin(pr) + py * math.cos(pr)
        # CCW in y-down screen frame: x' = x cos + y sin ; y' = -x sin + y cos
        wx = fx + px * cos_r + py * sin_r
        wy = fy - px * sin_r + py * cos_r
        w, h = _num(size, 1), _num(size, 2)
        k = abs(math.sin(rad))
        if k > 0.7:  # pad rotated ~90/270: swap extents
            w, h = h, w
        xs.extend([wx - w / 2, wx + w / 2])
        ys.extend([wy - h / 2, wy + h / 2])
    if not xs:
        return None
    return (round(max(xs) - min(xs), 3), round(max(ys) - min(ys), 3))


def _footprint_pads(fp_node):
    """Pad geometry in the footprint-LOCAL frame (placement rotation NOT
    applied -- the renderer rotates). Pad-level rotation is folded in by
    rotating the pad center and swapping w/h for ~90/270° pads. NPTH and
    mechanical pads are skipped."""
    pads = []
    for pad in _children(fp_node, "pad"):
        ptype = pad[2] if len(pad) > 2 else "smd"
        if ptype in ("np_thru_hole", "connect"):
            continue
        at = _child(pad, "at")
        size = _child(pad, "size")
        shape_node = _child(pad, "shape")
        if at is None or size is None:
            continue
        px, py = _num(at, 1), _num(at, 2)
        if len(at) > 3:
            pr = math.radians(_num(at, 3))
            px, py = px * math.cos(pr) + py * math.sin(pr), -px * math.sin(pr) + py * math.cos(pr)
            quarter = abs(math.sin(pr)) > 0.7
        else:
            quarter = False
        w, h = _num(size, 1), _num(size, 2)
        if quarter:
            w, h = h, w
        shape = (shape_node[1] if shape_node and len(shape_node) > 1 else "rect").lower()
        if shape in ("roundrect", "oval", "round") or ptype == "tht":
            # round/oval THT and roundrect SMD read best as circles/rounded at
            # render size; keep the two shapes the renderer knows
            shape = "circle" if shape in ("round", "circle") or ptype == "tht" else "rect"
        else:
            shape = "rect"
        pads.append({"x": px, "y": py, "w": w, "h": h, "shape": shape})
    return pads or None


def parse_kicad(text: str):
    """Parse .kicad_pcb text -> (parts, outline_src). y-down source frame."""
    tree = parse_sexpr(text)
    parts = []
    for fp in _children(tree, "footprint"):
        ref = _prop(fp, "Reference") or ""
        value = _prop(fp, "Value") or ""
        layer = _child(fp, "layer")
        side = BOTTOM if (layer and str(layer[1]).startswith("B")) else TOP
        fx, fy, rot = _at(fp)
        attr = _child(fp, "attr")
        mount = "tht" if (attr and "through_hole" in attr) else "smd"
        bbox = _footprint_bbox(fp, fx, fy, rot)
        parts.append(Part(
            ref=ref, value=value, footprint=fp[1] if len(fp) > 1 else "",
            side=side, x=fx, y=fy, rot=rot, bbox=bbox, mount=mount,
            excluded=_is_excluded_attr(fp),
            pads=_footprint_pads(fp),
        ))
    outline = _largest_loop(_collect_edge_segments(tree))
    return parts, outline


def parse_file(path: str):
    return parse_kicad(Path(path).read_text(encoding="utf-8"))
