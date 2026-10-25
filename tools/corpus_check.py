#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Expanded board corpus check (2026-10-24, see docs/qa/corpus-2026-10-24.md).

Converts every corpus board with bom2task, validates the STJ, and cross-checks
orientation against kicad-cli's own pick-and-place table (reuses the comparison
functions of tools/verify_orient.py). 57 boards as of 2026-10-24:
  - 18 KiCad official demos + 19 templates (D:\\KiCad\\10.0)
  - 11 local real projects (E: archive / Desktop / WeChat files)
  - 7 GitHub open-hardware boards (shallow clones under build/more-boards/ext)
  - 3 JLC production CSV versions (2dgimbal v1.0 / v1.1 / v1.3)
Expected outcome: 50 converted+validated, 7 clean refusals (2 files without a
usable Edge.Cuts outline, 5 boards with zero solderable parts).

Usage:  python tools/corpus_check.py     (writes build/more-boards/results.json)
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import verify_orient as vo  # noqa: E402  (check()/check_jlc(), KICAD_CLI)

OUT = ROOT / "build" / "more-boards"
OUT.mkdir(parents=True, exist_ok=True)
VALIDATOR = ROOT / "tools" / "validate_stj.py"

K = r"D:\KiCad\10.0\share\kicad"
DEMOS = K + r"\demos"
TPL = K + r"\template"
EXT = OUT / "ext"

