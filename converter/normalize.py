# -*- coding: utf-8 -*-
"""Value normalization (plan section 10).

Resistors:  4k7 / 10KΩ / 10000 -> 10k ; 2R2 -> 2.2Ω ; 0R -> 0Ω jumper
Capacitors: 104 -> 100nF ; 100nF ; 10uF -> 10µF ; 10mF vs 10MF (milli vs mega)
Inductors:  10uH -> 10µH ; bare number -> µH
Case rule: lowercase m = milli, uppercase M = mega (10mF != 10MF).
Dual values like 100nF(104): canonical value from the primary form, the
parenthesized silkscreen code is folded into value_speak.

Canonical strings keep the unit suffix (10k, 2.2Ω, 100nF, 10µF); speak strings
expand to Chinese units (千欧/兆欧/欧, 皮法/纳法/微法/毫法, 微亨/毫亨...).
"""

import re
from dataclasses import dataclass


@dataclass
class Norm:
    value: str
    speak: str
    ok: bool  # False -> raw value kept, listed by --check
    alt: str | None = None  # silkscreen code from dual notation, if any


_DUAL_RE = re.compile(r"^(.*?)\s*[（(](.+?)[）)]\s*$")
_NUM = r"\d+(?:\.\d+)?"

# ---------------------------------------------------------------- resistors

_RES_SUFFIX_MULT = {"k": 1e3, "K": 1e3, "m": 1e-3, "M": 1e6}


def _res_display(ohms: float) -> tuple:
    if ohms >= 1e6:
        return (f"{_g(ohms / 1e6)}M", f"{_g(ohms / 1e6)}兆欧")
    if ohms >= 1e3:
        return (f"{_g(ohms / 1e3)}k", f"{_g(ohms / 1e3)}千欧")
    return (f"{_g(ohms)}Ω", f"{_g(ohms)}欧")


def _norm_resistor(text: str) -> Norm | None:
    s = text.replace("Ω", "").replace("ω", "").replace("ohm", "").replace("Ohm", "").strip()
    # R as decimal point: 2R2 / 0R1 / 0R / 10R
    m = re.fullmatch(rf"({_NUM})R(\d*)", s)
    if m:
        ohms = float(m.group(1)) + (float("0." + m.group(2)) if m.group(2) else 0.0)
        value, speak = _res_display(ohms)
        return Norm(value, speak, True)
    # letter as decimal point: 4k7 / 1M0
    m = re.fullmatch(rf"({_NUM})\s*([kKmM])(\d+)", s)
    if m:
        mult = _RES_SUFFIX_MULT[m.group(2)]
        ohms = float(m.group(1)) * mult + float("0." + m.group(3)) * mult
        value, speak = _res_display(ohms)
        return Norm(value, speak, True)
    # plain suffix: 10k / 10K / 4M / 10m (milliohm)
    m = re.fullmatch(rf"({_NUM})\s*([kKmM])", s)
    if m:
        ohms = float(m.group(1)) * _RES_SUFFIX_MULT[m.group(2)]
        value, speak = _res_display(ohms)
        return Norm(value, speak, True)
    # bare number = ohms (10000 -> 10k)
    if re.fullmatch(_NUM, s):
        value, speak = _res_display(float(s))
        return Norm(value, speak, True)
    return None


# --------------------------------------------------------------- capacitors

_CAP_MULT = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "M": 1e6}


def _cap_display(farads: float) -> tuple:
    if farads >= 1e6:
        return (f"{_g(farads / 1e6)}MF", f"{_g(farads / 1e6)}兆法")
    if farads >= 1:
        return (f"{_g(farads)}F", f"{_g(farads)}法")
    if farads >= 1e-3:
        return (f"{_g(farads / 1e-3)}mF", f"{_g(farads / 1e-3)}毫法")
    if farads >= 1e-6:
        return (f"{_g(farads / 1e-6)}µF", f"{_g(farads / 1e-6)}微法")
    if farads >= 1e-9:
        return (f"{_g(farads / 1e-9)}nF", f"{_g(farads / 1e-9)}纳法")
    return (f"{_g(farads / 1e-12)}pF", f"{_g(farads / 1e-12)}皮法")


