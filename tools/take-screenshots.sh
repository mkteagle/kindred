#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# take-screenshots.sh — Kindred Photos App Store screenshot pipeline
#
# This script:
#   1. Runs the KindredScreenshots UI tests on the simulator
#   2. Extracts raw screenshots from the .xcresult bundle
#   3. Runs the framing script to add device frames + marketing text
#
# Usage:
#   ./tools/take-screenshots.sh [--device "iPhone 15 Pro Max"] [--skip-tests]
#
# Requirements:
#   - Xcode 16+
#   - Python 3 with Pillow (pip install Pillow)
#   - xcparse (brew install chargepoint/xcparse/xcparse) or
#     xcresulttool (bundled with Xcode)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$PROJECT_ROOT/apps/ios"
SCREENSHOTS_DIR="$PROJECT_ROOT/screenshots"
RAW_DIR="$SCREENSHOTS_DIR/raw"
FRAMED_DIR="$SCREENSHOTS_DIR/framed"
RESULT_BUNDLE="$IOS_DIR/TestResults.xcresult"

# Defaults
DEVICE="iPhone 15 Pro Max"
SKIP_TESTS=false
SIZES="6.7,6.1"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --device)
            DEVICE="$2"
            shift 2
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --sizes)
            SIZES="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--device DEVICE] [--skip-tests] [--sizes SIZES]"
            echo ""
            echo "Options:"
            echo "  --device DEVICE    Simulator device name (default: iPhone 15 Pro Max)"
            echo "  --skip-tests       Skip running UI tests; use existing .xcresult"
            echo "  --sizes SIZES      Comma-separated size labels (default: 6.7,6.1)"
            echo ""
            echo "Sizes: 6.7 (1290x2796), 6.1 (1179x2556)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
echo "=== Kindred Photos Screenshot Pipeline ==="
echo "  Project:    $IOS_DIR"
echo "  Device:     $DEVICE"
echo "  Output:     $SCREENSHOTS_DIR"
echo ""

mkdir -p "$RAW_DIR" "$FRAMED_DIR"

# ---------------------------------------------------------------------------
# Step 1: Run UI tests
# ---------------------------------------------------------------------------
if [ "$SKIP_TESTS" = false ]; then
    echo "--- Step 1: Running UI tests on simulator ---"
    echo ""

    # Clean previous results
    rm -rf "$RESULT_BUNDLE"

    # Boot the simulator if needed
    echo "Checking simulator status..."
    DEVICE_UDID=$(xcrun simctl list devices available | grep "$DEVICE" | head -1 | grep -oE '[A-F0-9-]{36}') || true
    if [ -n "$DEVICE_UDID" ]; then
        BOOT_STATE=$(xcrun simctl list devices | grep "$DEVICE_UDID" | grep -oE '\(Booted\)' || true)
        if [ -z "$BOOT_STATE" ]; then
            echo "Booting simulator: $DEVICE ($DEVICE_UDID)..."
            xcrun simctl boot "$DEVICE_UDID" 2>/dev/null || true
            sleep 5
        fi
    fi

    echo "Running xcodebuild test..."
    xcodebuild test \
        -project "$IOS_DIR/Kindred.xcodeproj" \
        -scheme "KindredScreenshots" \
        -destination "platform=iOS Simulator,name=$DEVICE" \
        -resultBundlePath "$RESULT_BUNDLE" \
        -only-testing:KindredScreenshots/KindredScreenshots/testCaptureAllScreenshots \
        CODE_SIGN_IDENTITY="" \
        CODE_SIGNING_REQUIRED=NO \
        2>&1 | tail -20

    echo ""
    echo "UI tests completed."
else
    echo "--- Step 1: Skipping UI tests (using existing results) ---"
    if [ ! -d "$RESULT_BUNDLE" ]; then
        echo "Error: No test results found at $RESULT_BUNDLE"
        echo "Run without --skip-tests first."
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Step 2: Extract screenshots from test results
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 2: Extracting screenshots ---"