KICAD_BOARDS = {
    # -- KiCad official demos (mixed eras/formats) --
    "demo-video": DEMOS + r"\video\video.kicad_pcb",
    "demo-ecc83-pp": DEMOS + r"\ecc83\ecc83-pp.kicad_pcb",
    "demo-ecc83-pp-v2": DEMOS + r"\ecc83\ecc83-pp_v2.kicad_pcb",
    "demo-interf_u": DEMOS + r"\interf_u\interf_u.kicad_pcb",
    "demo-stickhub": DEMOS + r"\stickhub\StickHub.kicad_pcb",
    "demo-vme-wren": DEMOS + r"\vme-wren\vme-wren.kicad_pcb",
    "demo-microwave": DEMOS + r"\microwave\microwave.kicad_pcb",
    "demo-cm5-minima": DEMOS + r"\cm5_minima\CM5_MINIMA_3.kicad_pcb",
    "demo-openair-max": DEMOS + r"\openair-max\One-Air-Max.kicad_pcb",
    "demo-sonde-xilinx": DEMOS + r"\sonde xilinx\sonde xilinx.kicad_pcb",
    "demo-pic-programmer": DEMOS + r"\pic_programmer\pic_programmer.kicad_pcb",
    "demo-tinytapeout": DEMOS + r"\tiny_tapeout\tinytapeout-demo.kicad_pcb",
    "demo-multichannel": DEMOS + r"\multichannel\multichannel_mixer.kicad_pcb",
    "demo-complex-hierarchy": DEMOS + r"\complex_hierarchy\complex_hierarchy.kicad_pcb",
    "demo-royalblue54l": DEMOS + r"\royalblue54L_feather\RoyalBlue54L-Feather.kicad_pcb",
    "demo-coldfire-xilinx": DEMOS + r"\kit-dev-coldfire-xilinx_5213\kit-dev-coldfire-xilinx_5213.kicad_pcb",
    "demo-jetson-agx-thor": DEMOS + r"\jetson-agx-thor-baseboard\jetson-agx-thor-baseboard.kicad_pcb",
    # -- KiCad templates --
    "tpl-arduino-uno": TPL + r"\Arduino_Uno\Arduino_Uno.kicad_pcb",
    "tpl-arduino-mega": TPL + r"\Arduino_Mega\Arduino_Mega.kicad_pcb",
    "tpl-arduino-nano": TPL + r"\Arduino_Nano\Arduino_Nano.kicad_pcb",
    "tpl-arduino-micro": TPL + r"\Arduino_Micro\Arduino_Micro.kicad_pcb",
    "tpl-arduino-pro-mini": TPL + r"\Arduino_Pro_Mini\Arduino_Pro_Mini.kicad_pcb",
    "tpl-stm32h7-devebox": TPL + r"\STM32H7_DevEBox\DevEBox.kicad_pcb",
    "tpl-api-series-500": TPL + r"\API_Series-500\API_Series-500.kicad_pcb",
    "tpl-rpi-hat": TPL + r"\RaspberryPi-HAT\RaspberryPi-HAT.kicad_pcb",
    "tpl-rpi-uhat": TPL + r"\RaspberryPi-uHAT\RaspberryPi-uHAT.kicad_pcb",
    "tpl-eurocard": TPL + r"\EuroCard160mmX100mm\EuroCard160mmX100mm.kicad_pcb",
    "tpl-bbb-cape": TPL + r"\BeagleBone-Black-Cape\BeagleBone-Black-Cape.kicad_pcb",
    "tpl-nucleo64-morpho": TPL + r"\STM32_Nucleo-64_Morpho\STM_Nucleo64_Morpho.kicad_pcb",
    "tpl-hammond-1593k": TPL + r"\Hammond_1593K_Enclosure\Hammond_1593K_Enclosure.kicad_pcb",
    "tpl-edgeberry-cart": TPL + r"\Edgeberry_Cartridge\Edgeberry_cartridge_template.kicad_pcb",
    "tpl-ti-launchpad-20": TPL + r"\TI-LaunchPad-BoosterPack-20pin\TI-LaunchPad-BoosterPack-20pin.kicad_pcb",
    "tpl-ti-launchpad-40": TPL + r"\TI-LaunchPad-BoosterPack-40pin\TI-LaunchPad-BoosterPack-40pin.kicad_pcb",
    "tpl-stm32f100-shield": TPL + r"\stm32f100-discovery-shield\stm32f100-discovery-shield.kicad_pcb",
    "tpl-mr-large-parts": TPL + r"\KiCad_MR_diagrams_large_parts\mr_diagrams_large_parts.kicad_pcb",
    "tpl-mr-small-parts": TPL + r"\KiCad_MR_diagrams_small_parts\mr_diagrams_small_parts.kicad_pcb",
    # -- local real projects --
    "real-jetson-orin-baseboard": r"E:\archive\RM2026赛季\jetson-orin-baseboard\jetson-orin-baseboard.kicad_pcb",
    "real-rm2025-portable-armor": r"E:\downloads\RM2025-Portable-Armor-main\RM2025-Portable-Armor-main\Hardware\RM2025-Portable-Armor.kicad_pcb",
    "real-cantact": r"E:\archive\RM2026赛季\canable\cantact-hw\cantact.kicad_pcb",
    "real-tiny-screen": r"D:\Users\Administrator\Desktop\活跃项目\banzi\tiny-screen.kicad_pcb",
    "real-yis130-pre": r"D:\Users\Administrator\Desktop\活跃项目\banzi\yis130-hardware-pre.kicad_pcb",
    "real-yis130": r"D:\Users\Administrator\Desktop\活跃项目\banzi\ys106-imu-hardware-main-\yis130-hardware.kicad_pcb",
    "real-rs-hpm-rdc": r"D:\Users\Administrator\Desktop\活跃项目\banzi\hpm_apps\apps\rdc\hardware\hardware_project\RS.kicad_pcb",
    "real-baseboard-wechat": r"D:\Users\Administrator\xwechat_files\wxid_ho47iv0tdq0d12_90b7\msg\file\2026-06\baseboard(1).kicad_pcb",
    "real-2dgimbal-main": r"E:\archive\未分类\2d-gimbal-board\hardware\2dgimbal\2dgimbal-main.kicad_pcb",
    "real-2dgimbal-sub": r"E:\archive\未分类\2d-gimbal-board\hardware\2dgimbal\2dgimbal-sub.kicad_pcb",
    "real-electrical-trigger": r"E:\archive\未分类\MP8760_electric_PLUG\MP8760_electric_PLUG\project\hardware\kicad_part\electrical-trigger.kicad_pcb",
    # -- GitHub open hardware (shallow clones) --
    "gh-esp-rust-board": str(EXT / r"esp-rust-board\hardware\esp-rust-board\esp-rust-board.kicad_pcb"),
    "gh-thelio-io": str(EXT / r"thelio-io-hardware\pcb-thelio-io\thelio-io.kicad_pcb"),
    "gh-thelio-nebula-io": str(EXT / r"thelio-io-hardware\pcb-nebula-io\nebula-io.kicad_pcb"),
    "gh-thelio-io-sata": str(EXT / r"thelio-io-hardware\pcb-thelio-io-sata\thelio-io-sata.kicad_pcb"),
    "gh-ultrapif-led": str(EXT / r"UltraPIF_Hardware\led\led.kicad_pcb"),
    "gh-ultrapif-adapter": str(EXT / r"UltraPIF_Hardware\pif_adapter\pif_adapter.kicad_pcb"),
    "gh-ultrapif-fpga": str(EXT / r"UltraPIF_Hardware\pif_fpga\pif_fpga.kicad_pcb"),
}

