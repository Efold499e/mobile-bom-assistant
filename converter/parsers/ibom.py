# -*- coding: utf-8 -*-
"""iBOM pcbdata.json parser (InteractiveHtmlBom export).

Frame notes: pcbdata coordinates are already mm, y DOWN (KiCad-derived frame),
rotations CCW in top view -- same convention as canonical, so only the origin
rebase is needed. Values live in the bom matrix rows [value, footprint, [refs]];
footprint entries carry refdes/layer/center/rotation/bounding_box.
"""

import json
from pathlib import Path

from model import Part, TOP, BOTTOM


def parse_ibom(text: str):
    data = json.loads(text)
    value_by_ref = {}
    for row in data.get("bom", []):
        # rows are [value, footprint, [refs]] (flattened one level if needed)
        if len(row) >= 3 and isinstance(row[0], list):
            row = row[0]
        if len(row) >= 3:
            value, footprint, refs = row[0], row[1], row[2]
            for ref in refs:
                value_by_ref[ref] = (str(value), str(footprint))

    parts = []
    for fp in data.get("footprints", []):
        refdes = fp.get("refdes", "")
        if not refdes:
            continue
        layer = fp.get("layer", "F")
        side = BOTTOM if str(layer).upper().startswith("B") else TOP
        center = fp.get("center") or {}
        if isinstance(center, dict):
            cx, cy = center.get("x", 0.0), center.get("y", 0.0)
        else:
            cx, cy = float(center[0]), float(center[1])
        bbox = fp.get("bounding_box") or {}
        size = None
        if isinstance(bbox, dict) and "start" in bbox and "end" in bbox:
            def _pt(v):
                return (float(v[0]), float(v[1])) if isinstance(v, (list, tuple)) \
                    else (float(v.get("x", 0.0)), float(v.get("y", 0.0)))
            (x0, y0), (x1, y1) = _pt(bbox["start"]), _pt(bbox["end"])
            # start/end are opposite corners of the axis-aligned box
            size = (round(abs(x1 - x0), 3), round(abs(y1 - y0), 3))
        value, footprint = value_by_ref.get(refdes, ("", fp.get("footprint", "")))
        parts.append(Part(
            ref=refdes,
            value=value,
            footprint=footprint or fp.get("footprint", ""),
            side=side,
            x=float(cx),
            y=float(cy),
            rot=float(fp.get("rotation", 0.0) or 0.0),
            bbox=size,
        ))

    outline = [list(pt) for pt in (data.get("pcb", {}).get("outline") or [])]
    return parts, outline


def parse_file(path: str):
    return parse_ibom(Path(path).read_text(encoding="utf-8"))
