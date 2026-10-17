#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bom2task -- convert KiCad / JLC CSV / iBOM board files to STJ v1.

Usage:
  python converter/bom2task.py BOARD.kicad_pcb -o out.stj.json [--check]
  python converter/bom2task.py BOARD.pcbdata.json -o out.stj.json [--check]
  python converter/bom2task.py xy.csv -b bom.csv -o out.stj.json [--check]

Stdlib only. --check prints the bag-count sanity sheet (counts per group,
anomalous values, excluded parts) on top of the normal conversion.
"""

import argparse
import datetime
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from model import build_task  # noqa: E402
from ai_loc import add_ai_locations  # noqa: E402
from parsers import ibom as ibom_parser  # noqa: E402
from parsers import jlc as jlc_parser  # noqa: E402
from parsers import kicad as kicad_parser  # noqa: E402

FORMATS = ("kicad", "jlc", "ibom")


def detect_format(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".kicad_pcb":
        return "kicad"
    if suffix == ".json":
        return "ibom"
    if suffix == ".csv":
        return "jlc"
    raise SystemExit(f"cannot infer format from {path.name}; use --format")


def convert(fmt: str, input_path: Path, bom_path: Path | None,
            project: str, created_at: str):
    if fmt == "kicad":
        parts, outline = kicad_parser.parse_file(str(input_path))
        return build_task(parts, outline, "kicad", project, created_at)
    if fmt == "ibom":
        parts, outline = ibom_parser.parse_file(str(input_path))
        return build_task(parts, outline, "ibom", project, created_at)
    if fmt == "jlc":
        parts, outline, flip = jlc_parser.parse_file(
            str(input_path), str(bom_path) if bom_path else None)
        return build_task(parts, outline, "jlc", project, created_at,
                          flip_y_about=flip)
    raise SystemExit(f"unknown format {fmt}")


def print_check(task: dict, diag: dict) -> None:
    meta = task["meta"]
    n_polarity = sum(g["qty"] for g in task["groups"] if g["polarity"])
    print("--check ------------------------------")
    print(f"project    : {meta['project']} (source {meta['source']})")
    print(f"board      : {meta['board']['width_mm']} x {meta['board']['height_mm']} mm, "
          f"{len(task['meta']['landmarks'])} landmark(s)")
    print(f"placements : {len(task['placements'])}  groups: {len(task['groups'])}  "
          f"polarity: {n_polarity}  sides: {'/'.join(task['sides'])}")
    print("groups (default order, count the bags against this):")
    by_gid = {g["gid"]: g for g in task["groups"]}
    for gid in task["group_order_default"]:
        g = by_gid[gid]
        pol = " [polarity]" if g["polarity"] else ""
        print(f"  {gid}: {g['qty']:>3} x {g['value']}  ({g['footprint']}{pol})")
    if diag["anomalies"]:
        print("anomalous values (kept raw, check against the bag):")
        for a in diag["anomalies"]:
            print(f"  {a}")
    if diag["excluded"]:
        print(f"excluded parts: {len(diag['excluded'])}")
        for e in diag["excluded"]:
            print(f"  {e}")
    print("--------------------------------------")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Convert board files to STJ v1.")
    ap.add_argument("input", help=".kicad_pcb | pcbdata.json | placement CSV")
    ap.add_argument("-b", "--bom", help="BOM CSV (JLC only)")
    ap.add_argument("-o", "--output", help="output .stj.json path (default: stdout)")
    ap.add_argument("--format", choices=FORMATS, help="override format detection")
    ap.add_argument("--name", help="project name (default: input file stem)")
    ap.add_argument("--check", action="store_true", help="print the sanity sheet")
    ap.add_argument("--now", dest="now", help="ISO created_at override (tests)")
    ap.add_argument("--ai-loc", action="store_true",
                    help="precompute spoken location hints with DeepSeek "
                         "(needs DEEPSEEK_API_KEY env or --api-key; offline fallback)")
    ap.add_argument("--api-key", help="DeepSeek API key (else DEEPSEEK_API_KEY env)")
    args = ap.parse_args(argv)

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"input not found: {input_path}", file=sys.stderr)
        return 2
    fmt = args.format or detect_format(input_path)
    created_at = args.now or datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    project = args.name or input_path.stem

    try:
        task, diag = convert(fmt, input_path, Path(args.bom) if args.bom else None,
                             project, created_at)
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        print(f"conversion failed: {e}", file=sys.stderr)
        return 2

    if args.ai_loc:
        import os
        key = args.api_key or os.environ.get("DEEPSEEK_API_KEY") or ""
        if not key:
            print("ai-loc: no API key (--api-key or DEEPSEEK_API_KEY), skipping",
                  file=sys.stderr)
        else:
            filled = add_ai_locations(task, key)
            print(f"ai-loc: {filled}/{len(task['placements'])} location hints baked in")

    stats = (f"bom2task: {len(task['placements'])} placements / {len(task['groups'])} groups / "
             f"{sum(g['qty'] for g in task['groups'] if g['polarity'])} polarity / "
             f"{'/'.join(task['sides'])}")
    print(stats)
    if args.check:
        print_check(task, diag)

    payload = json.dumps(task, ensure_ascii=False, indent=2)
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload + "\n", encoding="utf-8")
        print(f"written: {out}")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