JLC_POS = r"E:\archive\未分类\2d-gimbal-board\hardware\2dgimbal\production"
JLC_BOARDS = {
    "jlc-2dgimbal-v1.0": JLC_POS + r"\2dgimbal_v1.0_positions.csv",
    "jlc-2dgimbal-v1.1": JLC_POS + r"\2dgimbal_v1.1_positions.csv",
    "jlc-2dgimbal-v1.3": JLC_POS + r"\2dgimbal_v1.3_positions.csv",
}


def convert_validate(name: str, args: list) -> dict:
    out = OUT / f"{name}.stj.json"
    proc = subprocess.run([sys.executable, str(vo.CLI), *args, "-o", str(out)],
                          capture_output=True, text=True, timeout=300)
    res = {"convert_rc": proc.returncode}
    if proc.returncode != 0:
        lines = [l for l in (proc.stderr or proc.stdout or "").strip().splitlines() if l.strip()]
        res["convert_err"] = lines[-1:] or ["(no output)"]
        return res
    v = subprocess.run([sys.executable, str(VALIDATOR), str(out)],
                       capture_output=True, text=True, timeout=120)
    res["validate_rc"] = v.returncode
    stats = [l for l in (v.stdout or "").splitlines() if l.startswith("STATS")]
    res["stats"] = stats[0] if stats else ""
    if v.returncode != 0:
        res["validate_err"] = [l for l in (v.stdout or "").splitlines() if l.startswith("ERROR")][:3]
    return res


def run_kicad(name: str, pcb: str) -> dict:
    res = {"board": name, "path": str(pcb), "kind": "kicad"}
    if not Path(pcb).exists():
        res.update(convert_rc=-1, convert_err=["file missing"])
        return res
    res.update(convert_validate(name, [pcb, "--format", "kicad"]))
    if res.get("convert_rc") == 0 and res.get("validate_rc") == 0:
        try:
            problems = vo.check(name, Path(pcb))
            res["orient_mismatches"] = len([p for p in problems if p.startswith(name + "/")])
            res["orient_problems"] = problems[:5]
        except Exception as e:  # noqa: BLE001 -- corpus harness must keep going
            res["orient_error"] = f"{type(e).__name__}: {str(e)[:200]}"
    return res


def run_jlc(name: str, pos: str) -> dict:
    bom = pos.replace("_positions.csv", "_bom.csv")
    res = {"board": name, "path": str(pos), "kind": "jlc"}
    if not Path(pos).exists() or not Path(bom).exists():
        res.update(convert_rc=-1, convert_err=["file missing"])
        return res
    res.update(convert_validate(name, [pos, "-b", bom, "--format", "jlc"]))
    if res.get("convert_rc") == 0 and res.get("validate_rc") == 0:
        try:
            problems = vo.check_jlc(name, pos, bom, pos)
            res["orient_mismatches"] = len([p for p in problems if p.startswith(name + "/")])
            res["orient_problems"] = problems[:5]
        except Exception as e:  # noqa: BLE001
            res["orient_error"] = f"{type(e).__name__}: {str(e)[:200]}"
    return res


def main() -> int:
    results = []
    for name, pcb in KICAD_BOARDS.items():
        print(f"== {name}", flush=True)
        results.append(run_kicad(name, pcb))
    for name, pos in JLC_BOARDS.items():
        print(f"== {name}", flush=True)
        results.append(run_jlc(name, pos))
    (OUT / "results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = sum(1 for r in results if r.get("convert_rc") == 0 and r.get("validate_rc") == 0)
    print(f"corpus: {ok}/{len(results)} converted+validated")
    for r in results:
        flag = "OK " if r.get("convert_rc") == 0 and r.get("validate_rc") == 0 else "REFUSE"
        extra = r.get("stats") or (r.get("convert_err") or [""])[0]
        print(f"[{flag}] {r['board']:<28} {extra[:90]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
