#!/usr/bin/env python3
"""
upload-screenshots.py — Upload App Store screenshots directly via App Store Connect API.

No fastlane needed. Uses the App Store Connect REST API with JWT auth.

Usage:
    python3 tools/upload-screenshots.py [--dry-run]
"""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

try:
    import jwt
    import requests
except ImportError:
    print("Missing dependencies. Install with:")
    print("  pip3 install PyJWT cryptography requests")
    sys.exit(1)

PROJECT = Path(__file__).resolve().parent.parent
API_KEY_PATH = PROJECT / "fastlane" / "api_key.json"
SCREENSHOTS_DIR = PROJECT / "screenshots" / "appstore"

BASE_URL = "https://api.appstoreconnect.apple.com/v1"

# App Store Connect display type identifiers
DISPLAY_TYPES = {
    "iphone": "APP_IPHONE_67",        # 6.7" (iPhone 15 Pro Max / 17 Pro Max)
    "ipad":   "APP_IPAD_PRO_3GEN_129", # 12.9" iPad Pro (also covers 13")
}

# Screenshot ordering (position in App Store listing)
SCREENSHOT_ORDER = [
    "01_home_feed",
    "02_library_people",
    "03_person_detail",
    "04_library_pets",
    "05_library_vehicles",
    "06_search_results",
    "07_together_picker",
    "08_settings",
    "09_login",
    "10_onboarding",
]


def load_api_key():
    """Load API key config from JSON file."""
    if not API_KEY_PATH.exists():
        print(f"Error: API key not found at {API_KEY_PATH}")
        print("Create it with: key_id, issuer_id, key fields")
        sys.exit(1)
    with open(API_KEY_PATH) as f:
        return json.load(f)


def generate_token(config):
    """Generate a JWT token for App Store Connect API."""
    return jwt.encode(
        {
            "iss": config["issuer_id"],
            "iat": int(time.time()),
            "exp": int(time.time()) + 1200,
            "aud": "appstoreconnect-v1",
        },
        config["key"],
        algorithm="ES256",
        headers={"kid": config["key_id"]},
    )


def api_get(token, path, params=None):
    """GET request to App Store Connect API."""
    r = requests.get(
        f"{BASE_URL}{path}",
        headers={"Authorization": f"Bearer {token}"},
        params=params,
    )
    r.raise_for_status()
    return r.json()


