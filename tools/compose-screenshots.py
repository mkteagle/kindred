#!/usr/bin/env python3
"""
compose-screenshots.py — Kindred Photos App Store screenshot composer.

Editorial-quality marketing screenshots: blurred lifestyle photo backdrops,
enormous confident typography, real Apple device frames floating with depth.
"""

import argparse
import math
import random
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageChops
except ImportError:
    print("Error: Pillow required. pip install Pillow")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT = Path(__file__).resolve().parent.parent
PHOTOS_DIR = PROJECT / "apps" / "ios" / "Kindred" / "DemoData" / "Photos"
FONTS_DIR = PROJECT / "apps" / "ios" / "Kindred" / "Fonts"

# ---------------------------------------------------------------------------
# Brand palette
# ---------------------------------------------------------------------------
PAPER   = (251, 244, 231)
ASH     = (42, 32, 27)
EMBER   = (201, 85, 28)
CANVAS  = (247, 235, 212)
GOLD    = (233, 184, 93)
PINE    = (109, 60, 36)
FOREST  = (47, 74, 54)

# ---------------------------------------------------------------------------
# Per-screenshot creative direction
# ---------------------------------------------------------------------------
SCREENS = {
    "01_home_feed": {
        "hl": "Your\nfamily.",
        "hl2": "One calm\nplace.",
        "bg_photo": "family-campfire-1.jpg",
        "tint": (35, 25, 18, 180),           # warm dark overlay
        "text_color": PAPER,
        "accent": GOLD,
        "badge": None,
    },
    "02_library_people": {
        "hl": "AI finds",
        "hl2": "everyone.",
        "bg_photo": "couple-hug-van.jpg",
        "tint": (251, 244, 231, 210),         # light warm overlay
        "text_color": ASH,
        "accent": EMBER,
        "badge": "8 people found",
    },
    "03_person_detail": {
        "hl": "Every",
        "hl2": "photo\nof Mom.",
        "bg_photo": "mom-child-joy.jpg",
        "tint": (20, 14, 10, 200),            # deep dark
        "text_color": PAPER,
        "accent": GOLD,
        "badge": None,
    },
    "04_library_pets": {
        "hl": "Pets are",
        "hl2": "family\ntoo.",
        "bg_photo": "landscape-forest.jpg",
        "tint": (30, 50, 35, 190),            # forest overlay
        "text_color": PAPER,
        "accent": GOLD,
        "badge": "3 pets found",
    },
    "05_library_vehicles": {
        "hl": "Cars.",
        "hl2": "Trucks.\nTracked.",
        "bg_photo": "family-roadtrip.jpg",
        "tint": (35, 28, 22, 195),            # charcoal warm
        "text_color": PAPER,
        "accent": EMBER,
        "badge": None,
    },
    "06_search_results": {
        "hl": "Search",
        "hl2": "like you\nremember.",
        "bg_photo": "family-campfire-3.jpg",
        "tint": (160, 55, 12, 190),           # deep ember
        "text_color": PAPER,
        "accent": GOLD,
        "badge": None,
    },
    "07_together_picker": {
        "hl": "Find",
        "hl2": "them\ntogether.",
        "bg_photo": "family-three-sunset.jpg",
        "tint": (247, 235, 212, 215),         # warm canvas overlay
        "text_color": ASH,
        "accent": EMBER,
        "badge": "new feature",
    },
    "08_settings": {
        "hl": "Your",
        "hl2": "house.\nYour rules.",
        "bg_photo": "family-campervan.jpg",
        "tint": (242, 232, 218, 220),         # paper overlay
        "text_color": ASH,
        "accent": FOREST,
        "badge": None,
    },
    "09_login": {
        "hl": "Flickr",
        "hl2": "in.\nThat's it.",
        "bg_photo": "family-evening.jpg",
        "tint": (30, 52, 36, 195),            # forest
        "text_color": PAPER,
        "accent": GOLD,
        "badge": None,
    },
    "10_onboarding": {
        "hl": "Private.",
        "hl2": "Warm.\nYours.",
        "bg_photo": "family-camper-lights.jpg",
        "tint": (25, 42, 30, 200),            # deep forest
        "text_color": PAPER,
        "accent": GOLD,
        "badge": None,
    },
}

CANVAS_SIZES = {
    "iphone": (1320, 2868),
    "ipad":   (2064, 2752),
}


# ---------------------------------------------------------------------------
# Font loading
# ---------------------------------------------------------------------------
def load_font(name, size):
    candidates = []
    if "SpaceGrotesk" in name:
        candidates = [FONTS_DIR / f"{name}.ttf", FONTS_DIR / "SpaceGrotesk-Bold.ttf"]
    elif "IBMPlexMono" in name:
        candidates = [FONTS_DIR / f"{name}.ttf", FONTS_DIR / "IBMPlexMono-SemiBold.ttf"]
    elif "InstrumentSans" in name:
        candidates = [FONTS_DIR / f"{name}.ttf", FONTS_DIR / "InstrumentSans-Regular.ttf"]
    candidates += [Path("/System/Library/Fonts/SFProDisplay-Bold.otf")]
    for p in candidates:
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except (OSError, IOError):
                continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Background: blurred lifestyle photo with color overlay
