# -*- coding: utf-8 -*-
"""Real-board regression fixtures (M5 friction backfill).

fixtures-real/ holds sanitized samples of the two real boards used in the M5
dry run: a KiCad 10 project extract (header + edge cuts + 4 real footprints)
and the JLC 2dgimbal v1.3 BOM/positions pair (trimmed). Every friction fix
found on the real boards gets a regression assertion here:

- dec3-clean output: converter values must survive the webapp loader's
  <=3-decimal rule (friction #1: 8.05/16.106 style values).
- JLC wildcard designators ("C*1") and left-bottom origin flip survive.
"""

import json
import math
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "converter" / "tests" / "fixtures-real"
CLI = ROOT / "converter" / "bom2task.py"
VALIDATOR = ROOT / "tools" / "validate_stj.py"
NOW = "2026-10-12T00:00:00+08:00"


def dec3_clean(v: float) -> bool:
    """Mirror of the webapp loader check (tolerant compare, M5 fix)."""
    return abs(v * 1000 - round(v * 1000)) < 1e-6


class RealBoardFixtures(unittest.TestCase):
    def convert(self, out_name, args):
        out = Path(tempfile.gettempdir()) / out_name
        proc = subprocess.run(
            [sys.executable, str(CLI), *args, "-o", str(out), "--now", NOW],
            capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT),
        )
        self.assertEqual(proc.returncode, 0, f"CLI failed: {proc.stdout}\n{proc.stderr}")
        data = json.loads(out.read_text(encoding="utf-8"))
        return out, data

    def validate(self, out):
        proc = subprocess.run(
            [sys.executable, str(VALIDATOR), str(out)],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(proc.returncode, 0, f"validator rejected: {proc.stdout}")

    def assert_dec3_everywhere(self, data):
        for p in data["placements"]:
            for k in ("x_mm", "y_mm"):
                self.assertTrue(dec3_clean(p[k]), f"{p['ref']}.{k}={p[k]!r} not 3-decimal clean")
        for lm in data["meta"]["landmarks"]:
            for k in ("x_mm", "y_mm"):
                self.assertTrue(dec3_clean(lm[k]), f"landmark {lm['ref']}.{k}={lm[k]!r}")

    def test_kicad_real_sample(self):
        out, data = self.convert(
            "real_kicad.stj.json",
            [str(FIX / "kicad_real_sample.kicad_pcb"), "--format", "kicad", "--name", "real-sample"],
        )
        self.validate(out)
        self.assertEqual(data["meta"]["source"], "kicad")
        self.assertEqual(len(data["placements"]), 5)  # 4 parts + 1 connector
        self.assertGreaterEqual(len(data["groups"]), 4)
        self.assertGreaterEqual(len(data["meta"]["landmarks"]), 1)
        self.assert_dec3_everywhere(data)

    def test_jlc_real_trimmed(self):
        out, data = self.convert(
            "real_jlc.stj.json",
            [
                str(FIX / "jlc_real_pos_trimmed.csv"),
                "-b", str(FIX / "jlc_real_bom_trimmed.csv"),
                "--format", "jlc", "--name", "jlc-real",
            ],
        )
        self.validate(out)
        self.assertEqual(data["meta"]["source"], "jlc")
        # wildcard designators (C*1/C*2) survive the BOM/positions join
        refs = {p["ref"] for p in data["placements"]}
        self.assertIn("C*1", refs)
        # coordinates are flipped from JLC left-bottom origin to canonical
        for p in data["placements"]:
            self.assertGreaterEqual(p["x_mm"], 0)
            self.assertGreaterEqual(p["y_mm"], 0)
        self.assert_dec3_everywhere(data)


if __name__ == "__main__":
    unittest.main()
