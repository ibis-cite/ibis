"""Build every Ibis brand export from master.svg.

Standard library only. It needs librsvg's `rsvg-convert` for PNG, ICO and the
optical centre, and the Inter font for the social preview's text. Run:

    python3 brand/build.py

Sizes and spacing follow brand/README.md. M is the bird's height.
"""

from pathlib import Path
import json
import math
import re
import struct
import subprocess
import zlib

HERE = Path(__file__).resolve().parent
OUT = HERE / "exports"

# Colours. See palette() for the full set written to exports/colors.css.
SCARLET = "#C23A1C"           # the bird on light backgrounds (Scarlet 600)
SCARLET_DARK = "#FF7A5C"      # the bird on dark backgrounds (Scarlet 400)
SCARLET_MID = "#CF4628"       # PNG favicons, which must work on light and dark tab bars
GRADIENT = ("#CF4628", "#B5331A")
GRADIENT_DARK = ("#FF7F5E", "#F2552F")
INK, INK_DARK = "#16181D", "#F5F5F7"
SLATE = "#4C5260"
TILE, TILE_DARK = ("#FFFFFF", "#EFECE8"), ("#3A3A3F", "#18181B")
PAPER = ("#FFFFFF", "#F1EEE9")

# Proportions of M.
PAD = 0.135          # free space inside a file on every side, for the soft shadow
WORD_CAP = 0.55      # wordmark cap height
WORD_GAP = 0.34      # beak tip to the wordmark
CONTAINER = 0.62     # app icon, avatar and maskable icon: bird height / square
OPTICAL = 0.5        # how far to move from the outline's centre toward its visual weight
SMALL_NECK = 10.5    # favicon neck width (master: 8.5), so the bird reads at 16 px

TAGLINE = "Find references. Copy citation keys."
SUBLINE = "Early preview · Free and open source · Works with Zotero and BibTeX"


def symbols():
    text = (HERE / "master.svg").read_text(encoding="utf-8")
    return {sid: ([float(v) for v in box.split()], body)
            for sid, box, body in re.findall(r'<symbol id="(\w+)" viewBox="([^"]+)">(.*?)</symbol>', text, re.S)}


SYM = symbols()


def ratio(name):
    _, _, w, h = SYM[name][0]
    return w / h


def rasterize(svg):
    """Render SVG text with rsvg-convert; return (width, height, alpha rows)."""
    data = subprocess.run(["rsvg-convert"], input=svg.encode(), capture_output=True, check=True).stdout
    pos, chunks, width = 8, [], 0
    while pos < len(data):
        size, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + size]
        if kind == b"IHDR":
            width, height = struct.unpack(">II", body[:8])
        elif kind == b"IDAT":
            chunks.append(body)
        pos += size + 12
    raw, stride, rows, prev = zlib.decompress(b"".join(chunks)), width * 4, [], bytearray(width * 4)
    for y in range(height):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - 4] if i >= 4 else 0
            b, c = prev[i], prev[i - 4] if i >= 4 else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line[3::4])
        prev = line
    return width, height, rows


def optical_centre(name, neck=None):
    """The point to centre on: partway from the outline's centre to its centre of mass."""
    (bx, by, bw, bh), body = SYM[name]
    if neck:
        body = body.replace('stroke-width="8.5"', f'stroke-width="{neck}"')
    scale = 8
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{bw * scale:.0f}" height="{bh * scale:.0f}" '
           f'viewBox="{bx} {by} {bw} {bh}">{body.replace("currentColor", "#000")}</svg>')
    width, height, rows = rasterize(svg)
    total = sx = sy = 0
    for y, row in enumerate(rows):
        for x, a in enumerate(row):
            if a:
                total += a
                sx += x * a
                sy += y * a
    mass = (bx + sx / total * bw / width, by + sy / total * bh / height)
    centre = (bx + bw / 2, by + bh / 2)
    return tuple(c + (m - c) * OPTICAL for c, m in zip(centre, mass))


