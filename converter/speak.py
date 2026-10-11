# -*- coding: utf-8 -*-
"""Speak atoms and footprint display names (plan section 10: speak 原子全部在
此生成). All rules deterministic so golden STJs are reproducible.
"""

import re

# Common size codes searched inside raw footprint names
# ("Resistor_SMD:R_0603_1608Metric" -> "0603", "Package_SO:TSSOP-8..." -> "TSSOP-8").
_SIZE_CODES = [
    "0402", "0603", "0805", "1206", "1210",
    "SOD-123", "SOD-323",
    "SOT-23-5", "SOT-23-6", "SOT-23", "SOT-223", "SOT-89",
    "SOIC-8", "SOIC-16", "TSSOP-8", "TSSOP-16", "TQFP-32", "QFN-16",
    "DIP-8", "DIP-16",
]
_KIND_CN = {
    "r": "电阻", "c": "电容", "l": "电感", "d": "二极管", "led": "发光二极管",
    "q": "三极管", "ic": "芯片", "conn": "接插件", "sw": "开关", "other": "器件",
}

# Rough height ranking for the default order (先矮后高). Values only need to
# rank plausibly; mm-ish numbers keep the table readable.
_HEIGHT_RULES = [
    ("0402", 0.5), ("0603", 0.6), ("0805", 0.8),
    ("1206", 1.0), ("1210", 1.2), ("sod-", 1.0),
    ("sot-23", 1.1), ("sot-89", 1.5), ("sot-223", 1.8),
    ("sot-23-5", 1.5), ("sot-23-6", 1.5),
    ("soic", 1.8), ("tssop", 1.2), ("qfn", 0.9), ("tqfp", 1.4),
    ("usb", 3.2), ("type-c", 3.2), ("conn", 5.0), ("terminal", 6.0),
    ("dip", 3.5), ("to-2", 4.5), ("radial", 6.5), ("elec", 6.5),
]
_DEFAULT_HEIGHT = 1.3


def footprint_display_name(raw: str) -> str:
    """Canonical footprint token: strip library prefix, prefer a known size code."""
    name = raw.strip()
    if ":" in name:
        name = name.split(":", 1)[1]
    upper = name.upper()
    for code in _SIZE_CODES:
        if code.upper() in upper:
            return code
    return name


def footprint_speak(kind: str, footprint: str) -> str:
    """Card line 2: how the footprint reads aloud."""
    cn = _KIND_CN.get(kind, "器件")
    return f"{footprint} {cn}"


def landmark_speak(ref: str) -> str:
    return f"{ref} 接插件"


def height_mm_of(footprint: str) -> float:
    fp = footprint.lower()
    for needle, h in _HEIGHT_RULES:
        if needle in fp:
            return h
    m = re.match(r"^[0-9]{4}$", fp)
    if m:  # unlisted chip code (e.g. 1008): rank between 0805 and 1206
        return 1.0
    return _DEFAULT_HEIGHT
