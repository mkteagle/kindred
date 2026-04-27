#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# screenshot-pipeline.sh — Kindred Photos automated App Store screenshot pipeline
#
# Runs the full pipeline:
#   1. Check prerequisites (Xcode, Python, Pillow, frames-cli, Node/npx)
#   2. Install Playwright if needed
#   3. Run iOS UI tests on iPhone 17 Pro Max simulator
#   4. Run iOS UI tests on iPad Pro 13" simulator
#   5. Frame raw screenshots with Apple device bezels (frames-cli)
#   6. Render marketing screenshots from HTML templates via Playwright
#   7. Print summary
#
# Usage:
#   ./tools/screenshot-pipeline.sh [options]
#
# Options:
#   --skip-tests      Skip running UI tests; use existing raw screenshots
#   --skip-frames     Skip framing step; use existing framed screenshots
#   --iphone-only     Only process iPhone screenshots
#   --ipad-only       Only process iPad screenshots
#   --help            Show this help message
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$PROJECT_ROOT/apps/ios"
SCREENSHOTS_DIR="$PROJECT_ROOT/screenshots"

# Raw screenshot output (written by the UI tests directly)
RAW_IPHONE_DIR="/tmp/kindred_screenshots"
RAW_IPAD_DIR="/tmp/kindred_screenshots_ipad"

# Framed screenshot output (written by frames-cli)
FRAMED_IPHONE_DIR="/tmp/framed_iphone"
FRAMED_IPAD_DIR="/tmp/framed_ipad"

# Final App Store output
APPSTORE_IPHONE_DIR="$SCREENSHOTS_DIR/appstore/iphone"
APPSTORE_IPAD_DIR="$SCREENSHOTS_DIR/appstore/ipad"

# Simulator device names
IPHONE_DEVICE="iPhone 17 Pro Max"
IPAD_DEVICE="iPad Pro 13-inch (M5)"

# frames-cli location
FRAMES_CLI="/tmp/frames-cli/frames"

# Flags
SKIP_TESTS=false
SKIP_FRAMES=false
DO_IPHONE=true
DO_IPAD=true

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-frames)
            SKIP_FRAMES=true
            shift
            ;;
        --iphone-only)
            DO_IPAD=false
            shift
            ;;
        --ipad-only)
            DO_IPHONE=false
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--skip-tests] [--skip-frames] [--iphone-only] [--ipad-only]"
            echo ""
            echo "Options:"
            echo "  --skip-tests    Skip running iOS UI tests (use existing raw screenshots)"
            echo "  --skip-frames   Skip device framing step (use existing framed screenshots)"
            echo "  --iphone-only   Only process iPhone screenshots"
            echo "  --ipad-only     Only process iPad screenshots"
            echo ""
            echo "Directories:"
            echo "  Raw iPhone:     $RAW_IPHONE_DIR"
            echo "  Raw iPad:       $RAW_IPAD_DIR"
            echo "  Framed iPhone:  $FRAMED_IPHONE_DIR"
            echo "  Framed iPad:    $FRAMED_IPAD_DIR"
            echo "  App Store out:  $APPSTORE_IPHONE_DIR / $APPSTORE_IPAD_DIR"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Colors for terminal output
# ---------------------------------------------------------------------------
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fail()    { echo -e "${RED}[FAIL]${RESET}  $*"; exit 1; }
step()    { echo -e "\n${BOLD}=== $* ===${RESET}\n"; }

# ═══════════════════════════════════════════════════════════════════════════
# STEP 1: Check prerequisites
# ═══════════════════════════════════════════════════════════════════════════
step "Step 1: Checking prerequisites"

# Xcode / xcodebuild
if ! command -v xcodebuild &>/dev/null; then
    fail "xcodebuild not found. Install Xcode from the Mac App Store."
fi
success "xcodebuild found: $(xcodebuild -version 2>&1 | head -1)"

