#!/usr/bin/env python3
"""
compose-screenshots.py — Kindred Photos App Store screenshot composer.

Takes device-framed screenshots (from frames-cli with transparent bg) and
composites them onto rich gradient backgrounds with marketing copy.

Usage:
    python3 compose-screenshots.py [--input DIR] [--output DIR] [--device iphone|ipad]
"""

import argparse
import math
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    print("Error: Pillow required. pip install Pillow")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Kindred brand palette
# ---------------------------------------------------------------------------
PAPER   = (251, 244, 231)       # #FBF4E7
ASH     = (42, 32, 27)          # #2A201B
EMBER   = (201, 85, 28)         # #C9551C
CANVAS  = (247, 235, 212)       # #F7EBD4
GOLD    = (233, 184, 93)        # #E9B85D
PINE    = (109, 60, 36)         # #6D3C24
FOREST  = (47, 74, 54)          # #2F4A36
CARD    = (255, 253, 248)       # #FFFDF8

# Background gradient pairs per screenshot (warm, editorial, varied)
GRADIENTS = {
    "01_home_feed":       ((251, 244, 231), (240, 220, 190)),   # paper → warm sand
    "02_library_people":  ((245, 235, 218), (230, 210, 185)),   # canvas → honey
    "03_person_detail":   ((42, 32, 27),    (75, 55, 40)),      # ash → dark mocha (dark bg)
    "04_library_pets":    ((235, 245, 230), (210, 230, 200)),   # soft sage → mint
    "05_library_vehicles":((240, 235, 225), (220, 215, 200)),   # warm grey → slate
    "06_search_results":  ((251, 244, 231), (235, 225, 200)),   # paper → warm canvas
    "07_together_picker": ((250, 240, 225), (245, 225, 200)),   # cream → peach
    "08_settings":        ((245, 240, 232), (235, 228, 215)),   # light paper → soft canvas
    "09_login":           ((47, 74, 54),    (35, 55, 40)),      # forest → deep forest (dark bg)
    "10_onboarding":      ((47, 74, 54),    (30, 50, 35)),      # forest → deep green (dark bg)
}

# Whether text should be light (for dark backgrounds)
DARK_BG = {"03_person_detail", "09_login", "10_onboarding"}

# Marketing copy per screenshot
COPY = {
    "01_home_feed": {
        "eyebrow": "HOME",
        "headline": "A calmer home for\nfamily photos.",
    },
    "02_library_people": {
        "eyebrow": "PEOPLE",
        "headline": "Everyone you love,\norganized by AI.",
    },
    "03_person_detail": {
        "eyebrow": "EVERY DETAIL",
        "headline": "See the full story\nbehind every photo.",
    },
    "04_library_pets": {
        "eyebrow": "PETS TOO",
        "headline": "They're family.\nWe know that.",
    },
    "05_library_vehicles": {
        "eyebrow": "VEHICLES",
        "headline": "Every car, every trip,\nautomatically tracked.",
    },
    "06_search_results": {
        "eyebrow": "FIND ANYTHING",
        "headline": "Search the way\nyou remember.",
    },
    "07_together_picker": {
        "eyebrow": "TOGETHER",
        "headline": "Find every photo of\nthe people who matter.",
    },
    "08_settings": {
        "eyebrow": "YOUR HOUSEHOLD",
        "headline": "Built for the whole\nfamily to share.",
    },
    "09_login": {
        "eyebrow": "GET STARTED",
        "headline": "Sign in with Flickr.\nThat's it.",
    },
    "10_onboarding": {
        "eyebrow": "WELCOME",
        "headline": "Private. Warm.\nCompletely yours.",
    },
}

# App Store canvas sizes
CANVAS_SIZES = {
    "iphone":  (1320, 2868),   # iPhone 17 Pro Max (6.9")
    "ipad":    (2064, 2752),   # iPad Pro 13" (2024)
}


