#!/usr/bin/env python3
"""Generate NEXUS app icons, splash screens and store artwork (PNG) with Pillow.

Usage: python3 scripts/gen-icons.py
Outputs to www/icons/ and resources/ (Capacitor assets input).
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "www" / "icons"
RES = ROOT / "resources"
BG = (7, 10, 15, 255)
GREEN = (0, 255, 135, 255)
CYAN = (96, 239, 255, 255)
PINK = (255, 0, 128, 255)


def sigil(size: int, pad_ratio: float = 0.0, rounded: bool = True, bg=BG) -> Image.Image:
    """Draw the NEXUS sigil: rounded square, circle, 'A'-stroke glyph, pink core."""
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(s * pad_ratio)
    box = [pad, pad, s - pad - 1, s - pad - 1]
    if rounded:
        d.rounded_rectangle(box, radius=int((s - 2 * pad) * 0.22), fill=bg, outline=GREEN, width=max(2, s // 40))
    else:
        d.rectangle([0, 0, s, s], fill=bg)
    cx = cy = s / 2
    inner = (s - 2 * pad)
    r = inner * 0.30
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=CYAN, width=max(2, s // 50))
    w = max(3, int(inner * 0.045))
    # "A" glyph like the SVG sigil: M20 42 L32 14 L44 42 M25.5 32 H38.5 (in a 64 box)
    def P(x, y):
        return (pad + (x / 64) * inner, pad + (y / 64) * inner)
    d.line([P(20, 42), P(32, 14), P(44, 42)], fill=GREEN, width=w, joint="curve")
    d.line([P(25.5, 32), P(38.5, 32)], fill=GREEN, width=w)
    cr = inner * 0.05
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=PINK)
    return img


def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print("wrote", path.relative_to(ROOT))


def splash(w: int, h: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), BG)
    d = ImageDraw.Draw(img)
    step = max(24, min(w, h) // 30)
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=(0, 229, 255, 14))
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=(0, 229, 255, 14))
    size = int(min(w, h) * 0.32)
    logo = sigil(size)
    img.alpha_composite(logo, (int((w - size) / 2), int((h - size) / 2)))
    return img


def main():
    for n in (48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512, 1024):
        save(sigil(n), ICONS / f"icon-{n}.png")
    save(sigil(180), ICONS / "apple-touch-icon.png")
    # Maskable: full-bleed background, logo within 80% safe zone
    m = Image.new("RGBA", (512, 512), BG)
    m.alpha_composite(sigil(int(512 * 0.76)), (int(512 * 0.12), int(512 * 0.12)))
    save(m, ICONS / "maskable-512.png")
    # Capacitor assets inputs (@capacitor/assets)
    save(sigil(1024, rounded=False), RES / "icon-only.png")
    fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    fg.alpha_composite(sigil(int(1024 * 0.66)), (int(1024 * 0.17), int(1024 * 0.17)))
    save(fg, RES / "icon-foreground.png")
    save(Image.new("RGBA", (1024, 1024), BG), RES / "icon-background.png")
    save(splash(2732, 2732), RES / "splash.png")
    save(splash(2732, 2732), RES / "splash-dark.png")
    # Store artwork
    save(sigil(1024, rounded=False), RES / "store" / "app-store-icon-1024.png")
    save(sigil(512, rounded=False), RES / "store" / "play-store-icon-512.png")
    feat = splash(1024, 500)
    save(feat, RES / "store" / "play-feature-graphic-1024x500.png")
    save(splash(1600, 900), ICONS / "screenshot-wide.png")


if __name__ == "__main__":
    main()
