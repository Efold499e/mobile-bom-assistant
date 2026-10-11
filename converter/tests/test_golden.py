# -*- coding: utf-8 -*-
"""Golden tests: each format's full STJ output compared byte-for-byte against
the frozen expected file (m2 acceptance #2). Regenerate with the documented
CLI commands when a conversion rule INTENTIONALLY changes -- never hand-edit.
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bom2task import convert

FIX = Path(__file__).resolve().parent / "fixtures"
NOW = "2026-10-11T12:00:00+08:00"


def render(task: dict) -> str:
    return json.dumps(task, ensure_ascii=False, indent=2) + "\n"


class GoldenFiles(unittest.TestCase):
    def assertGolden(self, name: str, fmt: str, input_name: str, bom_name=None):
        task, _ = convert(
            fmt, FIX / input_name,
            FIX / bom_name if bom_name else None,
            Path(input_name).stem, NOW,
        )
        expected = (FIX / "expected" / f"{name}.stj.json").read_text(encoding="utf-8")
        actual = render(task)
        if actual != expected:  # produce a readable diff on failure
            import difflib
            diff = "\n".join(difflib.unified_diff(
                expected.splitlines(), actual.splitlines(),
                "expected", "actual", lineterm=""))
            self.fail(f"golden mismatch for {name}:\n{diff}")

    def test_kicad(self):
        self.assertGolden("kicad_min", "kicad", "kicad_min.kicad_pcb")

    def test_jlc(self):
        self.assertGolden("jlc_std", "jlc", "jlc_std_xy.csv", "jlc_std_bom.csv")

    def test_ibom(self):
        self.assertGolden("ibom", "ibom", "ibom_pcbdata.json")


if __name__ == "__main__":
    unittest.main()