# ---------------------------------------------------------------------------
# Font loading
# ---------------------------------------------------------------------------
def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    project_root = Path(__file__).resolve().parent.parent
    ios_fonts = project_root / "apps" / "ios" / "Kindred" / "Fonts"

    candidates = []
    if "SpaceGrotesk" in name:
        candidates = [
            ios_fonts / f"{name}.ttf",
            ios_fonts / "SpaceGrotesk-Bold.ttf",
        ]
    elif "IBMPlexMono" in name:
        candidates = [
            ios_fonts / f"{name}.ttf",
            ios_fonts / "IBMPlexMono-SemiBold.ttf",
        ]

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
# Gradient drawing
# ---------------------------------------------------------------------------
def draw_gradient(canvas: Image.Image, top_color: tuple, bottom_color: tuple):
    """Draw a smooth vertical gradient with a subtle diagonal warmth."""
    draw = ImageDraw.Draw(canvas)
    w, h = canvas.size
    for y in range(h):
        t = y / h
        # Ease-in-out curve for smoother transition
        t = t * t * (3 - 2 * t)
        r = int(top_color[0] + (bottom_color[0] - top_color[0]) * t)
        g = int(top_color[1] + (bottom_color[1] - top_color[1]) * t)
        b = int(top_color[2] + (bottom_color[2] - top_color[2]) * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))