# xcrun simctl
if ! command -v xcrun &>/dev/null; then
    fail "xcrun not found. Xcode command line tools are required."
fi
success "xcrun simctl available"

# Python 3
if ! command -v python3 &>/dev/null; then
    fail "Python 3 not found. Install with: brew install python3"
fi
success "Python 3 found: $(python3 --version 2>&1)"

# Pillow
if ! python3 -c "import PIL" 2>/dev/null; then
    warn "Pillow not found. Install with: pip3 install Pillow"
    warn "Pillow is only needed if using frame-screenshots.py — frames-cli handles framing now."
fi

# frames-cli
if [ ! -x "$FRAMES_CLI" ]; then
    fail "frames-cli not found at $FRAMES_CLI"
fi
success "frames-cli found at $FRAMES_CLI"

# Node.js / npx
if ! command -v node &>/dev/null; then
    fail "Node.js not found. Install with: brew install node"
fi
success "Node.js found: $(node --version 2>&1)"

if ! command -v npx &>/dev/null; then
    fail "npx not found. Comes with Node.js — reinstall Node."
fi
success "npx available"

# ═══════════════════════════════════════════════════════════════════════════
# STEP 2: Install Playwright if needed
# ═══════════════════════════════════════════════════════════════════════════
step "Step 2: Ensuring Playwright is installed"

# Check if playwright is available
if npx playwright --version &>/dev/null 2>&1; then
    success "Playwright already installed: $(npx playwright --version 2>&1)"
else
    info "Installing Playwright..."
    npm install --no-save playwright 2>&1
fi

# Ensure Chromium browser is installed
info "Ensuring Chromium browser is available..."
npx playwright install chromium 2>&1 | tail -3
success "Playwright Chromium ready"

# ═══════════════════════════════════════════════════════════════════════════
# STEP 3 & 4: Run iOS UI tests
# ═══════════════════════════════════════════════════════════════════════════

find_simulator_udid() {
    local device_name="$1"
    local udid
    udid=$(xcrun simctl list devices available | grep "$device_name" | head -1 | grep -oE '[A-F0-9-]{36}') || true
    echo "$udid"
}

boot_simulator() {
    local udid="$1"
    local device_name="$2"
    local boot_state
    boot_state=$(xcrun simctl list devices | grep "$udid" | grep -oE '\(Booted\)' || true)
    if [ -z "$boot_state" ]; then
        info "Booting simulator: $device_name ($udid)..."
        xcrun simctl boot "$udid" 2>/dev/null || true
        sleep 5
    else
        info "Simulator already booted: $device_name"
    fi
}