def _norm_capacitor(text: str) -> Norm | None:
    s = text.strip()
    # letter as decimal point: 4p7 / 1u0
    m = re.fullmatch(rf"({_NUM})\s*([pnuµμmM])(\d+)", s)
    if m:
        mult = _CAP_MULT[m.group(2)]
        farads = float(m.group(1)) * mult + float("0." + m.group(3)) * mult
        value, speak = _cap_display(farads)
        return Norm(value, speak, True)
    # letter-coded values: 100n / 10u / 10µ / 22p / 10m / 10M, optional F
    m = re.fullmatch(rf"({_NUM})\s*([pnuµμmM])\s*F?", s)
    if m:
        farads = float(m.group(1)) * _CAP_MULT[m.group(2)]
        value, speak = _cap_display(farads)
        return Norm(value, speak, True)
    # digit code: 104 -> 10*10^4 pF = 100nF ; 22 -> 22pF ; 100 -> 10*10^0 pF = 10pF
    if re.fullmatch(r"\d{1,2}", s):
        farads = float(s) * 1e-12
        value, speak = _cap_display(farads)
        return Norm(value, speak, True)
    if re.fullmatch(r"\d{3}", s):
        farads = int(s[:2]) * (10.0 ** int(s[2])) * 1e-12
        value, speak = _cap_display(farads)
        return Norm(value, speak, True)
    return None


# ---------------------------------------------------------------- inductors

_IND_MULT = {"n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "M": 1.0}


def _ind_display(henry: float) -> tuple:
    if henry < 1e-6:
        return (f"{_g(henry / 1e-9)}nH", f"{_g(henry / 1e-9)}纳亨")
    if henry < 1e-3:
        return (f"{_g(henry / 1e-6)}µH", f"{_g(henry / 1e-6)}微亨")
    if henry < 1:
        return (f"{_g(henry / 1e-3)}mH", f"{_g(henry / 1e-3)}毫亨")
    return (f"{_g(henry)}H", f"{_g(henry)}亨")


def _norm_inductor(text: str) -> Norm | None:
    s = text.strip()
    # letter as decimal point: 4u7 -> 4.7µH
    m = re.fullmatch(rf"({_NUM})\s*([nuµμmM])(\d+)", s)
    if m:
        mult = _IND_MULT[m.group(2)]
        henry = float(m.group(1)) * mult + float("0." + m.group(3)) * mult
        value, speak = _ind_display(henry)
        return Norm(value, speak, True)
    m = re.fullmatch(rf"({_NUM})\s*([nuµμmM])\s*H?", s)
    if m:
        henry = float(m.group(1)) * _IND_MULT[m.group(2)]
        value, speak = _ind_display(henry)
        return Norm(value, speak, True)
    m = re.fullmatch(rf"({_NUM})", s)
    if m:  # bare number on an inductor reads as microhenries (documented rule)
        value, speak = _ind_display(float(s) * 1e-6)
        return Norm(value, speak, True)
    return None


def _g(x: float) -> str:
    """Format without trailing zeros: 4.70 -> '4.7', 100.0 -> '100'."""
    s = f"{x:.6f}".rstrip("0").rstrip(".")
    return s if s else "0"


# ------------------------------------------------------------------- public

def kind_of_refdes(ref: str) -> str:
    head = re.match(r"^([A-Za-z]+)", ref or "")
    return (head.group(1).upper() if head else "")[:1]


def normalize_value(raw: str, kind: str) -> Norm:
    """Normalize a part value for its kind. Non-R/C/L kinds pass through raw."""
    text = (raw or "").strip()
    if not text:
        return Norm("", "", False)

    alt = None
    primary = text
    m = _DUAL_RE.match(text)
    if m:
        primary, alt = m.group(1).strip(), m.group(2).strip()

    norm = None
    if kind == "r":
        norm = _norm_resistor(primary)
    elif kind == "c":
        norm = _norm_capacitor(primary)
    elif kind == "l":
        norm = _norm_inductor(primary)
    if norm is None:
        # non-RLC kinds (ic/conn/led values like "ME6211", "USB-C") pass through
        if kind in ("r", "c", "l"):
            return Norm(text, text, False, alt)
        norm = Norm(primary, primary, True)

    if alt:
        norm = Norm(norm.value, f"{norm.speak}（{alt}）", norm.ok, alt)
    return norm
