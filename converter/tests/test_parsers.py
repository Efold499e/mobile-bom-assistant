# -*- coding: utf-8 -*-
"""Parser tests: the double-sided coordinate trap, the JLC frame flip, and
standard/professional header sniffing (m2 acceptance #3 and #4).
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model import build_task
from parsers import ibom, jlc, kicad

FIX = Path(__file__).resolve().parent / "fixtures"
NOW = "2026-10-11T12:00:00+08:00"


class KiCadBottomSideTrap(unittest.TestCase):
    """Bottom parts must come out in TOP-VIEW coordinates + side:bottom,
    field by field -- never mirrored in conversion/storage (spec iron rule)."""

    def setUp(self):
        self.parts, self.outline = kicad.parse_file(str(FIX / "kicad_min.kicad_pcb"))

    def test_bottom_part_keeps_top_view_position(self):
        r3 = next(p for p in self.parts if p.ref == "R3")
        # source: KiCad frame, y down, at (118, 124); outline origin (100, 100)
        self.assertEqual(r3.side, "bottom")
        self.assertEqual((r3.x, r3.y), (118.0, 124.0))
        # canonical rebase is pure translation: x-100, y-100 -- NO mirroring
        task, _ = build_task(self.parts, self.outline, "kicad", "t", NOW)
        pl = next(p for p in task["placements"] if p["ref"] == "R3")
        self.assertEqual(pl["x_mm"], 18.0)   # 118 - 100, untouched by any mirror
        self.assertEqual(pl["y_mm"], 24.0)   # 124 - 100, NOT 32-24 flip
        self.assertEqual(pl["side"], "bottom")
        self.assertEqual(pl["rot_deg"], 0.0)  # KiCad CCW angle passed through

    def test_outline_chamfer_extracted(self):
        task, _ = build_task(self.parts, self.outline, "kicad", "t", NOW)
        self.assertEqual(task["meta"]["board"]["outline"],
                         [[0, 0], [45, 0], [45, 32], [8, 32], [0, 24]])

    def test_mounting_hole_never_reaches_output(self):
        task, _ = build_task(self.parts, self.outline, "kicad", "t", NOW)
        self.assertNotIn("H1", [p["ref"] for p in task["placements"]])

    def test_same_value_different_notation_groups_together(self):
        # R1 "10k" and R2 "10KΩ" are one bag after normalization
        task, _ = build_task(self.parts, self.outline, "kicad", "t", NOW)
        g = next(g for g in task["groups"] if g["value"] == "10k")
        self.assertEqual(g["refdes"], ["R1", "R2"])


class JLCFrameFlip(unittest.TestCase):
    """JLC: left-bottom origin, y up. Canonical: top-left origin, y down."""

    def setUp(self):
        self.parts, self.outline, self.flip = jlc.parse_file(
            str(FIX / "jlc_std_xy.csv"), str(FIX / "jlc_std_bom.csv"))

    def test_flip_formula(self):
        # padded bbox: x in [-1, 33], y in [1, 31] -> flip about y=31, rebase x by -1
        self.assertEqual(self.flip, 31.0)
        task, _ = build_task(self.parts, self.outline, "jlc", "t", NOW,
                             flip_y_about=self.flip)
        pl = {p["ref"]: p for p in task["placements"]}
        # R1 src (12, 26) -> x' = 12+1 = 13 ; y' = 31-26 = 5
        self.assertEqual((pl["R1"]["x_mm"], pl["R1"]["y_mm"]), (13.0, 5.0))
        # R5 bottom src (18, 6) -> y' = 31-6 = 25 ; x UNCHANGED apart from the
        # global translation applied to every part (no mirror: not W-x)
        self.assertEqual((pl["R5"]["x_mm"], pl["R5"]["y_mm"]), (19.0, 25.0))
        self.assertEqual(pl["R5"]["side"], "bottom")

    def test_rotation_remap(self):
        task, _ = build_task(self.parts, self.outline, "jlc", "t", NOW,
                             flip_y_about=self.flip)
        pl = {p["ref"]: p for p in task["placements"]}
        self.assertEqual(pl["LED1"]["rot_deg"], 270.0)  # top: 360-90
        self.assertEqual(pl["R5"]["rot_deg"], 180.0)    # bottom: 180-0
        self.assertEqual(pl["R1"]["rot_deg"], 0.0)      # top: 360-0

    def test_outline_is_padded_placement_bbox(self):
        task, _ = build_task(self.parts, self.outline, "jlc", "t", NOW,
                             flip_y_about=self.flip)
        self.assertEqual(task["meta"]["board"]["width_mm"], 34.0)   # 4..28 + 2*5
        self.assertEqual(task["meta"]["board"]["height_mm"], 30.0)  # 6..26 + 2*5


class JLCHeaderSniffing(unittest.TestCase):
    """Standard (Designator,top x,...) and professional (评论,位号 / Mid X) exports
    must produce identical tasks given identical bodies."""

    def test_std_and_pro_headers_same_result(self):
        parts_s, outline_s, flip_s = jlc.parse_file(
            str(FIX / "jlc_std_xy.csv"), str(FIX / "jlc_std_bom.csv"))
        parts_p, outline_p, flip_p = jlc.parse_file(
            str(FIX / "jlc_pro_xy.csv"), str(FIX / "jlc_pro_bom.csv"))
        self.assertEqual(flip_s, flip_p)
        task_s, _ = build_task(parts_s, outline_s, "jlc", "t", NOW, flip_y_about=flip_s)
        task_p, _ = build_task(parts_p, outline_p, "jlc", "t", NOW, flip_y_about=flip_p)
        self.assertEqual(task_s, task_p)

    def test_unrecognized_headers_raise(self):
        import tempfile, os
        bad = Path(tempfile.gettempdir()) / "jlc_bad_headers.csv"
        bad.write_text("foo,bar\n1,2\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            jlc.parse_xy(str(bad))
        os.remove(bad)


class IBOMParser(unittest.TestCase):
    def setUp(self):
        self.parts, self.outline = ibom.parse_file(str(FIX / "ibom_pcbdata.json"))

    def test_values_from_bom_matrix(self):
        by_ref = {p.ref: p for p in self.parts}
        self.assertEqual(by_ref["R1"].value, "10k")
        self.assertEqual(by_ref["C1"].value, "104")
        self.assertEqual(by_ref["R3"].value, "4k7")

    def test_layers_and_bbox(self):
        by_ref = {p.ref: p for p in self.parts}
        self.assertEqual(by_ref["R3"].side, "bottom")
        self.assertEqual(by_ref["R1"].bbox, (2.0, 1.2))
        self.assertEqual(by_ref["C1"].rot, 90.0)

    def test_bottom_part_not_mirrored(self):
        # R3 src center (18, 24) is already top-view; output must keep x=18
        task, _ = build_task(self.parts, self.outline, "ibom", "t", NOW)
        pl = next(p for p in task["placements"] if p["ref"] == "R3")
        self.assertEqual((pl["x_mm"], pl["y_mm"]), (18.0, 24.0))
        self.assertEqual(pl["side"], "bottom")


if __name__ == "__main__":
    unittest.main()
