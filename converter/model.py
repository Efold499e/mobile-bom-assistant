# -*- coding: utf-8 -*-
"""bom2task intermediate model: parts in, STJ v1 out.

Pipeline: parsers produce Part records -> classify/exclude -> normalize values
-> group by (kind, footprint, value) -> process-default order -> STJ dict.
Coordinate canonical form per docs/stj-spec.md: mm, origin = board outline
top-left, y down, rotations CCW in top view, bottom parts stored in top view
(never mirrored here -- mirroring happens only in the phone render layer).
"""

import re
from dataclasses import dataclass, field

from normalize import Norm, normalize_value
from speak import footprint_display_name, footprint_speak, height_mm_of, landmark_speak

TOP = "top"
BOTTOM = "bottom"


@dataclass
class Part:
    """One physical placement, parser output before normalization/rebasing."""

    ref: str
    value: str
    footprint: str  # raw footprint name from the source file
    side: str = TOP  # TOP / BOTTOM
    x: float = 0.0
    y: float = 0.0
    rot: float = 0.0
    bbox: tuple | None = None  # (w, h) mm, None -> omitted, consumer estimates
    mount: str = "smd"  # smd / tht
    excluded: bool = False  # set by parsers for explicit excludes (attr board_only...)
    # Pad geometry in the FOOTPRINT-LOCAL frame (placement rotation NOT applied;
    # the renderer rotates). List of {x, y, w, h, shape} in mm. Sources that
    # carry no geometry (JLC CSV pairs) leave this None.
    pads: list | None = None
    # Silkscreen graphics, same local frame: {lines, circles}. What makes a
    # part recognisable on a Gerber-style render. None when the source lacks it.
    silk: dict | None = None


@dataclass
class Board:
    outline: list = field(default_factory=list)  # [[x, y], ...] in source coords
    dx: float = 0.0
    dy: float = 0.0
    # JLC only: source frame is y-up, so canonical y = flip_y_about - y.
    flip_y_about: float | None = None

    def _flip(self, x: float, y: float) -> tuple:
        if self.flip_y_about is not None:
            y = self.flip_y_about - y
        return (x, y)

    def lock_origin(self) -> None:
        """Compute the rebase offset from the FLIPPED outline so the canonical
        outline starts at (0, 0) (call once after constructing the board)."""
        flipped = [self._flip(pt[0], pt[1]) for pt in self.outline]
        self.dx = min(x for x, _ in flipped)
        self.dy = min(y for _, y in flipped)

    def to_canonical(self, x: float, y: float) -> tuple:
        x, y = self._flip(x, y)
        return (round(x - self.dx, 3), round(y - self.dy, 3))


def classify_kind(ref: str, footprint: str) -> str:
    fp = (footprint or "").lower()
    head = re.match(r"^([A-Za-z]+)", ref or "")
    prefix = head.group(1).upper() if head else ""
    if prefix == "LED" or "led" in fp:
        return "led"
    first = prefix[:1]
    if first == "R":
        return "r"
    if first == "C":
        return "c"
    if first == "L":
        return "l"
    if first == "D":
        return "d"
    if first == "U":
        return "ic"
    if first in ("Q", "T"):
        return "q"
    if first in ("J", "P"):
        return "conn"
    if first == "S":
        return "sw"
    return "other"


EXCLUDE_REF_RE = re.compile(r"^(H|MH|FID)\d", re.IGNORECASE)
ELECTROLYTIC_HINTS = ("elec", "pol", "radial", "tantal")


def is_excluded(ref: str, footprint: str, excluded_flag: bool = False) -> bool:
    fp = (footprint or "").lower().replace("_", "").replace(" ", "")
    if "mountinghole" in fp:
        return True
    if "fiducial" in fp:
        return True
    if not ref or ref == "***" or EXCLUDE_REF_RE.match(ref):
        return True
    return excluded_flag


def is_polarized(kind: str, footprint: str) -> bool:
    fp = (footprint or "").lower()
    if kind in ("led", "d", "ic"):
        return True
    if kind == "c" and any(h in fp for h in ELECTROLYTIC_HINTS):
        return True
    return False


