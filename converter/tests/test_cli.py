# -*- coding: utf-8 -*-
"""CLI acceptance: real subprocess runs for all three formats; every output
must pass the M0 validator (m2 acceptance #8).
"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "converter" / "tests" / "fixtures"
CLI = ROOT / "converter" / "bom2task.py"
VALIDATOR = ROOT / "tools" / "validate_stj.py"
NOW = "2026-10-11T12:00:00+08:00"


class CLIRuns(unittest.TestCase):
    def run_case(self, out_name, args, project):
        out = Path(tempfile.gettempdir()) / out_name
        proc = subprocess.run(
            [sys.executable, str(CLI), *args, "--now", NOW],
            capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT),
        )
        self.assertEqual(proc.returncode, 0,
                         f"CLI failed: {proc.stdout}\n{proc.stderr}")
        self.assertTrue(out.exists(), f"output missing: {out}")
        val = subprocess.run(
            [sys.executable, str(VALIDATOR), str(out)],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(val.returncode, 0,
                         f"M0 validator rejected {out_name}:\n{val.stdout}")
        self.assertIn(f"project    : {project}",
                      subprocess.run(
                          [sys.executable, str(CLI), *args, "--now", NOW, "--check"],
                          capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT),
                      ).stdout)
        return out

    def test_kicad_end_to_end(self):
        self.run_case(
            "m2-cli-kicad.json",
            [str(FIX / "kicad_min.kicad_pcb"), "-o", str(Path(tempfile.gettempdir()) / "m2-cli-kicad.json")],
            "kicad_min",
        )

    def test_jlc_end_to_end(self):
        self.run_case(
            "m2-cli-jlc.json",
            [str(FIX / "jlc_std_xy.csv"), "-b", str(FIX / "jlc_std_bom.csv"),
             "-o", str(Path(tempfile.gettempdir()) / "m2-cli-jlc.json"), "--check"],
            "jlc_std_xy",
        )

    def test_ibom_end_to_end(self):
        self.run_case(
            "m2-cli-ibom.json",
            [str(FIX / "ibom_pcbdata.json"), "-o", str(Path(tempfile.gettempdir()) / "m2-cli-ibom.json")],
            "ibom_pcbdata",
        )

    def test_missing_input_exit_2(self):
        proc = subprocess.run(
            [sys.executable, str(CLI), "nope.kicad_pcb"],
            capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT),
        )
        self.assertEqual(proc.returncode, 2)


if __name__ == "__main__":
    unittest.main()
