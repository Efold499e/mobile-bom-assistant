#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M0 self-review probes (2026-10-11, post-acceptance hardening).

Derives extra negative STJ samples from the frozen demo task and asserts the
validator rejects each one. Complements the three official samples required by
docs/prompts/m0.md. Stdlib only. Exit 0 = all probes behave as expected.

History: first run (before fixes) exposed two spec-vs-validator gaps
(untimezoned created_at accepted; negative coordinate accepted) and one
unimplemented spec warning (W_LANDMARK); tools/validate_stj.py was then aligned
to docs/stj-spec.md. This script pins the fixed behavior.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # docs/qa/m0/x.py -> repo root
DEMO = ROOT / "webapp" / "public" / "demo" / "demo.stj.json"
VALIDATOR = ROOT / "tools" / "validate_stj.py"

# (name, mutator, expected first error code, extra expected substring or None)
PROBES = [
    ("rot360",          lambda d: d["placements"][0].update(rot_deg=360), "E_RANGE", "rot_deg"),
    ("rot-negative",    lambda d: d["placements"][0].update(rot_deg=-90), "E_RANGE", "rot_deg"),
    ("tz-missing",      lambda d: d["meta"].update(created_at="2026-10-11T12:00:00"), "E_TYPE", "timezone"),
    ("neg-coord",       lambda d: d["placements"][0].update(x_mm=-0.4), "E_RANGE", "x_mm"),
    ("qty-zero",        lambda d: d["groups"][0].update(qty=0), "E_RANGE", "qty"),
    ("qty-refdes-mismatch", lambda d: d["groups"][0].update(qty=3), "E_QTY", "len(refdes)"),
    ("dup-ref",         lambda d: d["placements"][1].update(ref="R1"), "E_DUP", "R1"),
    ("order-short",     lambda d: d.update(group_order_default=["g0", "g1", "g2", "g3"]), "E_QTY", "permutation"),
    ("coord-4decimals", lambda d: d["placements"][0].update(x_mm=12.1234), "E_DECIMALS", "decimal"),
    ("polarity-int",    lambda d: d["groups"][0].update(polarity=1), "E_TYPE", "boolean"),
    ("bool-pid",        lambda d: d["placements"][0].update(pid=True), "E_TYPE", "pid"),
    ("sides-incomplete", lambda d: d.update(sides=["top"]), "E_SIDES", "not declared"),
]


def main():
    demo = json.loads(DEMO.read_text(encoding="utf-8"))
    failures = []
    for name, mutate, want_code, want_sub in PROBES:
        d = json.loads(json.dumps(demo))
        mutate(d)
        p = Path(tempfile.gettempdir()) / f"m0-probe-{name}.json"
        p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        r = subprocess.run([sys.executable, str(VALIDATOR), str(p)],
                           capture_output=True, text=True, encoding="utf-8")
        errs = [l for l in r.stdout.splitlines() if l.startswith("ERROR")]
        ok = (r.returncode != 0 and errs
              and errs[0].startswith(f"ERROR {want_code}:") and want_sub in errs[0])
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: rc={r.returncode}"
              + (f" | {errs[0]}" if errs else " | no errors"))
        if not ok:
            failures.append(name)

    # warning-path probe: out-of-board landmark must warn but still exit 0
    d = json.loads(json.dumps(demo))
    d["meta"]["landmarks"][0]["x_mm"] = 50.0
    p = Path(tempfile.gettempdir()) / "m0-probe-landmark-out.json"
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    r = subprocess.run([sys.executable, str(VALIDATOR), str(p)],
                       capture_output=True, text=True, encoding="utf-8")
    warned = any(l.startswith("WARN W_LANDMARK") for l in r.stdout.splitlines())
    ok = r.returncode == 0 and warned
    print(f"[{'PASS' if ok else 'FAIL'}] landmark-outside-warns: rc={r.returncode} "
          f"W_LANDMARK={'yes' if warned else 'no'}")
    if not ok:
        failures.append("landmark-outside-warns")

    print()
    if failures:
        print(f"FAILED probes: {', '.join(failures)}")
        return 1
    print(f"ALL {len(PROBES) + 1} PROBES PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
