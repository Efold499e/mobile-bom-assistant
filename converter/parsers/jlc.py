# -*- coding: utf-8 -*-
"""JLC (嘉立创) BOM + placement CSV parser.

The two files come separately: the placement/coordinates CSV via the CLI input
argument, the BOM CSV via -b. Headers vary between the standard and
professional exports -- sniffed through alias lists.

Frame notes: JLC coordinates are mm, LEFT-BOTTOM origin, y points UP. Canonical
(STJ) is top-left origin, y DOWN, so y' = padded_top - y and x' = x - padded_left.
Rotations: top parts negated (y-up CCW becomes y-down CW); bottom parts get
(180 - rot), matching the JLC->KiCad convention -- the position itself is
NEVER mirrored (bottom parts stay in top-view coordinates, spec iron rule).
"""

import csv
from pathlib import Path

from model import Part, TOP, BOTTOM

_HEADER_ALIASES = {
    "ref": {"designator", "位号", "坐标点号", "零件编号"},
    "value": {"comment", "value", "评论", "注释", "数值"},
    "footprint": {"footprint", "封装"},
    "x": {"top x", "mid x", "x", "top x(mm)", "面内x"},
    "y": {"top y", "mid y", "y", "top y(mm)", "面内y"},
    "rot": {"rotation", "rot", "旋转", "rotation(°)"},
    "layer": {"layer", "side", "层", "打件面"},
}
_BOM_ALIASES = {
    "ref": {"designator", "位号"},
    "value": {"comment", "value", "评论", "注释"},
    "footprint": {"footprint", "封装"},
}


def _norm_header(h: str) -> str:
    return (h or "").strip().lower().replace("（", "(").replace("）", ")")


def _map_headers(headers: list, aliases: dict, required: list) -> dict:
    """Map logical field -> column header via alias sets. Raises on missing.

    The placement CSV has no value/footprint columns (they come from the BOM),
    so the caller states which logical fields are mandatory for this file.
    """
    mapping = {}
    for field, names in aliases.items():
        for h in headers:
            if _norm_header(h) in names:
                mapping[field] = h
                break
    if [f for f in required if f not in mapping]:
        raise ValueError(f"unrecognized headers: {headers}; matched={mapping}")
    return mapping


def _side_of(layer: str) -> str:
    s = _norm_header(layer)
    if s in ("bottom", "b", "2", "底层", "bottomlayer", "b.cu"):
        return BOTTOM
    return TOP


def _f(cell: str) -> float:
    return float(str(cell).strip().replace("°", ""))


def read_bom(path: str) -> dict:
    """BOM CSV -> {ref: (value, footprint)}."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if not rows:
        return {}
    headers = rows[0]
    mapping = _map_headers(headers, _BOM_ALIASES, ["ref", "value", "footprint"])
    col = {field: headers.index(header) for field, header in mapping.items()}
    out = {}
    for row in rows[1:]:
        if len(row) <= max(col.values()):
            continue
        ref = row[col["ref"]].strip()
        if ref:
            out[ref] = (row[col["value"]].strip(), row[col["footprint"]].strip())
    return out


def parse_xy(xy_path: str, bom: dict | None = None):
    """Placement CSV (+ optional BOM lookup) -> (parts, outline_padded_src).

    Returns parts in the SOURCE frame (y-up) plus a padded rectangle outline;
    the caller must set board.flip_y_about = padded top edge before rebasing.
    """
    bom = bom or {}
    with open(xy_path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if not rows:
        raise ValueError("empty placement CSV")
    headers = rows[0]
    mapping = _map_headers(headers, _HEADER_ALIASES, ["ref", "x", "y", "rot"])
    idx = {field: headers.index(header) for field, header in mapping.items()}

    parts = []
    for row in rows[1:]:
        if len(row) <= max(idx.values()):
            continue
        ref = row[idx["ref"]].strip()
        if not ref:
            continue
        value, footprint = bom.get(ref, ("", ""))
        if not footprint:
            footprint = "unknown"
        layer = row[idx["layer"]].strip() if "layer" in idx else "top"
        side = _side_of(layer)
        rot = _f(row[idx["rot"]]) if idx.get("rot") is not None and row[idx["rot"]].strip() else 0.0
        if side == TOP:
            rot_out = (360.0 - rot) % 360.0
        else:
            rot_out = (180.0 - rot) % 360.0
        parts.append(Part(
            ref=ref,
            value=value,
            footprint=footprint,
            side=side,
            x=_f(row[idx["x"]]),
            y=_f(row[idx["y"]]),
            rot=rot_out,
        ))

    # board outline: placements bbox + 5mm outward padding (lowest fidelity tier)
    xs = [p.x for p in parts]
    ys = [p.y for p in parts]
    pad = 5.0
    x0, x1 = min(xs) - pad, max(xs) + pad
    y0, y1 = min(ys) - pad, max(ys) + pad
    outline = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    return parts, outline, y1  # y1 = padded top -> flip_y_about


def parse_file(xy_path: str, bom_path: str | None = None):
    bom = read_bom(bom_path) if bom_path else {}
    parts, outline, flip = parse_xy(xy_path, bom)
    return parts, outline, flip
