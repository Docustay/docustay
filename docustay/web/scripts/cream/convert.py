#!/usr/bin/env python3
"""Cream restyle (16 Oct 2026, specs/SITE-CREAM-RESTYLE.md): convert dark-ground colour literals in the public site's CSS to the light ones.
Context-aware by CSS property. Leaves alone: pure white (often text on violet; reviewed by hand), the document-paper palette, inset highlights,
anything inside the 3D files (done by hand). Prints every change so it can be reviewed. COLOUR ONLY: never touches text content.
Usage: convert.py <file>... [--write]"""
import re, sys

def parse(c):
    c = c.strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3,8})", c)
    if m:
        h = m.group(1)
        if len(h) in (3, 4): h = "".join(x * 2 for x in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1
        return r, g, b, a
    m = re.fullmatch(r"rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)", c)
    if m:
        a = m.group(4)
        a = (float(a[:-1]) / 100 if a and a.endswith("%") else float(a)) if a else 1
        return float(m.group(1)), float(m.group(2)), float(m.group(3)), a
    return None

lum = lambda r, g, b: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
# the document-paper palette (sheets drawn on the page stay paper)
PAPER = {"#f4f2ec", "#faf8f3", "#1b1b1b", "#a8a39a", "#6f6b63", "#c9c5bb", "#e6e2d8", "#8f8a80", "#4a4740", "#fbfaf6", "#d8d4c8", "#a9a59b",
         "#b4afa5", "#5a564e", "#dcd8cd", "#bdb8ab", "#6a665d", "#d9d5c8", "#e7f3ec", "#1f6b34", "#4c2fb0", "#5a3ac1", "#4e30b2", "#6a49e0"}
VIOLETISH = lambda r, g, b: b > r + 40 and b > g + 40
# colours that are already the light palette (hand-converted files): never touched again
LIGHT_FAMILY = {(22, 22, 29), (60, 40, 140), (90, 58, 193), (74, 48, 178), (76, 74, 94)}
CYANISH = lambda r, g, b: g > r + 40 and b > r + 40

def fmt(a):
    return f"{round(a, 3):g}"

def convert(color, prop, decl):
    p = parse(color)
    if not p: return None
    r, g, b, a = p
    key = color.strip().lower()
    if key in PAPER or key in ("#fff", "#ffffff", "white", "#000", "#000000"):
        if key in ("#000", "#000000") and prop in ("background", "background-color"): return "#16161d"
        return None
    if prop.startswith("--"): return None   # custom properties are reviewed by hand
    if (round(r), round(g), round(b)) in LIGHT_FAMILY or a == 0: return None
    if "inset" in decl and r > 240 and g > 240 and b > 240: return None   # a top highlight on a card: harmless on white
    L = lum(r, g, b)
    text = prop in ("color", "-webkit-text-fill-color", "fill", "caret-color", "text-decoration-color")
    shadow = prop in ("box-shadow", "text-shadow", "filter", "drop-shadow")
    border = prop.startswith("border") or prop.startswith("outline") or prop == "stroke"
    if text:
        if L > 0.85 and 0.15 < a <= 0.4: return "var(--tx-3)"
        if L >= 0.55 and a > 0.4:
            if g > r + 30 and g > b + 20: return "#1c7448"            # green text
            if VIOLETISH(r, g, b): return "var(--v-700)"
            if CYANISH(r, g, b): return "#0b6f7a"
            if r > 200 and g > 150 and b < 140: return "#8a5208"   # warm amber text
            if g > r + 30 and g > b: return "#1c7448"              # green text
            if r > 220 and g < 170: return "#b4233c"               # rose text
            return "var(--tx-1)" if L > 0.82 else "var(--tx-2)"
        return None
    if shadow:
        if r < 40 and g < 40 and b < 50 and a == 1: return "#ffffff"   # a solid ring spacer (0 0 0 2px <ground>)
        if r < 40 and g < 40 and b < 50: return f"rgb(60 40 140 / {fmt(min(.3, a * .45))})"
        if VIOLETISH(r, g, b) or CYANISH(r, g, b): return f"rgb(90 58 193 / {fmt(min(.22, a * .35))})"
        if L > 0.9: return None
        return None
    if border:
        if L > 0.85 and 0.4 <= a < 0.6: return "rgb(76 74 94 / .5)"   # a drawn connector line
        if L > 0.85 and a < 0.4: return "var(--hairline)"
        if VIOLETISH(r, g, b) and L > 0.5: return f"rgb(90 58 193 / {fmt(max(.25, min(.5, a)))})"
        if L < 0.25 and a > 0.3: return "var(--hairline)"
        return None
    # backgrounds, gradients, stops, anything else
    if 0.1 <= L < 0.22 and a >= 0.75: return "#ece9f6"   # a raised bar or chip inside a dark card
    if L < 0.22 and a >= 0.3: return "#ffffff" if a >= 0.75 else f"rgb(255 255 255 / {fmt(max(.85, a))})"
    if L > 0.85 and a <= 0.2: return f"rgb(22 22 29 / {fmt(max(.03, min(.06, a * .6)))})"
    if VIOLETISH(r, g, b) and L > 0.45 and a < 0.7: return f"rgb(90 58 193 / {fmt(min(.1, a * .5))})"
    if CYANISH(r, g, b) and a < 0.7: return f"rgb(11 111 122 / {fmt(min(.1, a * .5))})"
    return None

COLOR = r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)"
DECL = re.compile(r"([a-zA-Z-]+)\s*:\s*([^;{}\"]+)")

def process(src):
    changes = []
    def fix_decl(m):
        prop, val = m.group(1).lower(), m.group(2)
        def rep(cm):
            new = convert(cm.group(0), prop, val)
            if new and new != cm.group(0):
                changes.append(f"{prop}: {cm.group(0)} -> {new}")
                return new
            return cm.group(0)
        # only the colour text changes: the property, the colon and every other character stay byte for byte
        return m.group(0)[:m.start(2) - m.start(0)] + re.sub(COLOR, rep, val)
    # only inside <style> blocks, style="" attributes and .css files
    def in_style(block): return DECL.sub(fix_decl, block)
    out = re.sub(r"(<style[^>]*>)(.*?)(</style>)", lambda m: m.group(1) + in_style(m.group(2)) + m.group(3), src, flags=re.S)
    out = re.sub(r'(style=")([^"]*)(")', lambda m: m.group(1) + in_style(m.group(2)) + m.group(3), out)
    out = re.sub(r"(style=\{`)([^`]*)(`\})", lambda m: m.group(1) + in_style(m.group(2)) + m.group(3), out)
    return out, changes

if __name__ == "__main__":
    write = "--write" in sys.argv
    total = 0
    for f in [a for a in sys.argv[1:] if not a.startswith("--")]:
        s = open(f).read()
        if f.endswith(".css"):
            ch = []
            def fix(m):
                prop, val = m.group(1).lower(), m.group(2)
                def rep(cm):
                    new = convert(cm.group(0), prop, val)
                    if new and new != cm.group(0): ch.append(f"{prop}: {cm.group(0)} -> {new}"); return new
                    return cm.group(0)
                return m.group(0)[:m.start(2) - m.start(0)] + re.sub(COLOR, rep, val)
            out = DECL.sub(fix, s)
        else:
            out, ch = process(s)
        if ch:
            total += len(ch)
            print(f"== {f} ({len(ch)})"); [print("   ", c) for c in ch]
            if write: open(f, "w").write(out)
    print("changes:", total)
