#!/usr/bin/env python3
"""Compose Kindred's 6.9-inch iPhone and 13-inch iPad App Store galleries."""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / "apps/ios/Kindred/Fonts"
PHOTOS = ROOT / "apps/web/public/demo/photos"
WALL = ROOT / "screenshots/brand/ipad-frosted-glass.jpg"

# Filename, headline, support, simulator attachment, photograph from the iPhone set.
CARDS = (
    ("01_photo_library", "Your whole library", "Browse your photos and videos by date.", "02_photo_library", "family-camper-lights.jpg"),
    ("02_photo_viewer", "Open photos full screen", "Swipe through the collection.", "03_photo_viewer", "family-campervan.jpg"),
    ("03_favorites_and_albums", "Favorites and albums", "Go straight to the photos you saved.", "01_favorites_and_albums", "family-evening.jpg"),
    ("04_photo_search", "Find a photo faster", "Search by subject or narrow by month.", "05_photo_search", "family-three-sunset.jpg"),
    ("05_people", "Browse photos by person", "Open a group to see its photos together.", "04_people", "family-roadtrip.jpg"),
    ("06_media_selection", "Choose what to share", "Select several photos and review them together.", "library-selected-media", "family-campervan.jpg"),
    ("07_backup", "Back up to your NAS", "Set automatic backup and Wi-Fi preferences.", "settings-backup-and-sync", "family-camper-lights.jpg"),
    ("08_backup_activity", "See what backed up", "Check each item and its destination.", "backup-activity", "family-evening.jpg"),
    ("09_pair_device", "Connect another device", "Pair your iPhone or iPad with your server.", "09_login", "family-three-sunset.jpg"),
    ("10_device_settings", "Device settings", "Find backup, storage, and your web settings.", "06_device_settings", "family-roadtrip.jpg"),
)


def font(weight, size):
    return ImageFont.truetype(str(FONTS / f"InstrumentSans-{weight}.ttf"), size)


def fit_type(draw, title, width, size):
    while draw.textlength(title, font=font("Bold", size)) > width:
        size -= 2
    return font("Bold", size)


def canvas(size, tablet, photo, slide):
    if tablet:
        with Image.open(WALL) as asset:
            out = ImageOps.fit(asset.convert("RGB"), size, Image.Resampling.LANCZOS)
        if slide % 3 == 2:
            out = ImageOps.mirror(out)
        return out
    with Image.open(PHOTOS / photo) as asset:
        out = ImageOps.fit(asset.convert("RGB"), size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(17))
    palette = ("#292940", "#252b43", "#302848", "#23353f")
    return Image.blend(out, Image.new("RGB", size, palette[slide % len(palette)]), 0.84)


def screenshot_frame(base, screen, center, width, max_height, tablet):
    ratio = min(width / screen.width, max_height / screen.height)
    screen = screen.resize((round(screen.width * ratio), round(screen.height * ratio)), Image.Resampling.LANCZOS)
    x, y = (base.width - screen.width) // 2, round(center - screen.height / 2)
    radius, bezel = (33, 26) if tablet else (100, 22)
    frame = (x-bezel, y-bezel, x+screen.width+bezel, y+screen.height+bezel)
    overlay = Image.new("RGBA", base.size)
    shadow = Image.new("L", base.size)
    ImageDraw.Draw(shadow).rounded_rectangle((frame[0]+4, frame[1]+30, frame[2]+4, frame[3]+30), radius+bezel, fill=155)
    overlay.putalpha(shadow.filter(ImageFilter.GaussianBlur(49)))
    base.paste(overlay, (0, 0), overlay)
    ImageDraw.Draw(base).rounded_rectangle(frame, radius+bezel, fill="#191b2c", outline="#777690", width=3)
    mask = Image.new("L", screen.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, screen.width-1, screen.height-1), radius, fill=255)
    base.paste(screen, (x, y), mask)


def render(raw, output, tablet, dark, landscape=None):
    size = (2064, 2752) if tablet else (1320, 2868)
    output.mkdir(parents=True, exist_ok=True)
    for slide, (name, title, detail, capture, photo) in enumerate(CARDS):
        source = raw / f"{capture}.png"
        if tablet and slide == 0 and landscape:
            source = landscape
        if tablet and slide == 9 and dark:
            source = dark
        with Image.open(source) as image:
            screen = image.convert("RGB")
        page = canvas(size, tablet, photo, slide)
        draw = ImageDraw.Draw(page)
        margin = 130 if tablet else 105
        label, ink, secondary = ("#57519e", "#1a1935", "#444169") if tablet else ("#d1caff", "#ffffff", "#e3e1ec")
        draw.text((margin, 115 if tablet else 145), "Kindred Photos", font=font("SemiBold", 58 if tablet else 54), fill=label)
        draw.text((margin, 238 if tablet else 250), title,
                  font=fit_type(draw, title, size[0] - 2 * margin, 144 if tablet else 108), fill=ink)
        draw.text((margin, 416 if tablet else 384), detail, font=font("Medium", 56 if tablet else 40), fill=secondary)
        if tablet:
            screenshot_frame(page, screen, center=1580, width=1710, max_height=1792, tablet=True)
        else:
            screenshot_frame(page, screen, center=1660, width=944, max_height=2110, tablet=False)
        page.save(output / f"{name}.png", optimize=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iphone", type=Path, default=Path("/tmp/kindred_screenshots"))
    parser.add_argument("--ipad", type=Path, default=Path("/tmp/kindred_screenshots_ipad"))
    parser.add_argument("--ipad-dark-settings", type=Path)
    parser.add_argument("--ipad-landscape-library", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "screenshots/appstore")
    args = parser.parse_args()
    render(args.iphone, args.output / "iphone69", False, None)
    render(args.ipad, args.output / "ipad", True, args.ipad_dark_settings, args.ipad_landscape_library)


if __name__ == "__main__":
    main()
