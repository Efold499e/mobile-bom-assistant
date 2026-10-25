#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Orientation ground-truth check (M5 user-feedback round).

Compares bom2task's STJ placements against KiCad's own `kicad-cli pcb export
pos` output (the authoritative pick-and-place table) for the SAME board:
- rotation must match exactly (mod 360)
- side must match (kicad 'top/bottom' vs STJ 'top/bottom')
- position must match after fitting one constant rebase offset (kicad-cli uses
  the drill/grid origin, the STJ uses the outline top-left)

Exit code 0 = all boards agree. Any mismatch prints and fails.
"""

import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "converter" / "bom2task.py"
KICAD_CLI = r"D:\KiCad\10.0\bin\kicad-cli.exe"

BOARDS = [
    ("electrical-trigger", r"E:\archive\未分类\MP8760_electric_PLUG\MP8760_electric_PLUG\project\hardware\kicad_part\electrical-trigger.kicad_pcb"),
    ("cantact", r"E:\archive\RM2026赛季\canable\cantact-hw\cantact.kicad_pcb"),
    ("tiny-screen", r"D:\Users\Administrator\Desktop\活跃项目\banzi\tiny-screen.kicad_pcb"),
    # 2026-10-24 corpus round: new real boards (see docs/qa/corpus-2026-10-24.md)
    ("jetson-orin-baseboard", r"E:\archive\RM2026赛季\jetson-orin-baseboard\jetson-orin-baseboard.kicad_pcb"),
    ("rm2025-portable-armor", r"E:\downloads\RM2025-Portable-Armor-main\RM2025-Portable-Armor-main\Hardware\RM2025-Portable-Armor.kicad_pcb"),
    ("yis130-pre", r"D:\Users\Administrator\Desktop\活跃项目\banzi\yis130-hardware-pre.kicad_pcb"),
    ("yis130", r"D:\Users\Administrator\Desktop\活跃项目\banzi\ys106-imu-hardware-main-\yis130-hardware.kicad_pcb"),
    ("rs-hpm-rdc", r"D:\Users\Administrator\Desktop\活跃项目\banzi\hpm_apps\apps\rdc\hardware\hardware_project\RS.kicad_pcb"),
    ("baseboard-wechat", r"D:\Users\Administrator\xwechat_files\wxid_ho47iv0tdq0d12_90b7\msg\file\2026-06\baseboard(1).kicad_pcb"),
    ("2dgimbal-main", r"E:\archive\未分类\2d-gimbal-board\hardware\2dgimbal\2dgimbal-main.kicad_pcb"),
    ("2dgimbal-sub", r"E:\archive\未分类\2d-gimbal-board\hardware\2dgimbal\2dgimbal-sub.kicad_pcb"),
    # GitHub open hardware (shallow-cloned under build/more-boards/ext)
    ("gh-esp-rust-board", r"build\more-boards\ext\esp-rust-board\hardware\esp-rust-board\esp-rust-board.kicad_pcb"),
    ("gh-thelio-io", r"build\more-boards\ext\thelio-io-hardware\pcb-thelio-io\thelio-io.kicad_pcb"),
    ("gh-ultrapif-fpga", r"build\more-boards\ext\UltraPIF_Hardware\pif_fpga\pif_fpga.kicad_pcb"),
]

# JLC: compare the converted STJ against the placement CSV it came from.
# CSV is y-up bottom-origin -> x differs by a constant, y sums to a constant;
# rotation must match exactly (top pass-through, M5 fix).
JLC_BOARDS = [
    ("2dgimbal-v10",
     r"E:\archive\未分类\2d-gimbal-board\hardware\2dgimbal\production\2dgimbal_v1.0_positions.csv"),
    ("2dgimbal-v11",
     r"E:\archive\未分类\2d-gimbal-board\hardware\2dgimbal\production\2dgimbal_v1.1_positions.csv"),
    ("2dgimbal-v13",
     r"E:\archive\未分类\2d-gimbal-board\hardware\2dgimbal\production\2dgimbal_v1.3_positions.csv"),
]


def check_jlc(name, xy, bom, xy_again):
    problems = []
    out = Path(tempfile.gettempdir()) / f"vo_{name}.stj.json"
    proc = subprocess.run([sys.executable, str(CLI), xy, "-b", bom, "-o", str(out),
                           "--format", "jlc"], capture_output=True, text=True)
    if proc.returncode != 0:
        return [f"{name}: converter failed: {proc.stderr[:300]}"]
    stj = json.loads(out.read_text(encoding="utf-8"))
    mine = {p["ref"]: (p["x_mm"], p["y_mm"], p["rot_deg"] % 360.0) for p in stj["placements"]}
    rows = {}
    with open(xy_again, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            ref = row["Designator"].strip()
            if ref:
                rows[ref] = (float(row["Mid X"]), float(row["Mid Y"]),
                             float(row["Rotation"]) % 360.0)
    common = set(rows) & set(mine)
    if not common:
        return [f"{name}: no common refs"]
    first = sorted(common)[0]
    dx = mine[first][0] - rows[first][0]
    dy = mine[first][1] + rows[first][1]
    for ref in sorted(common):
        cx, cy, crot = rows[ref]
        mx, my, mrot = mine[ref]
        if abs((mx - dx) - cx) > 0.02 or abs((my + cy) - dy) > 0.02:
            problems.append(f"{name}/{ref}: pos mismatch mine=({mx},{my}) csv=({cx},{cy})")
        drot = min((mrot - crot) % 360.0, (crot - mrot) % 360.0)
        if drot > 0.01:
            problems.append(f"{name}/{ref}: ROT mismatch mine={mrot} csv={crot}")
    print(f"{name}: {len(common)} refs checked, "
          f"{sum(1 for p in problems if p.startswith(name + '/'))} mismatches")
    return problems


def kicad_pos(pcb: Path):
    out = Path(tempfile.gettempdir()) / f"kpos_{pcb.stem}.csv"
    subprocess.run([KICAD_CLI, "pcb", "export", "pos", str(pcb), "--format", "csv",
                    "--units", "mm", "--output", str(out)], check=True,
                   capture_output=True, text=True)
    rows = {}
    with open(out, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            rows[row["Ref"]] = (float(row["PosX"]), float(row["PosY"]),
                                float(row["Rot"]) % 360.0, row["Side"].lower())
    return rows


def check(name: str, pcb: Path) -> list:
    problems = []
    truth = kicad_pos(pcb)
    out = Path(tempfile.gettempdir()) / f"vo_{name}.stj.json"
    proc = subprocess.run([sys.executable, str(CLI), str(pcb), "-o", str(out),
                           "--format", "kicad"], capture_output=True, text=True)
    if proc.returncode != 0:
        return [f"{name}: converter failed: {proc.stderr[:300]}"]
    stj = json.loads(out.read_text(encoding="utf-8"))
    mine = {p["ref"]: (p["x_mm"], p["y_mm"], p["rot_deg"] % 360.0, p["side"])
            for p in stj["placements"]}

    common = set(truth) & set(mine)
    if not common:
        return [f"{name}: no common refs with kicad-cli output"]
    # kicad-cli pos is a pick-and-place table: y UP (mirrored vs the file's
    # y-down frame). So x differs by one constant, and y SUMS to a constant:
    #   stj_x - truth_x = dx   and   stj_y + truth_y = dy
    ref0 = sorted(common)[0]
    dx = mine[ref0][0] - truth[ref0][0]
    dy = mine[ref0][1] + truth[ref0][1]
    for ref in sorted(common):
        tx, ty, trot, tside = truth[ref]
        mx, my, mrot, mside = mine[ref]
        if abs((mx - dx) - tx) > 0.01 or abs((my + ty) - dy) > 0.01:
            problems.append(f"{name}/{ref}: pos mismatch mine=({mx},{my}) "
                            f"truth=({tx},{ty}) dx={dx:.3f} ysum={my + ty:.3f} (expect {dy:.3f})")
        drot = min((mrot - trot) % 360.0, (trot - mrot) % 360.0)
        if drot > 0.01:
            problems.append(f"{name}/{ref}: ROT mismatch mine={mrot} truth={trot}")
        if mside != tside:
            problems.append(f"{name}/{ref}: side mismatch mine={mside} truth={tside}")
    print(f"{name}: {len(common)} refs checked, "
          f"{sum(1 for p in problems if p.startswith(name + '/'))} mismatches, "
          f"dx={dx:.3f} ysum={dy:.3f}")
    return problems


def main() -> int:
    problems = []
    for name, pcb in BOARDS:
        p = Path(pcb)
        if not p.is_absolute():
            p = ROOT / p
        problems += check(name, p)
    for name, pos in JLC_BOARDS:
        bom = pos.replace("_positions.csv", "_bom.csv")
        problems += check_jlc(name, pos, bom, pos)
    for p in problems:
        print("MISMATCH:", p)
    print("RESULT:", "FAIL" if problems else "ALL AGREE")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
