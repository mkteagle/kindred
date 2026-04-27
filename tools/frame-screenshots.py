#!/usr/bin/env python3
"""
frame-screenshots.py — Kindred Photos App Store screenshot framing tool.

Takes raw simulator screenshots and composites them onto device frames with
marketing copy, using the Kindred brand palette and typography.

Usage:
    python3 frame-screenshots.py [--input DIR] [--output DIR] [--sizes SIZE,...]

Requirements:
    pip install Pillow

Output sizes (App Store required):
    - 1290x2796 (6.7" iPhone 15 Pro Max)
    - 1179x2556 (6.1" iPhone 15 Pro)
"""

import argparse
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    print("Error: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Kindred brand palette
# ---------------------------------------------------------------------------
PAPER = (251, 244, 231)       # #FBF4E7
ASH = (42, 32, 27)            # #2A201B
EMBER = (201, 85, 28)         # #C9551C
CANVAS = (247, 235, 212)      # #F7EBD4
MIST = (125, 85, 63)          # #7D553F
GOLD = (233, 184, 93)         # #E9B85D
PINE = (109, 60, 36)          # #6D3C24

# ---------------------------------------------------------------------------
# Marketing copy per screenshot
# ---------------------------------------------------------------------------
MARKETING_TEXT = {
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

# ---------------------------------------------------------------------------
# App Store required sizes
# ---------------------------------------------------------------------------
FRAME_SIZES = {
    "6.7": (1290, 2796),  # iPhone 15 Pro Max
    "6.1": (1179, 2556),  # iPhone 15 Pro
}

# ---------------------------------------------------------------------------
# Device frame dimensions (relative to output canvas)
# Modeled after iPhone 15 Pro: ~55pt corner radius at 3x = 165px / 1290 ≈ 0.128
# ---------------------------------------------------------------------------
DEVICE_CORNER_RADIUS_RATIO = 0.125   # Rounded like a real iPhone 15 Pro
DEVICE_BORDER_WIDTH_RATIO = 0.004    # Very thin titanium edge
SCREENSHOT_PADDING_RATIO = 0.05      # Padding around the device frame
HEADER_HEIGHT_RATIO = 0.26           # Portion of canvas for marketing text
DEVICE_AREA_RATIO = 0.70             # Portion of canvas for the device


# ---------------------------------------------------------------------------
# Font loading
# ---------------------------------------------------------------------------

def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    """Try to load a font by name, with fallbacks."""
    # Paths to check for the font
    font_candidates = []

    # Kindred project fonts directory
    project_root = Path(__file__).resolve().parent.parent
    ios_fonts = project_root / "apps" / "ios" / "Kindred" / "Fonts"

    if "SpaceGrotesk" in name or "spacegrotesk" in name.lower():
        font_candidates.extend([
            ios_fonts / f"{name}.ttf",
            ios_fonts / "SpaceGrotesk-Bold.ttf",
            Path.home() / "Library" / "Fonts" / f"{name}.ttf",
            Path("/System/Library/Fonts") / f"{name}.ttf",
        ])
    elif "InstrumentSans" in name or "instrumentsans" in name.lower():
        font_candidates.extend([
            ios_fonts / f"{name}.ttf",
            ios_fonts / "InstrumentSans-Regular.ttf",
            Path.home() / "Library" / "Fonts" / f"{name}.ttf",
        ])
    elif "IBMPlexMono" in name or "ibmplexmono" in name.lower():
        font_candidates.extend([
            ios_fonts / f"{name}.ttf",
            ios_fonts / "IBMPlexMono-SemiBold.ttf",
            Path.home() / "Library" / "Fonts" / f"{name}.ttf",
        ])

    # Generic fallbacks
    font_candidates.extend([
        Path("/System/Library/Fonts/SFProDisplay-Bold.otf"),
        Path("/System/Library/Fonts/Helvetica.ttc"),
        Path("/System/Library/Fonts/SFNS.ttf"),
    ])

    for path in font_candidates:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except (OSError, IOError):
                continue

    # Ultimate fallback
    return ImageFont.load_default()


def get_headline_font(canvas_width: int) -> ImageFont.FreeTypeFont:
    size = int(canvas_width * 0.058)
    return load_font("SpaceGrotesk-Bold", size)


def get_eyebrow_font(canvas_width: int) -> ImageFont.FreeTypeFont:
    size = int(canvas_width * 0.022)
    return load_font("IBMPlexMono-SemiBold", size)


# ---------------------------------------------------------------------------
# Device frame drawing
# ---------------------------------------------------------------------------

def draw_device_frame(
    canvas: Image.Image,
    screenshot: Image.Image,
    frame_rect: tuple[int, int, int, int],
    corner_radius: int,
    border_width: int,
) -> None:
    """Draw an iPhone 15 Pro-style device frame and paste the screenshot inside.

    The real iPhone 15 Pro has:
    - Titanium edge (~2-3px visible at this scale)
    - Very large corner radius (~55pt = 165px at 3x)
    - Screen that extends nearly edge-to-edge
    - Dynamic Island: ~126x37pt = 378x111px at 3x
    """
    x1, y1, x2, y2 = frame_rect
    frame_w = x2 - x1
    frame_h = y2 - y1

    # The screen is inset from the outer edge by the border
    screen_x1 = x1 + border_width
    screen_y1 = y1 + border_width
    screen_x2 = x2 - border_width
    screen_y2 = y2 - border_width
    screen_w = screen_x2 - screen_x1
    screen_h = screen_y2 - screen_y1

    # Scale screenshot to fill the screen area
    ss_ratio = screenshot.width / screenshot.height
    screen_ratio = screen_w / screen_h

    if ss_ratio > screen_ratio:
        new_h = screen_h
        new_w = int(screen_h * ss_ratio)
    else:
        new_w = screen_w
        new_h = int(screen_w / ss_ratio)

    resized = screenshot.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Center-crop to screen dimensions
    crop_x = (new_w - screen_w) // 2
    crop_y = (new_h - screen_h) // 2
    cropped = resized.crop((crop_x, crop_y, crop_x + screen_w, crop_y + screen_h))

    draw = ImageDraw.Draw(canvas)
    screen_radius = max(corner_radius - border_width, 4)

    # 1. Draw outer shadow (soft, large, behind everything)
    shadow_expand = int(frame_w * 0.02)
    for i in range(shadow_expand, 0, -1):
        alpha_factor = 1 - (i / shadow_expand)
        shade = int(12 * alpha_factor)
        shadow_color = (
            max(PAPER[0] - shade, 0),
            max(PAPER[1] - shade, 0),
            max(PAPER[2] - shade, 0),
        )
        draw.rounded_rectangle(
            [x1 - i, y1 - i + 2, x2 + i, y2 + i + 4],
            radius=corner_radius + i,
            fill=shadow_color,
        )

    # 2. Draw the titanium outer frame
    # Subtle gradient: dark edge with a slight metallic highlight
    draw.rounded_rectangle(
        [x1, y1, x2, y2],
        radius=corner_radius,
        fill=(58, 58, 60),  # Natural titanium tone
    )
    # Inner highlight to simulate the chamfered edge
    draw.rounded_rectangle(
        [x1 + 1, y1 + 1, x2 - 1, y2 - 1],
        radius=corner_radius - 1,
        fill=(48, 48, 50),
    )

    # 3. Draw the black bezel (very thin, between frame and screen)
    draw.rounded_rectangle(
        [screen_x1, screen_y1, screen_x2, screen_y2],
        radius=screen_radius,
        fill=(0, 0, 0),
    )

    # 4. Create rounded mask for the screen content
    mask = Image.new("L", (screen_w, screen_h), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        [0, 0, screen_w, screen_h],
        radius=screen_radius,
        fill=255,
    )

    # 5. Paste the screenshot
    canvas.paste(cropped, (screen_x1, screen_y1), mask)

    # 6. Side buttons (power on right, volume on left) — subtle details
    button_color = (52, 52, 54)
    # Power button (right side)
    power_y = y1 + int(frame_h * 0.28)
    power_h = int(frame_h * 0.06)
    draw.rounded_rectangle(
        [x2, power_y, x2 + 2, power_y + power_h],
        radius=1,
        fill=button_color,
    )
    # Volume up (left side)
    vol_up_y = y1 + int(frame_h * 0.22)
    vol_h = int(frame_h * 0.04)
    draw.rounded_rectangle(
        [x1 - 2, vol_up_y, x1, vol_up_y + vol_h],
        radius=1,
        fill=button_color,
    )
    # Volume down (left side)
    vol_down_y = vol_up_y + vol_h + int(frame_h * 0.015)
    draw.rounded_rectangle(
        [x1 - 2, vol_down_y, x1, vol_down_y + vol_h],
        radius=1,
        fill=button_color,
    )


def draw_marketing_text(
    canvas: Image.Image,
    eyebrow: str,
    headline: str,
    text_area: tuple[int, int, int, int],
) -> None:
    """Draw the marketing eyebrow and headline text."""
    draw = ImageDraw.Draw(canvas)
    x1, y1, x2, y2 = text_area
    area_w = x2 - x1
    area_h = y2 - y1

    headline_font = get_headline_font(canvas.width)
    eyebrow_font = get_eyebrow_font(canvas.width)

    # Vertical centering: measure total text height
    eyebrow_bbox = draw.textbbox((0, 0), eyebrow, font=eyebrow_font)
    eyebrow_h = eyebrow_bbox[3] - eyebrow_bbox[1]

    headline_bbox = draw.multiline_textbbox((0, 0), headline, font=headline_font, spacing=8)
    headline_h = headline_bbox[3] - headline_bbox[1]

    spacing_between = int(area_h * 0.05)
    total_h = eyebrow_h + spacing_between + headline_h

    start_y = y1 + (area_h - total_h) // 2

    # Draw eyebrow
    draw.text(
        (x1 + int(area_w * 0.08), start_y),
        eyebrow,
        font=eyebrow_font,
        fill=EMBER,
    )

    # Draw headline
    draw.multiline_text(
        (x1 + int(area_w * 0.08), start_y + eyebrow_h + spacing_between),
        headline,
        font=headline_font,
        fill=ASH,
        spacing=8,
    )


def add_subtle_gradient(canvas: Image.Image) -> None:
    """Add a subtle warm gradient overlay to the background."""
    gradient = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(gradient)

    # Very subtle gradient from paper at top to slightly warmer at bottom
    for y in range(canvas.height):
        t = y / canvas.height
        # Blend from pure paper to a slightly warmer tone
        r = int(PAPER[0] + (CANVAS[0] - PAPER[0]) * t * 0.3)
        g = int(PAPER[1] + (CANVAS[1] - PAPER[1]) * t * 0.3)
        b = int(PAPER[2] + (CANVAS[2] - PAPER[2]) * t * 0.3)
        draw.line([(0, y), (canvas.width, y)], fill=(r, g, b, 15))

    canvas.paste(Image.alpha_composite(canvas.convert("RGBA"), gradient).convert("RGB"))


# ---------------------------------------------------------------------------
# Main framing pipeline
# ---------------------------------------------------------------------------

def frame_screenshot(
    screenshot_path: Path,
    output_dir: Path,
    canvas_size: tuple[int, int],
    size_label: str,
) -> Path:
    """Frame a single screenshot and save the result."""
    stem = screenshot_path.stem
    copy_info = MARKETING_TEXT.get(stem, {
        "eyebrow": stem.upper(),
        "headline": "Kindred Photos",
    })

    canvas_w, canvas_h = canvas_size
    canvas = Image.new("RGB", (canvas_w, canvas_h), PAPER)

    # Add subtle background gradient
    add_subtle_gradient(canvas)

    # Load the raw screenshot
    screenshot = Image.open(screenshot_path).convert("RGB")

    # Calculate layout regions
    padding = int(canvas_w * SCREENSHOT_PADDING_RATIO)
    header_h = int(canvas_h * HEADER_HEIGHT_RATIO)

    # Device frame area
    device_area_h = int(canvas_h * DEVICE_AREA_RATIO)
    device_w = canvas_w - (padding * 2)
    device_h = device_area_h

    # Maintain reasonable device aspect ratio (~19.5:9 for modern iPhones)
    target_device_ratio = 19.5 / 9.0
    if device_h / device_w > target_device_ratio:
        device_h = int(device_w * target_device_ratio)
    elif device_w / device_h > 1 / target_device_ratio:
        device_w = int(device_h / target_device_ratio)

    device_x = (canvas_w - device_w) // 2
    device_y = header_h + (canvas_h - header_h - device_h) // 2 - padding // 2

    corner_radius = int(device_w * DEVICE_CORNER_RADIUS_RATIO)
    border_width = max(int(device_w * DEVICE_BORDER_WIDTH_RATIO), 3)

    # Draw the device frame with screenshot
    draw_device_frame(
        canvas,
        screenshot,
        (device_x, device_y, device_x + device_w, device_y + device_h),
        corner_radius,
        border_width,
    )

    # Draw marketing text in the header area
    draw_marketing_text(
        canvas,
        copy_info["eyebrow"],
        copy_info["headline"],
        (0, 0, canvas_w, header_h),
    )

    # Add a subtle drop shadow under the device frame
    # (We'll just darken pixels near the bottom of the device)
    shadow_draw = ImageDraw.Draw(canvas)
    shadow_y = device_y + device_h + 5
    for i in range(20):
        alpha = int(15 * (1 - i / 20))
        color = (
            max(PAPER[0] - alpha * 2, 0),
            max(PAPER[1] - alpha * 2, 0),
            max(PAPER[2] - alpha * 2, 0),
        )
        shadow_draw.ellipse(
            [
                device_x + int(device_w * 0.1),
                shadow_y + i,
                device_x + device_w - int(device_w * 0.1),
                shadow_y + i + 4,
            ],
            fill=color,
        )

    # Save
    output_subdir = output_dir / size_label
    output_subdir.mkdir(parents=True, exist_ok=True)
    output_path = output_subdir / f"{stem}.png"
    canvas.save(output_path, "PNG", optimize=True)
    print(f"  Framed: {output_path}")
    return output_path


def process_all(input_dir: Path, output_dir: Path, sizes: list[str]) -> None:
    """Process all screenshots in the input directory."""
    # Find all PNG screenshots
    screenshots = sorted(input_dir.glob("*.png"))

    if not screenshots:
        print(f"No PNG files found in {input_dir}")
        print("Looking for screenshots in subdirectories...")
        screenshots = sorted(input_dir.rglob("*.png"))

    if not screenshots:
        print("No screenshots found. Run the UI tests first.")
        sys.exit(1)

    print(f"Found {len(screenshots)} screenshots to frame.")
    print(f"Output sizes: {', '.join(sizes)}")
    print()

    for size_label in sizes:
        if size_label not in FRAME_SIZES:
            print(f"Warning: Unknown size '{size_label}', skipping.")
            continue

        canvas_size = FRAME_SIZES[size_label]
        print(f"Generating {size_label}\" frames ({canvas_size[0]}x{canvas_size[1]}):")

        for ss_path in screenshots:
            frame_screenshot(ss_path, output_dir, canvas_size, size_label)

        print()

    print("Done!")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    project_root = Path(__file__).resolve().parent.parent

    parser = argparse.ArgumentParser(
        description="Frame Kindred Photos screenshots for the App Store."
    )
    parser.add_argument(
        "--input", "-i",
        type=Path,
        default=project_root / "screenshots" / "raw",
        help="Directory containing raw screenshots (default: screenshots/raw/)",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=project_root / "screenshots" / "framed",
        help="Output directory for framed screenshots (default: screenshots/framed/)",
    )
    parser.add_argument(
        "--sizes", "-s",
        type=str,
        default="6.7,6.1",
        help='Comma-separated size labels (default: "6.7,6.1")',
    )

    args = parser.parse_args()
    sizes = [s.strip() for s in args.sizes.split(",")]

    args.input.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)

    process_all(args.input, args.output, sizes)


if __name__ == "__main__":
    main()