def depth_filter(fid):
    """One soft light along the top rim, a shade along the bottom rim, and a short shadow."""
    return (
        f'<filter id="{fid}" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB">'
        '<feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="b"/>'
        '<feOffset in="b" dy="1.3" result="bd"/><feComposite in="SourceAlpha" in2="bd" operator="out" result="top"/>'
        '<feFlood flood-color="#fff" flood-opacity="0.3"/><feComposite in2="top" operator="in" result="hl"/>'
        '<feOffset in="b" dy="-1.3" result="bu"/><feComposite in="SourceAlpha" in2="bu" operator="out" result="bot"/>'
        '<feFlood flood-color="#000" flood-opacity="0.16"/><feComposite in2="bot" operator="in" result="sh"/>'
        '<feGaussianBlur in="SourceAlpha" stdDeviation="2" result="db"/><feOffset in="db" dy="1.6" result="do"/>'
        '<feFlood flood-color="#4a0f04" flood-opacity="0.2"/><feComposite in2="do" operator="in" result="drop"/>'
        '<feMerge><feMergeNode in="drop"/><feMergeNode in="SourceGraphic"/><feMergeNode in="hl"/><feMergeNode in="sh"/></feMerge>'
        "</filter>"
    )


def draw(name, k, tx, ty, paint, uid, depth=False, neck=None):
    """The symbol in its own units, scaled by k, with its unit origin moved to (tx, ty)."""
    (_, by, _, bh), body = SYM[name]
    defs, attr = "", ""
    if depth:
        top, bottom = paint
        # Gradient and filter work in the symbol's units, so depth scales with size.
        defs = (f'<linearGradient id="{uid}g" gradientUnits="userSpaceOnUse" x1="0" y1="{by - 1}" x2="0" y2="{by + bh}">'
                f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>'
                + depth_filter(f"{uid}f"))
        paint, attr = f"url(#{uid}g)", f' filter="url(#{uid}f)"'
    if neck:
        body = body.replace('stroke-width="8.5"', f'stroke-width="{neck}"')
    body = body.replace("currentColor", paint)
    return defs, f'<g transform="translate({tx:.3f} {ty:.3f}) scale({k:.5f})"><g{attr}>{body}</g></g>'


def place(name, x, y, height, paint, uid, depth=False):
    """The symbol with its outline's top-left at (x, y), `height` tall."""
    bx, by, _, bh = SYM[name][0]
    k = height / bh
    return draw(name, k, x - bx * k, y - by * k, paint, uid, depth)


def centred(name, side, height, paint, uid, depth, neck=None):
    """The symbol `height` tall, its optical centre on the middle of a `side` square."""
    k = height / SYM[name][0][3]
    ox, oy = optical_centre(name, neck)
    return draw(name, k, side / 2 - ox * k, side / 2 - oy * k, paint, uid, depth, neck)


def fitted_side(name, pad, neck=None):
    """The smallest square, in symbol units, that holds the outline plus `pad` around the optical centre."""
    bx, by, bw, bh = SYM[name][0]
    ox, oy = optical_centre(name, neck)
    extra = ((neck or 8.5) - 8.5) / 2
    reach = max(ox - bx + extra, bx + bw - ox, oy - by, by + bh + extra - oy)
    return 2 * (reach + pad)


def doc(w, h, defs, body, size=None):
    width, height = size or (w, h)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:g}" height="{height:g}" viewBox="0 0 {w:g} {h:g}">'
            f"<defs>{defs}</defs>{body}</svg>\n")


def mark(paint, uid, depth=True):
    bh = SYM["mark"][0][3]
    side = fitted_side("mark", PAD * bh + 1.6)       # 1.6: the shadow's drop
    defs, body = centred("mark", side, bh, paint, uid, depth)
    return doc(side, side, defs, body, (512, 512))


def logo(dark, uid):
    m = 100
    pad = PAD * m
    mark_w = m * ratio("mark")
    cap = WORD_CAP * m
    (_, wy, _, wh), _ = SYM["wordmark"]
    word_h = cap * wh / 100                 # the wordmark symbol's cap height is 100
    word_w = word_h * ratio("wordmark")
    baseline = pad + m / 2 + cap / 2        # cap height centred on the bird
    w = pad + mark_w + WORD_GAP * m + word_w + pad
    h = m + 2 * pad
    d1, b1 = place("mark", pad, pad, m, GRADIENT_DARK if dark else GRADIENT, uid, True)
    d2, b2 = place("wordmark", pad + mark_w + WORD_GAP * m, baseline + wy * cap / 100, word_h,
                   INK_DARK if dark else INK, uid + "w")
    return doc(w, h, d1 + d2, b1 + b2, (round(w * 200 / h), 200))


