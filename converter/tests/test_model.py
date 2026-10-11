# -*- coding: utf-8 -*-
"""Model-level tests: polarity inference, exclusion, default order."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model import (
    BOTTOM,
    TOP,
    Part,
    build_task,
    classify_kind,
    is_excluded,
    is_polarized,
    process_default_order,
)

NOW = "2026-10-11T12:00:00+08:00"
OUTLINE = [[0, 0], [45, 0], [45, 32], [8, 32], [0, 24]]


class PolarityInference(unittest.TestCase):
    def test_required_cases(self):
        # LED / diode / electrolytic / IC pin1 -- refdes x footprint keywords
        self.assertTrue(is_polarized("led", "LED_0805"))
        self.assertTrue(is_polarized("d", "SOD-123"))
        self.assertTrue(is_polarized("ic", "TSSOP-8"))
        self.assertTrue(is_polarized("c", "CP_Elec_6.3x7.7"))
        self.assertTrue(is_polarized("c", "C_Radial_L8mm"))
        self.assertFalse(is_polarized("c", "0603"))
        self.assertFalse(is_polarized("r", "0603"))
        self.assertFalse(is_polarized("q", "SOT-23"))

    def test_led_kind_from_refdes_and_footprint(self):
        self.assertEqual(classify_kind("LED3", "0603"), "led")
        self.assertEqual(classify_kind("D5", "LED_0805"), "led")  # footprint wins
        self.assertEqual(classify_kind("D5", "SOD-123"), "d")

    def test_kind_prefixes(self):
        self.assertEqual(classify_kind("R12", "0603"), "r")
        self.assertEqual(classify_kind("C4", "0603"), "c")
        self.assertEqual(classify_kind("L1", "0805"), "l")
        self.assertEqual(classify_kind("U3", "SOIC-8"), "ic")
        self.assertEqual(classify_kind("J2", "USB_C"), "conn")
        self.assertEqual(classify_kind("SW1", "TACT"), "sw")
        self.assertEqual(classify_kind("Y1", "XTAL"), "other")


class Exclusion(unittest.TestCase):
    def test_required_cases(self):
        # mounting holes / fiducials / mechanical default-excluded
        self.assertTrue(is_excluded("H1", "MountingHole:MountingHole_3.2mm"))
        self.assertTrue(is_excluded("MH2", "MountingHole"))
        self.assertTrue(is_excluded("FID1", "Fiducial_1mm"))
        self.assertTrue(is_excluded("", "0603"))
        self.assertFalse(is_excluded("R1", "0603"))
        # refdes H1 excludes even with a plain footprint (refdes rule)
        self.assertTrue(is_excluded("H1", "0603"))

    def test_explicit_flag(self):
        self.assertTrue(is_excluded("R9", "0603", excluded_flag=True))


def _mk_group(gid, side=TOP, mount="smd", height=1.0, size=1.0):
    return {
        "gid": gid, "kind": "r", "footprint": "0603", "value": gid,
        "polarity": False, "qty": 1, "refdes": ["X"],
        "_mount": mount, "_side": side, "_height": height, "_size": size,
        "members": [],
    }


class DefaultOrder(unittest.TestCase):
    def test_side_finishes_before_flip(self):
        # counterexample: big top group must still precede a small bottom group
        top_big = _mk_group("ga", side=TOP, height=6.0, size=100.0)
        bottom_small = _mk_group("gz", side=BOTTOM, height=0.5, size=0.1)
        self.assertEqual(process_default_order([bottom_small, top_big]), ["ga", "gz"])

    def test_smd_before_tht(self):
        # counterexample: tiny THT part is welded after a big SMD part
        smd_big = _mk_group("ga", mount="smd", height=6.0, size=100.0)
        tht_small = _mk_group("gz", mount="tht", height=0.5, size=0.1)
        self.assertEqual(process_default_order([tht_small, smd_big]), ["ga", "gz"])

    def test_shorter_before_taller_then_smaller_before_larger(self):
        tall_small = _mk_group("ga", height=2.0, size=0.1)
        short_big = _mk_group("gz", height=0.5, size=100.0)
        self.assertEqual(process_default_order([tall_small, short_big]), ["gz", "ga"])
        same_h_a = _mk_group("ga", height=1.0, size=5.0)
        same_h_b = _mk_group("gz", height=1.0, size=1.0)
        self.assertEqual(process_default_order([same_h_a, same_h_b]), ["gz", "ga"])

    def test_deterministic_tiebreak_by_gid(self):
        a = _mk_group("gb", height=1.0, size=1.0)
        b = _mk_group("ga", height=1.0, size=1.0)
        self.assertEqual(process_default_order([a, b]), ["ga", "gb"])


class BuildTaskBasics(unittest.TestCase):
    def test_landmarks_from_biggest_connectors_capped_at_3(self):
        parts = [
            Part("J1", "USB-C", "Conn_A", x=5, y=5, bbox=(10, 3)),
            Part("J2", "H2.54", "Conn_B", x=15, y=5, bbox=(20, 3)),
            Part("J3", "H1.0", "Conn_C", x=25, y=5, bbox=(15, 3)),
            Part("J4", "H1.0", "Conn_D", x=30, y=5, bbox=(12, 3)),
            Part("R1", "10k", "R_0603_1608Metric", x=10, y=20),
        ]
        task, diag = build_task(parts, OUTLINE, "kicad", "t", NOW)
        self.assertEqual([lm["ref"] for lm in task["meta"]["landmarks"]],
                         ["J2", "J3", "J4"])  # biggest first, capped at 3

    def test_diagnostics_report_anomalies_and_excludes(self):
        parts = [
            Part("R1", "!!??", "R_0603_1608Metric", x=10, y=10),
            Part("H1", "", "MountingHole_3.2mm", x=40, y=30),
        ]
        task, diag = build_task(parts, OUTLINE, "kicad", "t", NOW)
        self.assertEqual(len(task["placements"]), 1)
        self.assertTrue(diag["anomalies"])
        self.assertIn("H1", diag["excluded"][0])

    def test_sides_and_qty_consistency(self):
        parts = [
            Part("R1", "10k", "R_0603_1608Metric", x=10, y=10),
            Part("R2", "10KΩ", "R_0603_1608Metric", x=20, y=10),
            Part("R3", "4k7", "R_0603_1608Metric", x=20, y=20, side=BOTTOM),
        ]
        task, _ = build_task(parts, OUTLINE, "kicad", "t", NOW)
        self.assertEqual(task["sides"], ["top", "bottom"])
        g = next(g for g in task["groups"] if g["value"] == "10k")
        self.assertEqual(g["qty"], 2)
        self.assertEqual(g["refdes"], ["R1", "R2"])
        by_gid = {g["gid"]: g for g in task["groups"]}
        for pl in task["placements"]:
            self.assertEqual(by_gid[pl["gid"]]["qty"],
                             sum(1 for q in task["placements"] if q["gid"] == pl["gid"]))


if __name__ == "__main__":
    unittest.main()
