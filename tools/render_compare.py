#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render-compare: draw the STJ (copper pads, silkscreen, outline) with Pillow
-- an independent Gerber-style ground truth -- and place it beside the app's
own fullscreen render for visual consistency checks (M5 user demand).

Usage: python tools/render_compare.py examples/boardA.stj.json app_screen.png out.png
       (app_screen.png = emulator screenshot; the map area is auto-cropped to
        the largest dark rectangle on the left half)
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

PX_PER_MM = 10
PAD = 6  # mm margin


def render_stj(stj_path: str) -> Image.Image:
    data = json.loads(Path(stj_path).read_text(encoding="utf-8"))
    board = data["meta"]["board"]
    w, h = board["width_mm"], board["height_mm"]
    W, H = int((w + 2 * PAD) * PX_PER_MM), int((h + 2 * PAD) * PX_PER_MM)
    img = Image.new("RGB", (W, H), (10, 13, 16))  # mask / background
    dr = ImageDraw.Draw(img)

    def X(x):  # board mm -> image px
        return int((x + PAD) * PX_PER_MM)

    def Y(y):
        return int((y + PAD) * PX_PER_MM)

    # board area (mask tone)
    dr.rectangle([X(0), Y(0), X(w), Y(h)], fill=(22, 30, 26))
    # outline
    dr.line([ (X(px), Y(py)) for px, py in board["outline"] ] +
            [(X(board["outline"][0][0]), Y(board["outline"][0][1]))],
            fill=(140, 160, 150), width=2)

    copper = (198, 158, 90)
    silk = (222, 228, 234)
    for pl in data["placements"]:
        cx, cy = pl["x_mm"], pl["y_mm"]
        rot = pl["rot_deg"]
        rad = rot * math.pi / 180.0
        cos_r, sin_r = math.cos(rad), math.sin(rad)

        def to_board(lx, ly):  # local -> board (KiCad CCW in y-down)
            return (cx + lx * cos_r + ly * sin_r, cy - lx * sin_r + ly * cos_r)

        # copper pads
        for pd in pl.get("pads") or []:
            px, py = to_board(pd["x_mm"], pd["y_mm"])
            pw, ph = pd["w_mm"], pd["h_mm"]
            if pd["shape"] == "circle":
                r = pw / 2
                dr.ellipse([X(px - r), Y(py - r), X(px + r), Y(py + r)], fill=copper)
            else:
                dr.rectangle([X(px - pw / 2), Y(py - ph / 2),
                              X(px + pw / 2), Y(py + ph / 2)], fill=copper)
        # silkscreen
        sk = pl.get("silk")
        if sk:
            for ln in sk["lines"]:
                (x1, y1), (x2, y2) = to_board(ln[0], ln[1]), to_board(ln[2], ln[3])
                dr.line([X(x1), Y(y1), X(x2), Y(y2)], fill=silk, width=2)
            for c in sk["circles"]:
                cx0, cy0, r = c[0], c[1], c[2]
                dr.ellipse([X(cx0 - r), Y(cy0 - r), X(cx0 + r), Y(cy0 + r)],
                           outline=silk, width=2)
        # refdes
        dr.text((X(cx) + 8, Y(cy) - 6), pl["ref"], fill=(154, 167, 178))
    return img


def main() -> int:
    stj_path, app_png, out_png = sys.argv[1], sys.argv[2], sys.argv[3]
    gt = render_stj(stj_path)
    app = Image.open(app_png)
    # crop the app screenshot to the map viewport (skip status bar/toolbar/controls):
    # the fullscreen map occupies the area below the top bar; trim edges crudely
    W, H = app.size
    app_crop = app.crop((0, int(H * 0.10), W, int(H * 0.93)))
    # scale both to the same height
    Htarget = 900
    gt2 = gt.resize((int(gt.width * Htarget / gt.height), Htarget))
    ac2 = app_crop.resize((int(app_crop.width * Htarget / app_crop.height), Htarget))
    combo = Image.new("RGB", (gt2.width + ac2.width + 30, Htarget + 40), (6, 9, 12))
    combo.paste(gt2, (10, 30))
    combo.paste(ac2, (gt2.width + 20, 30))
    dr = ImageDraw.Draw(combo)
    dr.text((10, 8), "GROUND TRUTH (STJ data -> Pillow)", fill=(200, 205, 210))
    dr.text((gt2.width + 20, 8), "APP RENDER (webapp canvas, emulator)", fill=(200, 205, 210))
    combo.save(out_png)
    print(f"written {out_png} ({combo.width}x{combo.height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