def background(w, h, colours, uid, radius=0, edge=None):
    top, bottom = colours
    defs = (f'<linearGradient id="{uid}bg" x1="0" y1="0" x2="0.17" y2="1">'
            f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>')
    body = f'<rect width="{w}" height="{h}" rx="{radius}" fill="url(#{uid}bg)"/>'
    if edge:
        # A hairline inside the edge keeps the tile visible on a background of the same colour.
        s = w / 512
        body += (f'<rect x="{s / 2}" y="{s / 2}" width="{w - s}" height="{h - s}" rx="{radius - s / 2}" '
                 f'fill="none" stroke="{edge}" stroke-width="{s}"/>')
    return defs, body


def app_icon(dark, uid):
    side = 1024
    d1, b1 = background(side, side, TILE_DARK if dark else TILE, uid, 230,
                        "rgba(255,255,255,0.12)" if dark else "rgba(0,0,0,0.10)")
    d2, b2 = centred("mark", side, CONTAINER * side, GRADIENT_DARK if dark else GRADIENT, uid, True)
    return doc(side, side, d1 + d2, b1 + b2)


def square_tile(uid):
    """A full square for circle crops and masks: avatars, Apple touch and maskable icons."""
    side = 512
    d1, b1 = background(side, side, TILE, uid)
    d2, b2 = centred("mark", side, CONTAINER * side, GRADIENT, uid, True)
    return doc(side, side, d1 + d2, b1 + b2)


def favicon(paint, style=""):
    side = fitted_side("mark", 1.5, SMALL_NECK)
    defs, body = centred("mark", side, SYM["mark"][0][3], paint, "fv", False, SMALL_NECK)
    return doc(side, side, style + defs, body, (32, 32))


def card(w, h, uid):
    """The social card: logo, lead line and status line, centred as one block."""
    m = 184 * h / 640
    logo_svg = logo(False, uid)
    lw, lh = (float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', logo_svg).groups())
    k = m * (1 + 2 * PAD) / lh
    inner = re.search(r"<defs>(.*)</defs>(.*)</svg>", logo_svg, re.S)
    tag, sub = 56 * h / 640, 32 * h / 640
    block = lh * k + 0.9 * tag + 1.2 * tag + sub
    x, y = (w - lw * k) / 2, (h - block) / 2
    d1, body = background(w, h, PAPER, uid)
    body += f'<g transform="translate({x:.2f} {y:.2f}) scale({k:.5f})">{inner.group(2)}</g>'
    text = f'font-family="Inter Display, Inter, sans-serif" text-anchor="middle" x="{w / 2:g}"'
    body += f'<text {text} y="{y + lh * k + 1.65 * tag:.1f}" font-size="{tag:.1f}" font-weight="600" fill="{INK}">{TAGLINE}</text>'
    body += f'<text {text} y="{y + block - 0.25 * sub:.1f}" font-size="{sub:.1f}" fill="{SLATE}">{SUBLINE}</text>'
    return doc(w, h, d1 + inner.group(1), body)


def beak():
    m = 100
    w, h = m * ratio("beak") + 2 * PAD * m, m * (1 + 2 * PAD)
    defs, body = place("beak", PAD * m, PAD * m, m, GRADIENT, "bk", True)
    return doc(w, h, defs, body, (round(256 * w / h), 256))


def oklch(lightness, chroma, hue):
    """OKLCH to an sRGB hex string, reducing chroma until the colour fits sRGB."""
    while True:
        a, b = chroma * math.cos(math.radians(hue)), chroma * math.sin(math.radians(hue))
        l_ = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
        m_ = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
        s_ = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
        rgb = (4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
               -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
               -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_)
        if all(-0.0005 <= v <= 1.0005 for v in rgb):
            break
        chroma -= 0.002
    srgb = [12.92 * v if v <= 0.0031308 else 1.055 * max(v, 0) ** (1 / 2.4) - 0.055 for v in rgb]
    return "#" + "".join(f"{round(min(1, max(0, v)) * 255):02X}" for v in srgb)


def palette():
    """Scarlet runs from 50 to 900 at the bird's hue; 400 and 600 are the bird's own colours."""
    steps = {50: (0.97, 0.02), 100: (0.94, 0.04), 200: (0.88, 0.08), 300: (0.81, 0.13), 400: SCARLET_DARK,
             500: (0.64, 0.18), 600: SCARLET, 700: (0.47, 0.155), 800: (0.39, 0.125), 900: (0.30, 0.09)}
    scarlet = {k: v if isinstance(v, str) else oklch(v[0], v[1], 34) for k, v in steps.items()}
    neutral = {"ink": INK, "slate": SLATE, "mist": "#C0C3CC", "paper": "#FFFFFF",
               "warm-paper": PAPER[1], "night": "#141417"}
    return {"scarlet": scarlet, "neutral": neutral}


def write_palette():
    colours = palette()
    (OUT / "colors.json").write_text(json.dumps(colours, indent=2) + "\n", encoding="utf-8")
    lines = [f"  --ibis-scarlet-{k}: {v};" for k, v in colours["scarlet"].items()]
    lines += [f"  --ibis-{k}: {v};" for k, v in colours["neutral"].items()]
    (OUT / "colors.css").write_text("/* Ibis brand colours. Made by brand/build.py; do not edit. */\n:root {\n"
                                    + "\n".join(lines) + "\n}\n", encoding="utf-8")


def png(svg_name, out_name, width, height=None):
    """Render at `width`; `height` defaults to square, and "auto" keeps the file's own proportions."""
    args = ["rsvg-convert", "--width", str(width)]
    if height != "auto":
        args += ["--height", str(height or width)]
    subprocess.run(args + ["--output", str(OUT / "png" / out_name), str(OUT / svg_name)], check=True)


def ico(svg_name, sizes):
    entries, payload, images = bytearray(), bytearray(), []
    for size in sizes:
        png(svg_name, f"favicon-{size}.png", size)
        images.append((size, (OUT / "png" / f"favicon-{size}.png").read_bytes()))
    for size, data in images:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data),
                               6 + len(images) * 16 + len(payload))
        payload += data
    (OUT / "favicon.ico").write_bytes(struct.pack("<HHH", 0, 1, len(images)) + entries + payload)