# ---------------------------------------------------------------------------
def create_atmosphere(canvas_w, canvas_h, photo_name, tint_rgba):
    """Full-bleed blurred photo backdrop with color overlay and grain."""
    photo_path = PHOTOS_DIR / photo_name
    if not photo_path.exists():
        # Fallback: solid tint color
        bg = Image.new("RGB", (canvas_w, canvas_h), tint_rgba[:3])
        return bg

    photo = Image.open(photo_path).convert("RGB")

    # Scale to fill canvas (cover fit)
    pr = photo.width / photo.height
    cr = canvas_w / canvas_h
    if pr > cr:
        new_h = canvas_h
        new_w = int(canvas_h * pr)
    else:
        new_w = canvas_w
        new_h = int(canvas_w / pr)
    photo = photo.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Center crop
    cx = (new_w - canvas_w) // 2
    cy = (new_h - canvas_h) // 2
    photo = photo.crop((cx, cy, cx + canvas_w, cy + canvas_h))

    # Heavy blur — dreamy, atmospheric
    photo = photo.filter(ImageFilter.GaussianBlur(radius=45))

    # Slightly boost contrast for depth
    photo = ImageEnhance.Contrast(photo).enhance(1.15)

    # Color tint overlay
    overlay = Image.new("RGBA", (canvas_w, canvas_h), tint_rgba)
    photo_rgba = photo.convert("RGBA")
    result = Image.alpha_composite(photo_rgba, overlay)

    # Subtle vignette — darken edges
    vignette = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    vdraw = ImageDraw.Draw(vignette)
    max_dim = max(canvas_w, canvas_h)
    for i in range(60):
        alpha = int(1.5 * i)
        margin = int(max_dim * 0.02 * (60 - i) / 60)
        vdraw.rectangle(
            [margin, margin, canvas_w - margin, canvas_h - margin],
            outline=(0, 0, 0, alpha),
        )
    result = Image.alpha_composite(result, vignette)

    # Film grain
    random.seed(hash(photo_name))
    final = result.convert("RGB")
    pixels = final.load()
    for y in range(0, canvas_h, 3):
        for x in range(0, canvas_w, 3):
            r, g, b = pixels[x, y]
            n = random.randint(-4, 4)
            pixels[x, y] = (
                max(0, min(255, r + n)),
                max(0, min(255, g + n)),
                max(0, min(255, b + n)),
            )

    return final


# ---------------------------------------------------------------------------
# Typography: split headline for dramatic weight contrast
# ---------------------------------------------------------------------------
def draw_headline(canvas, hl, hl2, text_color, accent, badge, canvas_w, canvas_h):
    draw = ImageDraw.Draw(canvas)

    # Font sizes — HUGE
    hl_size = int(canvas_w * 0.115)
    hl2_size = int(canvas_w * 0.115)
    badge_size = int(canvas_w * 0.016)

    hl_font = load_font("SpaceGrotesk-Bold", hl_size)
    hl2_font = load_font("SpaceGrotesk-Bold", hl2_size)
    badge_font = load_font("IBMPlexMono-SemiBold", badge_size)

    left = int(canvas_w * 0.065)
    y = int(canvas_h * 0.035)

    # Badge pill
    if badge:
        bt = badge.upper()
        bb = draw.textbbox((0, 0), bt, font=badge_font)
        bw = bb[2] - bb[0] + int(canvas_w * 0.035)
        bh = bb[3] - bb[1] + int(canvas_h * 0.012)
        # Semi-transparent pill
        pill = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        pdraw = ImageDraw.Draw(pill)
        pdraw.rounded_rectangle(
            [left, y, left + bw, y + bh],
            radius=bh // 2,
            fill=(*accent, 220),
        )
        canvas_rgba = canvas.convert("RGBA")
        canvas = Image.alpha_composite(canvas_rgba, pill).convert("RGB")
        draw = ImageDraw.Draw(canvas)
        badge_tc = ASH if sum(accent) > 400 else PAPER
        draw.text(
            (left + int(canvas_w * 0.017), y + int(canvas_h * 0.003)),
            bt,
            font=badge_font,
            fill=badge_tc,
        )
        y += bh + int(canvas_h * 0.018)

    # First headline block — slightly lighter opacity for hierarchy
    hl_color_muted = tuple(
        int(c * 0.6 + (255 if sum(text_color) > 400 else 0) * 0.4)
        for c in text_color
    )
    draw.multiline_text(
        (left, y),
        hl,
        font=hl_font,
        fill=hl_color_muted,
        spacing=int(hl_size * -0.05),
    )
    hbox = draw.multiline_textbbox((left, y), hl, font=hl_font, spacing=int(hl_size * -0.05))
    y = hbox[3] + int(canvas_h * 0.002)

    # Second headline block — full weight, this is the PUNCH
    draw.multiline_text(
        (left, y),
        hl2,
        font=hl2_font,
        fill=text_color,
        spacing=int(hl2_size * -0.05),
    )
    h2box = draw.multiline_textbbox((left, y), hl2, font=hl2_font, spacing=int(hl2_size * -0.05))

    # Thin accent line
    line_y = h2box[3] + int(canvas_h * 0.018)
    draw.line(
        [(left, line_y), (left + int(canvas_w * 0.10), line_y)],
        fill=accent,
        width=3,
    )

    return canvas


