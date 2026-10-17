# -*- coding: utf-8 -*-
"""AI location phrases (M5 user request): precompute a spoken location hint
per placement with DeepSeek, baked into STJ as the incremental field
`loc_speak` (loader-ignorable). Follows the plan section 4 principle: language
atoms are computed on the PC at conversion time, so the phone stays offline
while welding.

Called only with --ai-loc; any failure is non-fatal (the app falls back to
the built-in nine-grid + landmark phrases).
"""

import ipaddress
import json
import re
import socket
import sys
import urllib.request
from urllib.parse import urlparse

ALLOWED_API_HOST = "api.deepseek.com"  # this module must only ever talk to DeepSeek
API_URL = f"https://{ALLOWED_API_HOST}/chat/completions"
MODEL = "deepseek-chat"
MAX_PHRASE = 24  # characters; announcements must stay short


_HARD_INTERNAL = [
    ipaddress.ip_network("127.0.0.0/8"), ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"), ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"), ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"), ipaddress.ip_network("fe80::/10"),
]


def _checked_url(url: str) -> str:
    """Protocol + host allowlist + resolved-IP boundary check (SSRF guard).
    The endpoint is a module constant; the guard keeps any future
    caller-supplied override from pointing at an internal service. Benchmark/
    fake-IP ranges (198.18.0.0/15, 2001:2::/48) are accepted because local
    proxy software in fake-IP DNS mode resolves EVERY name into them."""
    p = urlparse(url)
    if p.scheme != "https" or p.hostname != ALLOWED_API_HOST:
        raise ValueError(f"refusing non-DeepSeek endpoint: {url!r}")
    for info in socket.getaddrinfo(p.hostname, 443, proto=socket.IPPROTO_TCP):
        ip = ipaddress.ip_address(info[4][0])
        if any(ip in net for net in _HARD_INTERNAL):
            raise ValueError(f"resolved address {ip} is an internal address")
    return url


PROMPT_TMPL = """你是焊接助手的播报文案编辑。焊接的人一手拿烙铁一手拿镊子，需要听一句话就能在板子上找到当前器件的位置。

下面是一块板子的器件清单（坐标单位 mm，原点=板框左上角，y 轴向下）。请为每个 refdes 写一个口语化的位置描述，要求：

1. 不超过 14 个字；
2. 优先用邻居大件做参照（接插件、IC、电感、大电容），例如「MP8760 左侧」「大电感上方」；
3. 没有好邻居的用板面区域词，例如「靠右上角」「中偏左下」「上边缘中间」；
4. 用「左/右/上/下」时按清单坐标系说（y 向下就是图面的上下）；
5. 不要出现坐标数字；结尾不要标点；同一批描述不要雷同；
6. 只输出一个 JSON 对象，形如 {{"R1": "描述", "C2": "描述"}}，不要 markdown 代码块，不要任何解释。

[板框] {w} x {h} mm
[地标]
{landmarks}
[器件清单]
{items}"""


def _render_items(task):
    lines = []
    for pl in task["placements"]:
        g = next(g for g in task["groups"] if g["gid"] == pl["gid"])
        lines.append(
            f"{pl['ref']}  {g['value']}  {g['footprint']}  "
            f"({pl['x_mm']}, {pl['y_mm']})  {pl['side']}"
        )
    return "\n".join(lines)


def _render_landmarks(task):
    lms = task["meta"]["landmarks"]
    if not lms:
        return "（无）"
    return "\n".join(f"{lm['ref']} {lm['speak']} ({lm['x_mm']}, {lm['y_mm']})" for lm in lms)


def _parse_phrases(text, refs):
    """Tolerant JSON extraction: strip code fences, find the outermost object."""
    body = re.sub(r"```(?:json)?|```", "", text).strip()
    start, end = body.find("{"), body.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in model reply")
    data = json.loads(body[start : end + 1])
    out = {}
    for ref, phrase in data.items():
        if ref in refs and isinstance(phrase, str) and phrase.strip():
            out[ref] = phrase.strip()[:MAX_PHRASE]
    return out


def add_ai_locations(task, api_key: str, timeout: int = 180) -> int:
    """Fill placement['loc_speak'] via DeepSeek. Returns the count filled; any
    transport/parse problem degrades to zero phrases (non-fatal by design --
    the app falls back to its built-in nine-grid + landmark phrases)."""
    refs = [pl["ref"] for pl in task["placements"]]
    if not refs:
        return 0
    meta = task["meta"]
    prompt = PROMPT_TMPL.format(
        w=meta["board"]["width_mm"], h=meta["board"]["height_mm"],
        landmarks=_render_landmarks(task), items=_render_items(task),
    )
    payload = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
    }).encode("utf-8")
    _checked_url(API_URL)  # defense in depth: allowlist + resolved-IP boundary
    # direct connection + explicit UA: the Windows system proxy answers 401
    # for urllib traffic, and DeepSeek's edge bot-guard rejects the default
    # Python-urllib user agent ("governor")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions", data=payload, method="POST",
        headers={"Content-Type": "application/json",
                 "Accept": "application/json",
                 "User-Agent": "bom2task/1.0",
                 "Authorization": f"Bearer {api_key}"},
    )
    try:
        with opener.open(req, timeout=timeout) as resp:
            reply = json.loads(resp.read().decode("utf-8"))
        content = reply["choices"][0]["message"]["content"]
        phrases = _parse_phrases(content, set(refs))
    except Exception as e:  # noqa: BLE001 -- designed degradation path
        print(f"ai-loc: DeepSeek call failed, falling back to built-in phrases ({e})",
              file=sys.stderr)
        return 0
    filled = 0
    for pl in task["placements"]:
        phrase = phrases.get(pl["ref"])
        if phrase:
            pl["loc_speak"] = phrase
            filled += 1
    return filled