MANIFEST = {
    "name": "Ibis", "short_name": "Ibis", "theme_color": SCARLET, "background_color": "#FFFFFF",
    "icons": [
        {"src": "png/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "png/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "png/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}


def main():
    (OUT / "png").mkdir(parents=True, exist_ok=True)
    dark_style = f"<style>svg{{color:{SCARLET}}}@media (prefers-color-scheme:dark){{svg{{color:{SCARLET_DARK}}}}}</style>"
    files = {
        "ibis-mark.svg": mark(GRADIENT, "m"),
        "ibis-mark-on-dark.svg": mark(GRADIENT_DARK, "md"),
        "ibis-mark-flat.svg": mark(SCARLET, "mf", False),
        "ibis-mark-black.svg": mark(INK, "mb", False),
        "ibis-mark-white.svg": mark("#FFFFFF", "mw", False),
        "ibis-logo.svg": logo(False, "l"),
        "ibis-logo-on-dark.svg": logo(True, "ld"),
        "ibis-app-icon.svg": app_icon(False, "a"),
        "ibis-app-icon-dark.svg": app_icon(True, "ad"),
        "ibis-avatar.svg": square_tile("av"),
        "ibis-quote-beak.svg": beak(),
        "favicon.svg": favicon("currentColor", dark_style),
        "github-social-preview.svg": card(1280, 640, "s"),
        "og-image.svg": card(1200, 630, "og"),
        "favicon-png.svg": favicon(SCARLET_MID),
    }
    for name, text in files.items():
        (OUT / name).write_text(text, encoding="utf-8")
    for size in (1024, 512, 256, 128):
        png("ibis-app-icon.svg", f"ibis-app-icon-{size}.png", size)
    png("ibis-app-icon-dark.svg", "ibis-app-icon-dark-1024.png", 1024)
    png("ibis-avatar.svg", "ibis-avatar-512.png", 512)
    png("ibis-mark.svg", "ibis-mark-512.png", 512)
    png("ibis-mark-on-dark.svg", "ibis-mark-on-dark-512.png", 512)
    png("ibis-logo.svg", "ibis-logo-800.png", 800, "auto")
    png("ibis-logo-on-dark.svg", "ibis-logo-on-dark-800.png", 800, "auto")
    png("github-social-preview.svg", "github-social-preview.png", 1280, 640)
    png("og-image.svg", "og-image.png", 1200, 630)
    png("ibis-avatar.svg", "apple-touch-icon.png", 180)
    png("ibis-app-icon.svg", "icon-192.png", 192)
    png("ibis-app-icon.svg", "icon-512.png", 512)
    png("ibis-avatar.svg", "icon-maskable-512.png", 512)
    ico("favicon-png.svg", (16, 32, 48))
    (OUT / "favicon-png.svg").unlink()
    (OUT / "site.webmanifest").write_text(json.dumps(MANIFEST, indent=2) + "\n", encoding="utf-8")
    write_palette()


if __name__ == "__main__":
    main()
