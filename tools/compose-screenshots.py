#!/usr/bin/env python3
"""
compose-screenshots.py — Kindred Photos App Store screenshot composer.

Bold, high-impact marketing screenshots with real Apple device frames,
rich gradient backgrounds, large typography, and emotional depth.
"""

import argparse
import math
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
except ImportError:
    print("Error: Pillow required. pip install Pillow")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Kindred brand palette
# ---------------------------------------------------------------------------
PAPER   = (251, 244, 231)
ASH     = (42, 32, 27)
EMBER   = (201, 85, 28)
CANVAS  = (247, 235, 212)
GOLD    = (233, 184, 93)
PINE    = (109, 60, 36)
FOREST  = (47, 74, 54)
CARD    = (255, 253, 248)

# ---------------------------------------------------------------------------
# Per-screenshot design config
# ---------------------------------------------------------------------------
SCREENS = {
    "01_home_feed": {
        "headline": "Your family.\nOne calm place.",
        "sub": "Photos surface automatically. Nothing to organize.",
        "grad_top": (48, 36, 28),        # deep warm brown
        "grad_bot": (75, 50, 35),
        "text_color": PAPER,
        "accent": GOLD,
        "badge": None,
    },
    "02_library_people": {
        "headline": "AI finds\neveryone.",
        "sub": "Faces grouped automatically — just add names.",
        "grad_top": (251, 244, 231),      # paper
        "grad_bot": (240, 225, 200),
        "text_color": ASH,
        "accent": EMBER,
        "badge": "8 people found",
    },
    "03_person_detail": {
        "headline": "Every photo\nof Mom.",
        "sub": "35 photos across 4 years, one tap away.",
        "grad_top": (30, 22, 18),         # near black
        "grad_bot": (60, 40, 30),
        "text_color": PAPER,
        "accent": GOLD,
        "badge": None,
    },
    "04_library_pets": {
        "headline": "Pets are\nfamily too.",
        "sub": "Dogs, cats — recognized and grouped like people.",
        "grad_top": (40, 62, 45),         # deep forest
        "grad_bot": (60, 85, 55),
        "text_color": PAPER,
        "accent": GOLD,
        "badge": "3 pets found",
    },
    "05_library_vehicles": {
        "headline": "Cars. Trucks.\nAll tracked.",
        "sub": "Every vehicle in your photo library, automatically.",
        "grad_top": (45, 38, 32),         # warm charcoal
        "grad_bot": (70, 55, 42),
        "text_color": PAPER,
        "accent": EMBER,
        "badge": None,
    },
    "06_search_results": {
        "headline": "Search like\nyou remember.",
        "sub": "\"campfire\" → every campfire photo, instantly.",
        "grad_top": (201, 85, 28),        # ember
        "grad_bot": (160, 60, 15),
        "text_color": PAPER,
        "accent": GOLD,
        "badge": None,
    },
    "07_together_picker": {
        "headline": "Find them\ntogether.",
        "sub": "Pick two people — see every photo they share.",
        "grad_top": (251, 244, 231),
        "grad_bot": (235, 218, 190),
        "text_color": ASH,
        "accent": EMBER,
        "badge": "NEW",
    },
    "08_settings": {
        "headline": "Your house.\nYour rules.",
        "sub": "Private by default. Share with family only.",
        "grad_top": (247, 235, 212),      # canvas
        "grad_bot": (235, 220, 195),
        "text_color": ASH,
        "accent": FOREST,
        "badge": None,
    },
    "09_login": {
        "headline": "Flickr in.\nThat's it.",
        "sub": "Your photos stay on Flickr. We just organize them.",
        "grad_top": (47, 74, 54),         # forest
        "grad_bot": (30, 50, 35),
        "text_color": PAPER,
        "accent": GOLD,
        "badge": None,
    },
    "10_onboarding": {
        "headline": "Private.\nWarm.\nYours.",
        "sub": "Backed by Flickr. Sorted by AI. Owned by you.",
        "grad_top": (47, 74, 54),
        "grad_bot": (25, 42, 30),
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
def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    project_root = Path(__file__).resolve().parent.parent
    ios_fonts = project_root / "apps" / "ios" / "Kindred" / "Fonts"
    candidates = []
    if "SpaceGrotesk" in name:
        candidates = [ios_fonts / f"{name}.ttf", ios_fonts / "SpaceGrotesk-Bold.ttf"]
    elif "IBMPlexMono" in name:
        candidates = [ios_fonts / f"{name}.ttf", ios_fonts / "IBMPlexMono-SemiBold.ttf"]
    elif "InstrumentSans" in name:
        candidates = [ios_fonts / f"{name}.ttf", ios_fonts / "InstrumentSans-Regular.ttf"]
    candidates += [
        Path("/System/Library/Fonts/SFProDisplay-Bold.otf"),
        Path("/System/Library/Fonts/Helvetica.ttc"),
    ]
    for p in candidates:
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except (OSError, IOError):
                continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Background rendering
# ---------------------------------------------------------------------------
def draw_rich_gradient(canvas: Image.Image, top: tuple, bot: tuple):
    """Smooth ease-in-out gradient with subtle radial warmth."""
    draw = ImageDraw.Draw(canvas)
    w, h = canvas.size
    for y in range(h):
        t = y / h
        t = t * t * (3 - 2 * t)  # smoothstep
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    # Add radial glow from center-top for depth
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    cx, cy = w // 2, int(h * 0.2)
    max_r = int(w * 0.8)
    for i in range(max_r, 0, -3):
        alpha = int(8 * (1 - i / max_r))
        glow_draw.ellipse(
            [cx - i, cy - i, cx + i, cy + i],
            fill=(255, 255, 255, alpha),
        )
    canvas.paste(Image.alpha_composite(canvas.convert("RGBA"), glow).convert("RGB"))


def add_noise(canvas: Image.Image, amount: int = 4):
    """Subtle film grain."""
    import random
    random.seed(42)
    pixels = canvas.load()
    w, h = canvas.size
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = pixels[x, y]
            n = random.randint(-amount, amount)
            pixels[x, y] = (
                max(0, min(255, r + n)),
                max(0, min(255, g + n)),
                max(0, min(255, b + n)),
            )


# ---------------------------------------------------------------------------
# Device placement with slight perspective tilt
# ---------------------------------------------------------------------------
def place_device(canvas: Image.Image, device_img: Image.Image, canvas_w: int, canvas_h: int):
    """Place device frame prominently, slightly raised from bottom."""
    padding = int(canvas_w * 0.06)
    max_w = canvas_w - padding * 2
    max_h = int(canvas_h * 0.65)

    scale = min(max_w / device_img.width, max_h / device_img.height)
    new_w = int(device_img.width * scale)
    new_h = int(device_img.height * scale)
    device_resized = device_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    device_x = (canvas_w - new_w) // 2
    device_y = canvas_h - new_h + int(canvas_h * 0.01)

    # Large soft shadow
    shadow_size = 40
    shadow = Image.new("RGBA", (new_w + shadow_size * 2, new_h + shadow_size * 2), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle(
        [shadow_size, shadow_size, new_w + shadow_size, new_h + shadow_size],
        radius=int(new_w * 0.08),
        fill=(0, 0, 0, 55),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=30))

    canvas_rgba = canvas.convert("RGBA")
    canvas_rgba.paste(shadow, (device_x - shadow_size, device_y - shadow_size + 10), shadow)
    canvas_rgba.paste(device_resized, (device_x, device_y), device_resized)
    return canvas_rgba.convert("RGB")


# ---------------------------------------------------------------------------
# Typography
# ---------------------------------------------------------------------------
def draw_text_block(
    canvas: Image.Image,
    headline: str,
    sub: str,
    text_color: tuple,
    accent: tuple,
    badge,
    canvas_w: int,
    canvas_h: int,
):
    draw = ImageDraw.Draw(canvas)

    # Huge headline
    h_size = int(canvas_w * 0.09)
    h_font = load_font("SpaceGrotesk-Bold", h_size)

    # Subtitle
    s_size = int(canvas_w * 0.028)
    s_font = load_font("InstrumentSans-Regular", s_size)

    # Badge
    b_size = int(canvas_w * 0.018)
    b_font = load_font("IBMPlexMono-SemiBold", b_size)

    left = int(canvas_w * 0.07)
    top = int(canvas_h * 0.04)

    # Draw badge first if present
    if badge:
        badge_text = badge.upper()
        bb = draw.textbbox((0, 0), badge_text, font=b_font)
        bw = bb[2] - bb[0] + int(canvas_w * 0.03)
        bh = bb[3] - bb[1] + int(canvas_h * 0.012)
        # Pill background
        draw.rounded_rectangle(
            [left, top, left + bw, top + bh],
            radius=bh // 2,
            fill=accent,
        )
        # Badge text — dark on light accent, light on dark accent
        badge_text_color = ASH if sum(accent) > 400 else PAPER
        draw.text(
            (left + int(canvas_w * 0.015), top + int(canvas_h * 0.003)),
            badge_text,
            font=b_font,
            fill=badge_text_color,
        )
        top += bh + int(canvas_h * 0.015)

    # Draw headline
    draw.multiline_text(
        (left, top),
        headline,
        font=h_font,
        fill=text_color,
        spacing=int(h_size * 0.05),
    )

    # Measure headline height
    hbox = draw.multiline_textbbox((left, top), headline, font=h_font, spacing=int(h_size * 0.05))
    headline_bottom = hbox[3]

    # Draw subtitle with slight transparency
    sub_y = headline_bottom + int(canvas_h * 0.015)
    # Muted version of text color
    sub_color = tuple(min(255, c + 60) if sum(text_color) > 400 else max(0, c - 40) for c in text_color)
    draw.text(
        (left, sub_y),
        sub,
        font=s_font,
        fill=sub_color,
    )

    # Accent line under subtitle
    sub_box = draw.textbbox((left, sub_y), sub, font=s_font)
    line_y = sub_box[3] + int(canvas_h * 0.012)
    draw.line(
        [(left, line_y), (left + int(canvas_w * 0.12), line_y)],
        fill=(*accent, 180) if len(accent) == 3 else accent,
        width=3,
    )


# ---------------------------------------------------------------------------
# Main composition
# ---------------------------------------------------------------------------
def compose_screenshot(
    framed_path: Path,
    output_dir: Path,
    canvas_size: tuple[int, int],
    device: str,
) -> Path:
    stem = framed_path.stem.replace("_framed", "")
    config = SCREENS.get(stem, {
        "headline": "Kindred\nPhotos",
        "sub": "A calmer home for family photos.",
        "grad_top": PAPER,
        "grad_bot": CANVAS,
        "text_color": ASH,
        "accent": EMBER,
        "badge": None,
    })

    canvas_w, canvas_h = canvas_size
    canvas = Image.new("RGB", (canvas_w, canvas_h), config["grad_top"])

    # 1. Rich gradient background
    draw_rich_gradient(canvas, config["grad_top"], config["grad_bot"])

    # 2. Subtle film grain
    add_noise(canvas, amount=3)

    # 3. Load and place device frame
    device_img = Image.open(framed_path).convert("RGBA")
    canvas = place_device(canvas, device_img, canvas_w, canvas_h)

    # 4. Bold marketing text
    draw_text_block(
        canvas,
        config["headline"],
        config["sub"],
        config["text_color"],
        config["accent"],
        config["badge"],
        canvas_w,
        canvas_h,
    )

    # 5. Save
    output_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"{stem}.png"
    output_path = output_dir / out_name
    canvas.save(output_path, "PNG", optimize=True)
    print(f"  {stem}")
    return output_path


def process_all(input_dir: Path, output_dir: Path, device: str):
    screenshots = sorted(input_dir.glob("*_framed.png"))
    if not screenshots:
        screenshots = sorted(input_dir.glob("*.png"))
    if not screenshots:
        print(f"No screenshots found in {input_dir}")
        sys.exit(1)

    canvas_size = CANVAS_SIZES.get(device, CANVAS_SIZES["iphone"])
    print(f"\n  Composing {len(screenshots)} {device} screenshots ({canvas_size[0]}×{canvas_size[1]}):\n")

    for ss in screenshots:
        compose_screenshot(ss, output_dir, canvas_size, device)

    print("\n  Done!\n")


def main():
    project_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Compose Kindred App Store screenshots")
    parser.add_argument("--input", "-i", type=Path,
                        default=project_root / "screenshots" / "framed_device" / "iphone")
    parser.add_argument("--output", "-o", type=Path,
                        default=project_root / "screenshots" / "appstore")
    parser.add_argument("--device", "-d", type=str, default="iphone",
                        choices=["iphone", "ipad"])
    args = parser.parse_args()
    process_all(args.input, args.output / args.device, args.device)


if __name__ == "__main__":
    main()