def add_subtle_texture(canvas: Image.Image, opacity: int = 6):
    """Add a very faint grain texture for warmth."""
    import random
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    pixels = overlay.load()
    w, h = canvas.size
    random.seed(42)  # Reproducible
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            v = random.randint(-opacity, opacity)
            a = abs(v)
            c = 255 if v > 0 else 0
            pixels[x, y] = (c, c, c, a)
    canvas.paste(Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB"))


def draw_decorative_elements(canvas: Image.Image, stem: str, is_dark: bool):
    """Add subtle decorative elements — thin accent lines, small dots."""
    draw = ImageDraw.Draw(canvas)
    w, h = canvas.size
    accent = GOLD if not is_dark else (233, 184, 93, 180)
    line_color = (*EMBER, 30) if not is_dark else (255, 255, 255, 20)

    # Thin horizontal accent line above the device
    line_y = int(h * 0.30)
    line_margin = int(w * 0.08)

    # Use RGBA overlay for transparent lines
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)

    # Subtle thin line
    odraw.line(
        [(line_margin, line_y), (w - line_margin, line_y)],
        fill=line_color,
        width=1,
    )

    # Small accent dot near the eyebrow
    dot_x = line_margin
    dot_y = int(h * 0.06)
    dot_r = 4
    dot_color = (*EMBER, 200) if not is_dark else (*GOLD, 200)
    odraw.ellipse(
        [dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r],
        fill=dot_color,
    )

    canvas.paste(Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB"))


# ---------------------------------------------------------------------------
# Text rendering
# ---------------------------------------------------------------------------
def draw_marketing_text(
    canvas: Image.Image,
    eyebrow: str,
    headline: str,
    text_area: tuple[int, int, int, int],
    is_dark: bool = False,
):
    draw = ImageDraw.Draw(canvas)
    x1, y1, x2, y2 = text_area
    area_w = x2 - x1
    area_h = y2 - y1

    # Font sizes relative to canvas width
    headline_size = int(canvas.width * 0.062)
    eyebrow_size = int(canvas.width * 0.02)

    headline_font = load_font("SpaceGrotesk-Bold", headline_size)
    eyebrow_font = load_font("IBMPlexMono-SemiBold", eyebrow_size)

    # Colors
    eyebrow_color = EMBER if not is_dark else GOLD
    headline_color = ASH if not is_dark else PAPER

    # Measure text
    eyebrow_bbox = draw.textbbox((0, 0), eyebrow, font=eyebrow_font)
    eyebrow_h = eyebrow_bbox[3] - eyebrow_bbox[1]

    headline_bbox = draw.multiline_textbbox((0, 0), headline, font=headline_font, spacing=12)
    headline_h = headline_bbox[3] - headline_bbox[1]

    gap = int(area_h * 0.06)
    total_h = eyebrow_h + gap + headline_h

    # Vertically center in text area
    start_y = y1 + (area_h - total_h) // 2
    left_margin = x1 + int(area_w * 0.08)

    # Draw eyebrow (tracked mono)
    draw.text(
        (left_margin, start_y),
        eyebrow,
        font=eyebrow_font,
        fill=eyebrow_color,
    )

    # Draw headline
    draw.multiline_text(
        (left_margin, start_y + eyebrow_h + gap),
        headline,
        font=headline_font,
        fill=headline_color,
        spacing=12,
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
    info = COPY.get(stem, {"eyebrow": stem.upper(), "headline": "Kindred Photos"})
    grad = GRADIENTS.get(stem, (PAPER, CANVAS))
    is_dark = stem in DARK_BG

    canvas_w, canvas_h = canvas_size
    canvas = Image.new("RGB", (canvas_w, canvas_h), grad[0])

    # 1. Draw gradient background
    draw_gradient(canvas, grad[0], grad[1])

    # 2. Add subtle grain texture
    add_subtle_texture(canvas, opacity=5)

    # 3. Add decorative elements
    draw_decorative_elements(canvas, stem, is_dark)

    # 4. Load the device-framed screenshot (RGBA with transparent bg)
    device_img = Image.open(framed_path).convert("RGBA")

    # 5. Calculate placement — device in bottom 68%, text in top 32%
    text_ratio = 0.30
    device_ratio = 0.72   # Slightly overlap to feel grounded
    padding = int(canvas_w * 0.04)

    # Scale device to fit
    max_device_w = canvas_w - padding * 2
    max_device_h = int(canvas_h * device_ratio)

    scale = min(max_device_w / device_img.width, max_device_h / device_img.height)
    new_w = int(device_img.width * scale)
    new_h = int(device_img.height * scale)
    device_resized = device_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Position: centered horizontally, bottom-aligned with slight overflow
    device_x = (canvas_w - new_w) // 2
    device_y = canvas_h - new_h + int(canvas_h * 0.02)  # Slight overflow at bottom

    # 6. Add device shadow
    shadow = Image.new("RGBA", (new_w + 60, new_h + 60), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        [30, 30, new_w + 30, new_h + 30],
        radius=int(new_w * 0.08),
        fill=(0, 0, 0, 40),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=25))
    canvas_rgba = canvas.convert("RGBA")
    canvas_rgba.paste(shadow, (device_x - 30, device_y - 20), shadow)

    # 7. Paste device frame
    canvas_rgba.paste(device_resized, (device_x, device_y), device_resized)
    canvas = canvas_rgba.convert("RGB")

    # 8. Draw marketing text in the top area
    text_area_h = int(canvas_h * text_ratio)
    draw_marketing_text(
        canvas,
        info["eyebrow"],
        info["headline"],
        (0, 0, canvas_w, text_area_h),
        is_dark=is_dark,
    )

    # 9. Save
    output_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"{stem}.png"
    output_path = output_dir / out_name
    canvas.save(output_path, "PNG", optimize=True)
    print(f"  Composed: {output_path.name}")
    return output_path


def process_all(input_dir: Path, output_dir: Path, device: str):
    screenshots = sorted(input_dir.glob("*_framed.png"))
    if not screenshots:
        screenshots = sorted(input_dir.glob("*.png"))

    if not screenshots:
        print(f"No screenshots found in {input_dir}")
        sys.exit(1)

    canvas_size = CANVAS_SIZES.get(device, CANVAS_SIZES["iphone"])
    print(f"Composing {len(screenshots)} {device} screenshots ({canvas_size[0]}x{canvas_size[1]}):")

    for ss in screenshots:
        compose_screenshot(ss, output_dir, canvas_size, device)

    print("\nDone!")


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