def build_task(parts: list, outline_src: list, source: str, project: str, created_at: str,
               flip_y_about: float | None = None) -> dict:
    """Assemble the STJ v1 dict from parsed parts + source-frame outline.

    outline_src: polygon [[x, y], ...] in the parser's source coordinate frame.
    The frame must be y-down (kicad / ibom); JLC passes flip_y_about (its frame
    is y-up) and the board rebases with y' = flip_y_about - y.
    Returns (task_dict, diagnostics); the diagnostics key is stripped from STJ
    by the CLI but reused by --check and tests.
    """
    kept = [p for p in parts if not (p.excluded or is_excluded(p.ref, p.footprint))]
    excluded_parts = [p for p in parts if p not in kept]

    if outline_src is None:
        raise ValueError(
            "no closed board outline found on Edge.Cuts "
            "(file truncated, or the outline is drawn on another layer such as Margin)")

    board = Board(outline=[list(pt) for pt in outline_src], flip_y_about=flip_y_about)
    board.lock_origin()

    # Parts parked >1mm outside the board outline (screws/nuts/washers mounted
    # on standoffs, parts strewn off-board in old demos) are not solderable
    # positions; spec E_RANGE would reject them, so drop them with a note.
    anomalies = []
    ob_x = [board.to_canonical(pt[0], pt[1])[0] for pt in board.outline]
    ob_y = [board.to_canonical(pt[0], pt[1])[1] for pt in board.outline]
    bx0, bx1, by0, by1 = min(ob_x), max(ob_x), min(ob_y), max(ob_y)
    on_board = []
    for p in kept:
        cx, cy = board.to_canonical(p.x, p.y)
        if bx0 - 1.0 <= cx <= bx1 + 1.0 and by0 - 1.0 <= cy <= by1 + 1.0:
            on_board.append(p)
        else:
            anomalies.append(
                f"{p.ref}: center ({cx:.2f}, {cy:.2f}) is outside the board outline; dropped")
    kept = on_board
    if not kept:
        raise ValueError(
            f"no solderable parts found ({len(excluded_parts)} excluded as "
            "mechanical/board-only, " + str(sum(1 for a in anomalies if 'outside the board' in a))
            + " dropped as off-board)")

    placements = []
    anomalies_dedup = []
    by_ref = {}
    for p in sorted(kept, key=lambda q: (0 if q.side == TOP else 1, q.ref)):
        ref = p.ref
        if ref in by_ref:
            n = 2
            while f"{ref}_{n}" in by_ref:
                n += 1
            anomalies_dedup.append(f"duplicate refdes {p.ref} -> renamed {ref}_{n}")
            ref = f"{ref}_{n}"
        kind = classify_kind(p.ref, p.footprint)
        norm = normalize_value(p.value, kind)
        if not norm.ok:
            anomalies.append(f"{p.ref}: {p.value!r}")
        if not norm.value:
            # BOM missing the value entirely: fall back to the footprint name so
            # the STJ stays valid; --check still lists the part as an anomaly.
            norm = Norm(p.footprint or p.ref, p.footprint or p.ref, False)
        pid = len(placements)
        cx, cy = board.to_canonical(p.x, p.y)
        placement = {
            "pid": pid,
            "gid": None,
            "ref": ref,
            "side": p.side,
            "x_mm": cx,
            "y_mm": cy,
            "rot_deg": round(p.rot % 360.0, 1),
        }
        if p.bbox:
            placement["bbox_mm"] = [round(p.bbox[0], 3), round(p.bbox[1], 3)]
        if p.pads:
            placement["pads"] = [
                {
                    "x_mm": round(pd["x"], 3) + 0.0,  # +0.0 normalizes -0.0
                    "y_mm": round(pd["y"], 3) + 0.0,
                    "w_mm": round(pd["w"], 3) + 0.0,
                    "h_mm": round(pd["h"], 3) + 0.0,
                    "shape": pd["shape"],
                }
                for pd in p.pads
            ]
        if p.silk:
            placement["silk"] = {
                "lines": [[round(v, 3) + 0.0 for v in ln] for ln in p.silk["lines"]],
                "circles": [[round(v, 3) + 0.0 for v in c] for c in p.silk["circles"]],
            }
        placement["_kind"] = kind
        placement["_fp_name"] = footprint_display_name(p.footprint)
        placement["_value"] = norm.value
        placement["_value_speak"] = norm.speak
        placement["_mount"] = p.mount
        placements.append(placement)
        by_ref[ref] = (p.x, p.y)

    groups: dict = {}
    for pl in placements:
        key = (pl["_kind"], pl["_fp_name"], pl["_value"])
        if key not in groups:
            groups[key] = {
                "gid": f"g{len(groups)}",
                "kind": pl["_kind"],
                "footprint": pl["_fp_name"],
                "value": pl["_value"],
                "members": [],
            }
        groups[key]["members"].append(pl)
        pl["gid"] = groups[key]["gid"]

    group_list = []
    for g in groups.values():
        members = sorted(g["members"], key=lambda m: m["ref"])
        fp_raw_all = " ".join(m["_fp_name"] for m in members)
        group = {
            "gid": g["gid"],
            "kind": g["kind"],
            "footprint": g["footprint"],
            "value": g["value"],
            "polarity": is_polarized(g["kind"], fp_raw_all),
            "qty": len(members),
            "refdes": [m["ref"] for m in members],
        }
        fp_spk = footprint_speak(g["kind"], g["footprint"])
        if fp_spk != g["footprint"]:
            group["footprint_speak"] = fp_spk
        val_spk = members[0]["_value_speak"]
        if val_spk != g["value"]:
            group["value_speak"] = val_spk
        group["_mount"] = members[0]["_mount"]
        group["_side"] = TOP if any(m["side"] == TOP for m in members) else BOTTOM
        group["_height"] = height_mm_of(g["footprint"])
        areas = [
            (m.get("bbox_mm") or [0.0, 0.0])[0] * (m.get("bbox_mm") or [0.0, 0.0])[1]
            for m in members
        ]
        group["_size"] = max(areas) if areas else 0.0
        group_list.append(group)

    group_order_default = process_default_order(group_list)

    sides = [s for s in (TOP, BOTTOM) if any(pl["side"] == s for pl in placements)]

    landmark_parts = sorted(
        (pl for pl in placements if pl["_kind"] == "conn"),
        key=lambda pl: -((pl.get("bbox_mm") or [0.0, 0.0])[0] * (pl.get("bbox_mm") or [0.0, 0.0])[1]),
    )[:3]
    landmarks = []
    seen_landmark_refs = set()
    for pl in landmark_parts:
        if pl["ref"] in seen_landmark_refs:
            continue
        seen_landmark_refs.add(pl["ref"])
        sx, sy = by_ref[pl["ref"]]
        lx, ly = board.to_canonical(sx, sy)
        landmarks.append({"ref": pl["ref"], "speak": landmark_speak(pl["ref"]), "x_mm": lx, "y_mm": ly})

    outline_canon = [list(board.to_canonical(x, y)) for x, y in board.outline]
    w = round(max(pt[0] for pt in outline_canon) - min(pt[0] for pt in outline_canon), 3)
    h = round(max(pt[1] for pt in outline_canon) - min(pt[1] for pt in outline_canon), 3)

    task = {
        "format": "solder-task-json",
        "version": 1,
        "meta": {
            "project": project,
            "source": source,
            "created_at": created_at,
            "board": {"width_mm": w, "height_mm": h, "outline": outline_canon},
            "landmarks": landmarks,
        },
        "sides": sides,
        "groups": [{k: v for k, v in g.items() if not k.startswith("_")}
                   for g in sorted(group_list, key=lambda g: g["gid"])],
        "placements": [{k: v for k, v in pl.items() if not k.startswith("_")}
                       for pl in sorted(placements, key=lambda pl: pl["pid"])],
        "group_order_default": group_order_default,
    }
    diagnostics = {
        "anomalies": anomalies + anomalies_dedup,
        "excluded": [f"{p.ref} ({p.footprint})" for p in excluded_parts],
        "kept": len(placements),
        "groups": group_list,
    }
    return task, diagnostics


def process_default_order(groups: list) -> list:
    """Plan section 8 default process order, lowest key first:

    1. side: top fully before bottom (finish one face, then flip)
    2. mount: SMD before THT
    3. height: shorter before taller
    4. size: smaller footprint area before larger
    5. gid: deterministic tie-break
    """
    return [
        g["gid"]
        for g in sorted(
            groups,
            key=lambda g: (
                0 if g.get("_side", TOP) == TOP else 1,
                0 if g.get("_mount", "smd") == "smd" else 1,
                g["_height"],
                g["_size"],
                g["gid"],
            ),
        )
    ]
