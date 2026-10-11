#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M0 acceptance assertions for webapp/public/demo/demo.stj.json.

Checks every element required by docs/prompts/m0.md ("demo task required elements").
Python stdlib only; runs tools/validate_stj.py as a subprocess for the integration path.
Exit 0 = all assertions pass; 1 = at least one failed.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "webapp" / "public" / "demo" / "demo.stj.json"
VALIDATOR = ROOT / "tools" / "validate_stj.py"

# Mirror of spec appendix C (only entries the demo can hit); used to size footprints
# that omit bbox_mm. Kept in sync with docs/stj-spec.md.
DEFAULT_BBOX = {
    "0402": (1.0, 0.5), "0603": (1.6, 0.8), "0805": (2.0, 1.25),
    "1206": (3.2, 1.6), "1210": (3.2, 2.5), "sod-123": (3.7, 1.6),
    "sot-23": (2.9, 2.4), "sot-23-5": (2.9, 1.6), "sot-223": (6.5, 3.5),
    "soic-8": (4.9, 3.9), "soic-16": (4.9, 6.4),
}

failures = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    line = f"[{status}] {name}"
    if detail:
        line += f" -- {detail}"
    print(line)
    if not cond:
        failures.append(name)


def eff_bbox(p, group):
    if "bbox_mm" in p and isinstance(p["bbox_mm"], list) and len(p["bbox_mm"]) == 2:
        return float(p["bbox_mm"][0]), float(p["bbox_mm"][1])
    fp = str(group.get("footprint", "")).strip().lower()
    return DEFAULT_BBOX.get(fp, (1.0, 1.0))


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    # 0. Validator accepts the demo file (integration path).
    proc = subprocess.run([sys.executable, str(VALIDATOR), str(DEMO)],
                          capture_output=True, text=True, encoding="utf-8")
    check("validator exits 0 on demo task", proc.returncode == 0,
          f"rc={proc.returncode}")
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr)
        return 1
    stats_line = [l for l in proc.stdout.splitlines() if l.startswith("STATS ")]
    check("validator prints exactly one STATS line", len(stats_line) == 1)
    if stats_line:
        print(f"       {stats_line[0]}")

    data = json.loads(DEMO.read_text(encoding="utf-8"))
    groups = {g["gid"]: g for g in data["groups"]}
    placements = data["placements"]

    # 1. Exactly 12 placements.
    check("exactly 12 placements", len(placements) == 12, f"got {len(placements)}")

    # 2. At least 4 groups.
    check("groups >= 4", len(data["groups"]) >= 4, f"got {len(data['groups'])}")

    # 3. A batch group with qty >= 4 exists.
    batch = [(gid, g["qty"]) for gid, g in groups.items() if g["qty"] >= 4]
    check("exists batch group with qty >= 4", bool(batch),
          ", ".join(f"{gid}(qty={q})" for gid, q in batch))

    # 4. At least 2 polarity placements.
    n_polarity = sum(1 for p in placements if groups[p["gid"]]["polarity"])
    check("polarity placements >= 2", n_polarity >= 2,
          f"got {n_polarity}: " + ",".join(p["ref"] for p in placements
                                           if groups[p["gid"]]["polarity"]))

    # 5. At least 2 bottom-side placements.
    bottom = [p for p in placements if p["side"] == "bottom"]
    check("bottom-side placements >= 2", len(bottom) >= 2,
          "got " + ",".join(p["ref"] for p in bottom))

    # 6. At least 1 landmark with a Chinese speak string.
    landmarks = data["meta"]["landmarks"]
    def has_cjk(s):
        return any("\u4e00" <= ch <= "\u9fff" for ch in s)
    cjk_lms = [lm for lm in landmarks if has_cjk(lm["speak"])]
    check("landmarks >= 1 with Chinese speak", len(landmarks) >= 1 and bool(cjk_lms),
          f"{len(landmarks)} landmarks, {len(cjk_lms)} with CJK speak: "
          + ",".join(lm["ref"] for lm in cjk_lms))

    # 7. Outline is a polygon but NOT a 4-point axis-aligned rectangle.
    outline = data["meta"]["board"]["outline"]
    xs = [pt[0] for pt in outline]
    ys = [pt[1] for pt in outline]
    is_rect = (len(outline) == 4 and len(set(xs)) == 2 and len(set(ys)) == 2
               and all(pt[0] in (min(xs), max(xs)) and pt[1] in (min(ys), max(ys))
                       for pt in outline))
    check("outline is not a 4-point rectangle", len(outline) >= 3 and not is_rect,
          f"{len(outline)} points")

    # 8. group_order_default is a full permutation of gids.
    order = data["group_order_default"]
    check("group_order_default covers all gids exactly once",
          sorted(order) == sorted(groups))

    # 9a. All top-side groups come before bottom-side groups in the default order.
    side_of = {gid: placements_by_gid_side(placements, groups, gid) for gid in groups}
    sides_in_order = [side_of[gid] for gid in order if side_of[gid] in ("top", "bottom")]
    check("default order welds top side before bottom side",
          sides_in_order == sorted(sides_in_order, key=lambda s: 0 if s == "top" else 1),
          " -> ".join(order))

    # 9b. Within each side, footprint area is non-decreasing (small before large).
    ok_area = True
    detail = []
    for side in ("top", "bottom"):
        seq = [groups[gid] for gid in order if side_of[gid] == side]
        areas = []
        for g in seq:
            p0 = next(p for p in placements if p["gid"] == g["gid"])
            w, h = eff_bbox(p0, g)
            areas.append((g["footprint"], w * h))
        for a, b in zip(areas, areas[1:]):
            if a[1] > b[1] + 1e-9:
                ok_area = False
        detail.append(f"{side}: " + ", ".join(f"{fp}({ar:.2f}mm2)" for fp, ar in areas))
    check("small before large within each side", ok_area, " | ".join(detail))

    print()
    if failures:
        print(f"FAILED: {len(failures)} assertion(s): {', '.join(failures)}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


def placements_by_gid_side(placements, groups, gid):
    sides = {p["side"] for p in placements if p["gid"] == gid}
    if len(sides) == 1:
        return next(iter(sides))
    return "mixed" if len(sides) > 1 else "none"


if __name__ == "__main__":
    sys.exit(main())