def api_post(token, path, payload):
    """POST request to App Store Connect API."""
    r = requests.post(
        f"{BASE_URL}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    if not r.ok:
        print(f"  POST {path} failed: {r.status_code}")
        print(f"  {r.text[:500]}")
    r.raise_for_status()
    return r.json()


def api_patch(token, path, payload):
    """PATCH request to App Store Connect API."""
    r = requests.patch(
        f"{BASE_URL}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    if not r.ok:
        print(f"  PATCH {path} failed: {r.status_code}")
        print(f"  {r.text[:500]}")
    r.raise_for_status()
    return r.json()


def api_delete(token, path):
    """DELETE request to App Store Connect API."""
    r = requests.delete(
        f"{BASE_URL}{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    if not r.ok and r.status_code != 404:
        print(f"  DELETE {path} failed: {r.status_code}")
    return r.status_code


def find_app(token, bundle_id):
    """Find the app by bundle ID."""
    data = api_get(token, "/apps", {"filter[bundleId]": bundle_id})
    apps = data.get("data", [])
    if not apps:
        print(f"Error: No app found with bundle ID '{bundle_id}'")
        print("Make sure the app is created in App Store Connect first.")
        sys.exit(1)
    return apps[0]


def get_app_store_version(token, app_id):
    """Get the editable App Store version (or latest)."""
    data = api_get(token, f"/apps/{app_id}/appStoreVersions", {
        "filter[platform]": "IOS",
        "limit": 5,
    })
    versions = data.get("data", [])
    # Prefer editable version (PREPARE_FOR_SUBMISSION, etc.)
    for v in versions:
        state = v["attributes"]["appStoreState"]
        if state in ("PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"):
            return v
    # Fall back to first version
    if versions:
        return versions[0]
    print("Error: No App Store version found. Create one in App Store Connect first.")
    sys.exit(1)


def get_localizations(token, version_id):
    """Get version localizations."""
    data = api_get(token, f"/appStoreVersions/{version_id}/appStoreVersionLocalizations")
    return data.get("data", [])


def get_screenshot_sets(token, localization_id):
    """Get screenshot sets for a localization."""
    data = api_get(token, f"/appStoreVersionLocalizations/{localization_id}/appScreenshotSets")
    return data.get("data", [])


def get_screenshots(token, set_id):
    """Get existing screenshots in a set."""
    data = api_get(token, f"/appScreenshotSets/{set_id}/appScreenshots")
    return data.get("data", [])


def create_screenshot_set(token, localization_id, display_type):
    """Create a screenshot set for a display type."""
    payload = {
        "data": {
            "type": "appScreenshotSets",
            "attributes": {
                "screenshotDisplayType": display_type,
            },
            "relationships": {
                "appStoreVersionLocalization": {
                    "data": {
                        "type": "appStoreVersionLocalizations",
                        "id": localization_id,
                    }
                }
            },
        }
    }
    return api_post(token, "/appScreenshotSets", payload)["data"]


def upload_screenshot(token, set_id, file_path, position):
    """Upload a single screenshot: reserve → upload parts → commit."""
    file_size = file_path.stat().st_size
    file_name = file_path.name

    # Step 1: Reserve
    reservation = api_post(token, "/appScreenshots", {
        "data": {
            "type": "appScreenshots",
            "attributes": {
                "fileName": file_name,
                "fileSize": file_size,
            },
            "relationships": {
                "appScreenshotSet": {
                    "data": {
                        "type": "appScreenshotSets",
                        "id": set_id,
                    }
                }
            },
        }
    })

    screenshot_data = reservation["data"]
    screenshot_id = screenshot_data["id"]
    upload_ops = screenshot_data["attributes"].get("uploadOperations", [])

    if not upload_ops:
        print(f"    Warning: No upload operations returned for {file_name}")
        return screenshot_id

    # Step 2: Upload parts
    file_data = file_path.read_bytes()
    for op in upload_ops:
        url = op["url"]
        headers = {h["name"]: h["value"] for h in op.get("requestHeaders", [])}
        offset = op["offset"]
        length = op["length"]
        chunk = file_data[offset:offset + length]

        r = requests.put(url, headers=headers, data=chunk)
        if not r.ok:
            print(f"    Upload chunk failed: {r.status_code}")
            r.raise_for_status()

    # Step 3: Commit
    md5 = hashlib.md5(file_data).hexdigest()
    api_patch(token, f"/appScreenshots/{screenshot_id}", {
        "data": {
            "type": "appScreenshots",
            "id": screenshot_id,
            "attributes": {
                "sourceFileChecksum": md5,
                "uploaded": True,
            },
        }
    })

    return screenshot_id


def main():
    parser = argparse.ArgumentParser(description="Upload screenshots to App Store Connect")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be uploaded without uploading")
    parser.add_argument("--bundle-id", default="com.kindlingsignal.kindred", help="App bundle ID")
    args = parser.parse_args()

    print("\n  Kindred Photos — App Store Connect Screenshot Uploader\n")

    # Load API key and auth
    config = load_api_key()
    token = generate_token(config)
    print(f"  API Key:   {config['key_id']}")
    print(f"  Bundle ID: {args.bundle_id}")

    # Find app
    print("\n  Finding app...")
    app = find_app(token, args.bundle_id)
    app_id = app["id"]
    app_name = app["attributes"]["name"]
    print(f"  Found: {app_name} ({app_id})")

    # Get version
    print("  Finding App Store version...")
    version = get_app_store_version(token, app_id)
    version_id = version["id"]
    version_string = version["attributes"]["versionString"]
    state = version["attributes"]["appStoreState"]
    print(f"  Version: {version_string} ({state})")

    # Get en-US localization
    print("  Finding en-US localization...")
    localizations = get_localizations(token, version_id)
    en_loc = None
    for loc in localizations:
        if loc["attributes"]["locale"] == "en-US":
            en_loc = loc
            break
    if not en_loc:
        print("  Error: No en-US localization found")
        sys.exit(1)
    loc_id = en_loc["id"]
    print(f"  Localization: en-US ({loc_id})")

    # Process each device type
    for device, display_type in DISPLAY_TYPES.items():
        device_dir = SCREENSHOTS_DIR / device
        if not device_dir.exists():
            print(f"\n  Skipping {device} — no screenshots at {device_dir}")
            continue

        screenshots = sorted(device_dir.glob("*.png"))
        if not screenshots:
            print(f"\n  Skipping {device} — no PNG files found")
            continue

        print(f"\n  === {device.upper()} ({display_type}) — {len(screenshots)} screenshots ===\n")

        # Get or create screenshot set
        sets = get_screenshot_sets(token, loc_id)
        target_set = None
        for s in sets:
            if s["attributes"]["screenshotDisplayType"] == display_type:
                target_set = s
                break

        if target_set:
            set_id = target_set["id"]
            # Delete existing screenshots
            existing = get_screenshots(token, set_id)
            if existing:
                print(f"  Deleting {len(existing)} existing screenshots...")
                for ex in existing:
                    api_delete(token, f"/appScreenshots/{ex['id']}")
        else:
            print(f"  Creating screenshot set for {display_type}...")
            target_set = create_screenshot_set(token, loc_id, display_type)
            set_id = target_set["id"]

        # Upload each screenshot
        for i, ss_path in enumerate(screenshots):
            stem = ss_path.stem
            size_kb = ss_path.stat().st_size // 1024

            if args.dry_run:
                print(f"  [DRY RUN] Would upload: {ss_path.name} ({size_kb} KB)")
            else:
                print(f"  Uploading {ss_path.name} ({size_kb} KB)...", end="", flush=True)
                try:
                    upload_screenshot(token, set_id, ss_path, i)
                    print(" OK")
                except Exception as e:
                    print(f" FAILED: {e}")

    print("\n  Done!\n")
    if not args.dry_run:
        print("  Check your screenshots at: https://appstoreconnect.apple.com")
    print()


if __name__ == "__main__":
    main()
