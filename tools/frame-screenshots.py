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
        "eyebrow": "LIBRARY",
        "headline": "Everyone you love,\norganized by AI.",
    },
    "03_library_pets": {
        "eyebrow": "LIBRARY",
        "headline": "Your furry family,\nautomatically grouped.",
    },
    "04_search_browse": {
        "eyebrow": "SEARCH",
        "headline": "Find any moment\nin seconds.",
    },
    "05_search_results": {
        "eyebrow": "SEARCH",
        "headline": "Find any moment\nin seconds.",
    },
    "06_photo_detail": {
        "eyebrow": "DETAIL",
        "headline": "Every detail,\nbeautifully presented.",
    },
    "07_together_picker": {
        "eyebrow": "TOGETHER",
        "headline": "Find photos of\npeople together.",
    },
    "08_settings": {
        "eyebrow": "SETTINGS",
        "headline": "Your household,\nyour control.",
    },
    "09_notifications_inbox": {
        "eyebrow": "NOTIFICATIONS",
        "headline": "Stay in the loop\nwith your family.",
    },
    "10_onboarding": {
        "eyebrow": "WELCOME",
        "headline": "A calmer home for\nfamily photos.",
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
# ---------------------------------------------------------------------------
DEVICE_CORNER_RADIUS_RATIO = 0.045   # Corner radius as fraction of width
DEVICE_BORDER_WIDTH_RATIO = 0.008    # Frame border thickness
SCREENSHOT_PADDING_RATIO = 0.06      # Padding around the device frame
HEADER_HEIGHT_RATIO = 0.28           # Portion of canvas for marketing text
DEVICE_AREA_RATIO = 0.68            # Portion of canvas for the device


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
    """Draw a rounded-rect device frame and paste the screenshot inside."""
    x1, y1, x2, y2 = frame_rect
    frame_w = x2 - x1
    frame_h = y2 - y1

    # Resize the screenshot to fit the frame interior
    inset = border_width * 2
    inner_w = frame_w - inset
    inner_h = frame_h - inset

    # Scale screenshot to fill the inner area, maintaining aspect ratio
    ss_ratio = screenshot.width / screenshot.height
    inner_ratio = inner_w / inner_h

    if ss_ratio > inner_ratio:
        # Screenshot is wider — fit to height
        new_h = inner_h
        new_w = int(inner_h * ss_ratio)
    else:
        # Screenshot is taller — fit to width
        new_w = inner_w
        new_h = int(inner_w / ss_ratio)

    resized = screenshot.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Center-crop to inner dimensions
    crop_x = (new_w - inner_w) // 2
    crop_y = (new_h - inner_h) // 2
    cropped = resized.crop((crop_x, crop_y, crop_x + inner_w, crop_y + inner_h))

    draw = ImageDraw.Draw(canvas)

    # Draw the outer frame (dark border)
    draw.rounded_rectangle(
        [x1, y1, x2, y2],
        radius=corner_radius,
        fill=(30, 30, 30),
    )

    # Draw the inner area (slightly lighter, simulating bezel)
    inner_radius = max(corner_radius - border_width, 0)
    draw.rounded_rectangle(
        [x1 + border_width, y1 + border_width, x2 - border_width, y2 - border_width],
        radius=inner_radius,
        fill=(20, 20, 20),
    )

    # Create a mask for the rounded inner area
    mask = Image.new("L", (inner_w, inner_h), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        [0, 0, inner_w, inner_h],
        radius=inner_radius,
        fill=255,
    )

    # Paste the screenshot with the rounded mask
    canvas.paste(cropped, (x1 + border_width, y1 + border_width), mask)

    # Draw the Dynamic Island notch
    island_w = int(frame_w * 0.28)
    island_h = int(frame_w * 0.075)
    island_x = x1 + (frame_w - island_w) // 2
    island_y = y1 + border_width + int(frame_w * 0.035)
    island_radius = island_h // 2

    draw.rounded_rectangle(
        [island_x, island_y, island_x + island_w, island_y + island_h],
        radius=island_radius,
        fill=(15, 15, 15),
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