# Clean raw directory
rm -f "$RAW_DIR"/*.png

# Try xcparse first (best tool for this), then fall back to xcresulttool
if command -v xcparse &>/dev/null; then
    echo "Using xcparse to extract screenshots..."
    xcparse screenshots "$RESULT_BUNDLE" "$RAW_DIR" --os --model --test-plan-config 2>/dev/null || \
    xcparse screenshots "$RESULT_BUNDLE" "$RAW_DIR" 2>/dev/null

    # xcparse may create subdirectories; flatten them
    find "$RAW_DIR" -mindepth 2 -name "*.png" -exec mv {} "$RAW_DIR/" \;
    find "$RAW_DIR" -type d -empty -delete 2>/dev/null || true

elif command -v xcresulttool &>/dev/null || [ -f "$(xcode-select -p)/usr/bin/xcresulttool" ]; then
    echo "Using xcresulttool to extract screenshots..."
    XCRESULTTOOL="xcresulttool"
    if ! command -v xcresulttool &>/dev/null; then
        XCRESULTTOOL="$(xcode-select -p)/usr/bin/xcresulttool"
    fi

    # Get the list of attachments
    REFS=$("$XCRESULTTOOL" get --path "$RESULT_BUNDLE" --format json 2>/dev/null | \
        python3 -c "
import json, sys
data = json.load(sys.stdin)

def find_attachments(obj, results=None):
    if results is None:
        results = []
    if isinstance(obj, dict):
        if obj.get('_type', {}).get('_name') == 'ActionTestAttachment':
            name = obj.get('name', {}).get('_value', '')
            payload_ref = obj.get('payloadRef', {}).get('id', {}).get('_value', '')
            if name and payload_ref:
                results.append((name, payload_ref))
        for v in obj.values():
            find_attachments(v, results)
    elif isinstance(obj, list):
        for item in obj:
            find_attachments(item, results)
    return results

attachments = find_attachments(data)
for name, ref in attachments:
    print(f'{name}|{ref}')
" 2>/dev/null || echo "")

    if [ -n "$REFS" ]; then
        while IFS='|' read -r name ref; do
            if [ -n "$name" ] && [ -n "$ref" ]; then
                OUTPUT_FILE="$RAW_DIR/${name}.png"
                "$XCRESULTTOOL" get --path "$RESULT_BUNDLE" --id "$ref" --output-path "$OUTPUT_FILE" 2>/dev/null
                echo "  Extracted: $name"
            fi
        done <<< "$REFS"
    fi
else
    echo "Warning: Neither xcparse nor xcresulttool found."
    echo "Install xcparse: brew install chargepoint/xcparse/xcparse"
    echo ""
    echo "Attempting manual extraction from xcresult bundle..."

    # Fallback: look for PNG files inside the xcresult bundle
    find "$RESULT_BUNDLE" -name "*.png" -exec cp {} "$RAW_DIR/" \; 2>/dev/null || true
fi

# Count extracted screenshots
PNG_COUNT=$(find "$RAW_DIR" -maxdepth 1 -name "*.png" | wc -l | tr -d ' ')
echo ""
echo "Extracted $PNG_COUNT screenshots to $RAW_DIR"

if [ "$PNG_COUNT" -eq 0 ]; then
    echo "Warning: No screenshots were extracted."
    echo "Check the test results at: $RESULT_BUNDLE"
    echo ""
    echo "You can also manually place screenshots in $RAW_DIR and re-run with --skip-tests"
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: Frame screenshots
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 3: Framing screenshots ---"

# Check for Python + Pillow
if ! python3 -c "import PIL" 2>/dev/null; then
    echo "Error: Python Pillow is required."
    echo "Install with: pip3 install Pillow"
    exit 1
fi

python3 "$SCRIPT_DIR/frame-screenshots.py" \
    --input "$RAW_DIR" \
    --output "$FRAMED_DIR" \
    --sizes "$SIZES"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Pipeline Complete ==="
echo ""
echo "Raw screenshots:    $RAW_DIR"
echo "Framed screenshots: $FRAMED_DIR"
echo ""

for SIZE_LABEL in $(echo "$SIZES" | tr ',' ' '); do
    SIZE_DIR="$FRAMED_DIR/$SIZE_LABEL"
    if [ -d "$SIZE_DIR" ]; then
        COUNT=$(find "$SIZE_DIR" -name "*.png" | wc -l | tr -d ' ')
        echo "  ${SIZE_LABEL}\" size: $COUNT framed screenshots"
    fi
done

echo ""
echo "Open in Finder:  open $FRAMED_DIR"