# ---------------------------------------------------------------------------
# Device placement with glow
# ---------------------------------------------------------------------------
def place_device_with_glow(canvas, device_img, canvas_w, canvas_h, accent):
    padding = int(canvas_w * 0.05)
    max_w = canvas_w - padding * 2
    max_h = int(canvas_h * 0.62)

    scale = min(max_w / device_img.width, max_h / device_img.height)
    new_w = int(device_img.width * scale)
    new_h = int(device_img.height * scale)
    device_resized = device_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    device_x = (canvas_w - new_w) // 2
    device_y = canvas_h - new_h + int(canvas_h * 0.015)

    canvas_rgba = canvas.convert("RGBA")

    # Soft colored glow behind device (brand accent, very subtle)
    glow = Image.new("RGBA", (new_w + 100, new_h + 100), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.rounded_rectangle(
        [50, 50, new_w + 50, new_h + 50],
        radius=int(new_w * 0.08),
        fill=(*accent, 25),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=40))
    canvas_rgba.paste(glow, (device_x - 50, device_y - 40), glow)

    # Large soft shadow
    shadow = Image.new("RGBA", (new_w + 80, new_h + 80), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle(
        [40, 40, new_w + 40, new_h + 40],
        radius=int(new_w * 0.08),
        fill=(0, 0, 0, 60),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=35))
    canvas_rgba.paste(shadow, (device_x - 40, device_y - 30 + 15), shadow)

    # Device frame
    canvas_rgba.paste(device_resized, (device_x, device_y), device_resized)

    # Subtle top reflection on the device (white gradient fade)
    reflection = Image.new("RGBA", (new_w, int(new_h * 0.15)), (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(reflection)
    for ry in range(reflection.height):
        alpha = int(12 * (1 - ry / reflection.height))
        rdraw.line([(0, ry), (new_w, ry)], fill=(255, 255, 255, alpha))
    # Mask reflection to device shape
    rmask = Image.new("L", (new_w, reflection.height), 0)
    rmask_draw = ImageDraw.Draw(rmask)
    rmask_draw.rounded_rectangle(
        [0, 0, new_w, reflection.height],
        radius=int(new_w * 0.08),
        fill=255,
    )
    reflection.putalpha(ImageChops.multiply(reflection.split()[3], rmask))
    canvas_rgba.paste(reflection, (device_x, device_y), reflection)

    return canvas_rgba.convert("RGB")


# ---------------------------------------------------------------------------
# Main composition
# ---------------------------------------------------------------------------
def compose(framed_path, output_dir, canvas_size, device):
    stem = framed_path.stem.replace("_framed", "")
    cfg = SCREENS.get(stem)
    if not cfg:
        cfg = {
            "hl": "Kindred", "hl2": "Photos.",
            "bg_photo": "family-campfire-1.jpg",
            "tint": (35, 25, 18, 180),
            "text_color": PAPER, "accent": GOLD, "badge": None,
        }

    cw, ch = canvas_size

    # 1. Atmospheric blurred photo background
    canvas = create_atmosphere(cw, ch, cfg["bg_photo"], cfg["tint"])

    # 2. Enormous headline with hierarchy
    canvas = draw_headline(
        canvas, cfg["hl"], cfg["hl2"],
        cfg["text_color"], cfg["accent"], cfg["badge"],
        cw, ch,
    )

    # 3. Device frame with glow + shadow
    device_img = Image.open(framed_path).convert("RGBA")
    canvas = place_device_with_glow(canvas, device_img, cw, ch, cfg["accent"])

    # 4. Save
    output_dir.mkdir(parents=True, exist_ok=True)
    out = output_dir / f"{stem}.png"
    canvas.save(out, "PNG", optimize=True)
    print(f"  {stem}")
    return out


def process_all(input_dir, output_dir, device):
    screenshots = sorted(input_dir.glob("*_framed.png"))
    if not screenshots:
        screenshots = sorted(input_dir.glob("*.png"))
    if not screenshots:
        print(f"No screenshots in {input_dir}")
        sys.exit(1)
    cs = CANVAS_SIZES.get(device, CANVAS_SIZES["iphone"])
    print(f"\n  Composing {len(screenshots)} {device} ({cs[0]}×{cs[1]}):\n")
    for ss in screenshots:
        compose(ss, output_dir, cs, device)
    print("\n  Done!\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "-i", type=Path,
                        default=PROJECT / "screenshots" / "framed_device" / "iphone")
    parser.add_argument("--output", "-o", type=Path,
                        default=PROJECT / "screenshots" / "appstore")
    parser.add_argument("--device", "-d", default="iphone", choices=["iphone", "ipad"])
    args = parser.parse_args()
    process_all(args.input, args.output / args.device, args.device)


if __name__ == "__main__":
    main()