run_ui_tests() {
    local device_name="$1"
    local output_dir="$2"
    local label="$3"

    step "Running UI tests on $label ($device_name)"

    # Find and boot the simulator
    local udid
    udid=$(find_simulator_udid "$device_name")
    if [ -z "$udid" ]; then
        fail "Simulator not found: $device_name. Create it in Xcode > Window > Devices and Simulators."
    fi
    success "Found simulator: $device_name ($udid)"
    boot_simulator "$udid" "$device_name"

    # Clean previous raw screenshots
    mkdir -p "$output_dir"
    rm -f "$output_dir"/*.png

    # Run tests — screenshots are saved to output_dir by the test code
    info "Running xcodebuild test on $device_name..."
    local result_bundle="/tmp/KindredScreenshots_${label}.xcresult"
    rm -rf "$result_bundle"

    if xcodebuild test \
        -project "$IOS_DIR/Kindred.xcodeproj" \
        -scheme "KindredScreenshots" \
        -destination "platform=iOS Simulator,name=$device_name" \
        -resultBundlePath "$result_bundle" \
        -only-testing:KindredScreenshots/KindredScreenshots/testCaptureAllScreenshots \
        CODE_SIGN_IDENTITY="" \
        CODE_SIGNING_REQUIRED=NO \
        2>&1 | tail -20; then
        success "UI tests passed on $device_name"
    else
        warn "UI tests had failures on $device_name (screenshots may still have been captured)"
    fi

    # Count captured screenshots
    local count
    count=$(find "$output_dir" -maxdepth 1 -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$count" -eq 0 ]; then
        fail "No screenshots found in $output_dir after running tests on $device_name"
    fi
    success "Captured $count screenshots in $output_dir"
}

if [ "$SKIP_TESTS" = true ]; then
    step "Step 3-4: Skipping UI tests (--skip-tests)"
    if [ "$DO_IPHONE" = true ]; then
        local_count=$(find "$RAW_IPHONE_DIR" -maxdepth 1 -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$local_count" -eq 0 ]; then
            fail "No existing iPhone screenshots in $RAW_IPHONE_DIR — run without --skip-tests first."
        fi
        success "Using $local_count existing iPhone screenshots from $RAW_IPHONE_DIR"
    fi
    if [ "$DO_IPAD" = true ]; then
        local_count=$(find "$RAW_IPAD_DIR" -maxdepth 1 -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$local_count" -eq 0 ]; then
            fail "No existing iPad screenshots in $RAW_IPAD_DIR — run without --skip-tests first."
        fi
        success "Using $local_count existing iPad screenshots from $RAW_IPAD_DIR"
    fi
else
    if [ "$DO_IPHONE" = true ]; then
        run_ui_tests "$IPHONE_DEVICE" "$RAW_IPHONE_DIR" "iPhone"
    fi
    if [ "$DO_IPAD" = true ]; then
        run_ui_tests "$IPAD_DEVICE" "$RAW_IPAD_DIR" "iPad"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# STEP 5: Frame raw screenshots with Apple device bezels
# ═══════════════════════════════════════════════════════════════════════════

frame_screenshots() {
    local input_dir="$1"
    local output_dir="$2"
    local label="$3"

    step "Framing $label screenshots with device bezels"

    mkdir -p "$output_dir"
    rm -f "$output_dir"/*_framed.png

    local count=0
    for png in "$input_dir"/*.png; do
        [ -f "$png" ] || continue
        local basename
        basename=$(basename "$png" .png)
        info "Framing: $basename"
        "$FRAMES_CLI" frame "$png" -o "$output_dir" 2>&1 | tail -2
        # frames-cli names output as <name>_framed.png in the output dir
        count=$((count + 1))
    done

    success "Framed $count $label screenshots in $output_dir"
}

if [ "$SKIP_FRAMES" = true ]; then
    step "Step 5: Skipping framing (--skip-frames)"
    if [ "$DO_IPHONE" = true ]; then
        local_count=$(find "$FRAMED_IPHONE_DIR" -maxdepth 1 -name "*_framed.png" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$local_count" -eq 0 ]; then
            fail "No existing framed iPhone screenshots in $FRAMED_IPHONE_DIR — run without --skip-frames first."
        fi
        success "Using $local_count existing framed iPhone screenshots"
    fi
    if [ "$DO_IPAD" = true ]; then
        local_count=$(find "$FRAMED_IPAD_DIR" -maxdepth 1 -name "*_framed.png" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$local_count" -eq 0 ]; then
            fail "No existing framed iPad screenshots in $FRAMED_IPAD_DIR — run without --skip-frames first."
        fi
        success "Using $local_count existing framed iPad screenshots"
    fi
else
    if [ "$DO_IPHONE" = true ]; then
        frame_screenshots "$RAW_IPHONE_DIR" "$FRAMED_IPHONE_DIR" "iPhone"
    fi
    if [ "$DO_IPAD" = true ]; then
        frame_screenshots "$RAW_IPAD_DIR" "$FRAMED_IPAD_DIR" "iPad"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# STEP 6: Render marketing screenshots from HTML templates via Playwright
# ═══════════════════════════════════════════════════════════════════════════
step "Step 6: Rendering marketing screenshots with Playwright"

# Verify framed screenshots exist before rendering
if [ "$DO_IPHONE" = true ] && [ ! -d "$FRAMED_IPHONE_DIR" ]; then
    fail "Framed iPhone directory missing: $FRAMED_IPHONE_DIR"
fi
if [ "$DO_IPAD" = true ] && [ ! -d "$FRAMED_IPAD_DIR" ]; then
    fail "Framed iPad directory missing: $FRAMED_IPAD_DIR"
fi

# Create output directories
mkdir -p "$APPSTORE_IPHONE_DIR" "$APPSTORE_IPAD_DIR"

# Build flags for the render script
RENDER_FLAGS=""
if [ "$DO_IPHONE" = true ] && [ "$DO_IPAD" = false ]; then
    RENDER_FLAGS="--iphone-only"
elif [ "$DO_IPHONE" = false ] && [ "$DO_IPAD" = true ]; then
    RENDER_FLAGS="--ipad-only"
fi

node "$SCRIPT_DIR/render-marketing.mjs" \
    --project-root "$PROJECT_ROOT" \
    --output-iphone "$APPSTORE_IPHONE_DIR" \
    --output-ipad "$APPSTORE_IPAD_DIR" \
    $RENDER_FLAGS

# ═══════════════════════════════════════════════════════════════════════════
# STEP 7: Summary
# ═══════════════════════════════════════════════════════════════════════════
step "Pipeline Complete"

echo -e "${BOLD}Generated files:${RESET}\n"

if [ "$DO_IPHONE" = true ]; then
    echo -e "  ${CYAN}iPhone (6.7\" — 1320x2868):${RESET}"
    for f in "$APPSTORE_IPHONE_DIR"/*.png; do
        [ -f "$f" ] || continue
        echo "    $(basename "$f")"
    done
    iphone_count=$(find "$APPSTORE_IPHONE_DIR" -maxdepth 1 -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  ${GREEN}Total: $iphone_count screenshots${RESET}\n"
fi

if [ "$DO_IPAD" = true ]; then
    echo -e "  ${CYAN}iPad (13\" — 2064x2752):${RESET}"
    for f in "$APPSTORE_IPAD_DIR"/*.png; do
        [ -f "$f" ] || continue
        echo "    $(basename "$f")"
    done
    ipad_count=$(find "$APPSTORE_IPAD_DIR" -maxdepth 1 -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  ${GREEN}Total: $ipad_count screenshots${RESET}\n"
fi

echo -e "${BOLD}Output directories:${RESET}"
echo "  iPhone: $APPSTORE_IPHONE_DIR"
echo "  iPad:   $APPSTORE_IPAD_DIR"
echo ""
echo "Open in Finder:"
echo "  open $APPSTORE_IPHONE_DIR"
echo "  open $APPSTORE_IPAD_DIR"

# ═══════════════════════════════════════════════════════════════════════════
# App Store Connect upload (placeholder)
# ═══════════════════════════════════════════════════════════════════════════
# To upload screenshots to App Store Connect, use one of:
#
# Option A: Transporter CLI (recommended)
#   brew install apple/apple/transporter
#   transporter -m upload -f /path/to/package.itmsp \
#     -u your@apple.id -p @keychain:AC_PASSWORD
#
# Option B: altool (deprecated but still works)
#   xcrun altool --upload-app -f /path/to/app.ipa \
#     --type ios --apiKey KEY_ID --apiIssuer ISSUER_ID
#
# Option C: App Store Connect API + fastlane deliver
#   fastlane deliver --skip_binary_upload \
#     --screenshots_path screenshots/appstore \
#     --api_key_path api_key.json
#
# All options require App Store Connect API key setup:
#   1. Create API key at https://appstoreconnect.apple.com/access/integrations/api
#   2. Download the .p8 key file
#   3. Note the Key ID and Issuer ID
#   4. Store securely (never commit to git)
