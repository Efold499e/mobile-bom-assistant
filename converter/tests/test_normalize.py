# -*- coding: utf-8 -*-
"""Table-driven value normalization tests (m2 acceptance #5)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from normalize import normalize_value


class NormalizationTables(unittest.TestCase):
    def test_resistor_required_cases(self):
        # 4k7 / 10KΩ / 10000 -> 10k ; 2R2 -> 2.2Ω ; 0R -> 0Ω
        cases = {
            "4k7": "4.7k",
            "10KΩ": "10k",
            "10000": "10k",
            "2R2": "2.2Ω",
            "0R": "0Ω",
            "10k": "10k",
            "4M7": "4.7M",
            "10m": "0.01Ω",  # lowercase m = milliohm
            "470": "470Ω",
            "1M": "1M",
        }
        for raw, want in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(normalize_value(raw, "r").value, want)

    def test_resistor_speak_atoms(self):
        self.assertEqual(normalize_value("10k", "r").speak, "10千欧")
        self.assertEqual(normalize_value("2R2", "r").speak, "2.2欧")
        self.assertEqual(normalize_value("4M7", "r").speak, "4.7兆欧")
        self.assertEqual(normalize_value("0R", "r").speak, "0欧")

    def test_capacitor_required_cases(self):
        # 104 -> 100nF ; milli/mega by case (10mF vs 10MF)
        cases = {
            "104": "100nF",
            "22": "22pF",
            "100nF": "100nF",
            "100n": "100nF",
            "10uF": "10µF",
            "10µF": "10µF",
            "10mF": "10mF",  # millifarad
            "10MF": "10MF",  # megafarad (absurd but case-sensitive by rule)
            "4p7": "4.7pF",
        }
        for raw, want in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(normalize_value(raw, "c").value, want)

    def test_capacitor_speak_atoms(self):
        self.assertEqual(normalize_value("104", "c").speak, "100纳法")
        self.assertEqual(normalize_value("22", "c").speak, "22皮法")
        self.assertEqual(normalize_value("10uF", "c").speak, "10微法")
        self.assertEqual(normalize_value("10mF", "c").speak, "10毫法")
        self.assertEqual(normalize_value("10MF", "c").speak, "10兆法")

    def test_inductor_units(self):
        self.assertEqual(normalize_value("10uH", "l").value, "10µH")
        self.assertEqual(normalize_value("10uH", "l").speak, "10微亨")
        self.assertEqual(normalize_value("2mH", "l").speak, "2毫亨")
        self.assertEqual(normalize_value("100", "l").value, "100µH")  # bare -> µH

    def test_prefix_unit_inference_is_caller_duty(self):
        # kind comes from the refdes prefix (R/C/L) upstream; the normalizer
        # itself only sees the kind. The same bare number reads differently:
        self.assertEqual(normalize_value("100", "r").value, "100Ω")
        self.assertEqual(normalize_value("100", "c").value, "10pF")  # digit code
        self.assertEqual(normalize_value("100", "l").value, "100µH")

    def test_dual_value_folds_alt_into_speak(self):
        n = normalize_value("100nF(104)", "c")
        self.assertEqual(n.value, "100nF")
        self.assertEqual(n.speak, "100纳法（104）")
        self.assertEqual(n.alt, "104")

    def test_non_rlc_values_pass_through(self):
        n = normalize_value("ME6211", "ic")
        self.assertEqual(n.value, "ME6211")
        self.assertTrue(n.ok)

    def test_unparseable_rlc_kept_raw_and_flagged(self):
        n = normalize_value("600R@100MHz", "r")
        self.assertFalse(n.ok)
        self.assertEqual(n.value, "600R@100MHz")

    def test_empty_value_flagged(self):
        self.assertFalse(normalize_value("", "r").ok)


if __name__ == "__main__":
    unittest.main()
