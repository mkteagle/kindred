#!/bin/bash
set -euo pipefail

# App Store publishing is intentionally centralized in StoreShip. Xcode Cloud
# builds must never upload screenshots or metadata as an implicit post-action.
echo "Kindred App Store publishing is managed by StoreShip; skipping legacy Xcode Cloud post-build actions."
exit 0

# ---------------------------------------------------------------------------
# ci_post_xcodebuild.sh — Xcode Cloud post-build script
#
# Runs after a successful build. When triggered from the "Screenshots"
# workflow, captures screenshots, frames them, renders marketing images,
# and uploads to App Store Connect.
#
# Xcode Cloud Environment Variables (set in workflow settings):
#   APP_STORE_CONNECT_API_KEY       — .p8 key content (base64-encoded, Secret)
#   APP_STORE_CONNECT_KEY_ID        — API Key ID (e.g., Z52M74MM87)
#   APP_STORE_CONNECT_ISSUER_ID     — Issuer ID UUID
#
# Uploads are disabled by default. For an intentional manual release, set:
#   ALLOW_APP_STORE_UPLOAD=true
# ---------------------------------------------------------------------------

echo "=== Kindred Photos — Xcode Cloud Screenshot Pipeline ==="
echo ""

# Only run for the Screenshots workflow
if [ "${CI_WORKFLOW:-}" != "Screenshots" ]; then
    echo "Not the Screenshots workflow (CI_WORKFLOW=${CI_WORKFLOW:-unset}). Skipping."
    exit 0
fi

if [ "${ALLOW_APP_STORE_UPLOAD:-false}" != "true" ]; then
    echo "App Store uploads are disabled (ALLOW_APP_STORE_UPLOAD is not true)."
    exit 0
fi

echo "Workflow:  $CI_WORKFLOW"
echo "Branch:    ${CI_BRANCH:-unknown}"
echo "Commit:    ${CI_COMMIT:-unknown}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Install dependencies
# ---------------------------------------------------------------------------
echo "--- Step 1: Installing dependencies ---"

# Homebrew should be available on Xcode Cloud
if ! command -v brew &>/dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null
fi

# Node.js (for Playwright)
if ! command -v node &>/dev/null; then
    echo "Installing Node.js..."
    brew install node
fi
echo "Node: $(node --version)"

# Playwright
echo "Installing Playwright + Chromium..."
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install --save-dev playwright 2>&1 | tail -3
npx playwright install chromium 2>&1 | tail -3

# Python Pillow (for frames-cli)
pip3 install Pillow 2>&1 | tail -2

# frames-cli
if [ ! -x /tmp/frames-cli/frames ]; then
    echo "Installing frames-cli..."
    git clone https://github.com/viticci/frames-cli.git /tmp/frames-cli
    mkdir -p /tmp/frames-assets
    curl -L -o /tmp/frames-assets/AppleFrames40.zip "https://cdn.macstories.net/AppleFrames40.zip"
    cd /tmp/frames-assets && unzip -q AppleFrames40.zip && cd -
    /tmp/frames-cli/frames setup /tmp/frames-assets/Frames
fi
echo "frames-cli ready"

echo ""

# ---------------------------------------------------------------------------
# Step 2: Run UI tests to capture raw screenshots
# ---------------------------------------------------------------------------
echo "--- Step 2: Capturing screenshots via UI tests ---"

PROJECT="$CI_PRIMARY_REPOSITORY_PATH/apps/ios/Kindred.xcodeproj"
SCHEME="KindredScreenshots"

# Find available simulators
IPHONE_UDID=$(xcrun simctl list devices available | grep "iPhone" | head -1 | grep -oE '[A-F0-9-]{36}') || true
IPAD_UDID=$(xcrun simctl list devices available | grep "iPad" | head -1 | grep -oE '[A-F0-9-]{36}') || true

# Boot simulators
if [ -n "$IPHONE_UDID" ]; then
    xcrun simctl boot "$IPHONE_UDID" 2>/dev/null || true
fi
if [ -n "$IPAD_UDID" ]; then
    xcrun simctl boot "$IPAD_UDID" 2>/dev/null || true
fi

# Uninstall app to get fresh onboarding
xcrun simctl uninstall "$IPHONE_UDID" com.kindlingsignal.kindred 2>/dev/null || true
xcrun simctl uninstall "$IPAD_UDID" com.kindlingsignal.kindred 2>/dev/null || true

rm -rf /tmp/kindred_screenshots /tmp/kindred_screenshots_ipad
mkdir -p /tmp/kindred_screenshots /tmp/kindred_screenshots_ipad

# iPhone tests
if [ -n "$IPHONE_UDID" ]; then
    echo "Running iPhone tests ($IPHONE_UDID)..."
    xcodebuild test \
        -project "$PROJECT" \
        -scheme "$SCHEME" \
        -destination "platform=iOS Simulator,id=$IPHONE_UDID" \
        -only-testing:KindredScreenshots/KindredScreenshots/testCaptureAllScreenshots \
        CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO \
        2>&1 | tail -5
    echo "iPhone: $(ls /tmp/kindred_screenshots/*.png 2>/dev/null | wc -l | tr -d ' ') screenshots"
fi

# iPad tests
if [ -n "$IPAD_UDID" ]; then
    echo "Running iPad tests ($IPAD_UDID)..."
    xcodebuild test \
        -project "$PROJECT" \
        -scheme "$SCHEME" \
        -destination "platform=iOS Simulator,id=$IPAD_UDID" \
        -only-testing:KindredScreenshots/KindredScreenshots/testCaptureAllScreenshots \
        CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO \
        2>&1 | tail -5
    echo "iPad: $(ls /tmp/kindred_screenshots_ipad/*.png 2>/dev/null | wc -l | tr -d ' ') screenshots"
fi

echo ""

# ---------------------------------------------------------------------------
# Step 3: Frame with Apple device bezels
# ---------------------------------------------------------------------------
echo "--- Step 3: Framing with Apple device bezels ---"

FRAMES="/tmp/frames-cli/frames"
mkdir -p /tmp/framed_iphone /tmp/framed_ipad

if ls /tmp/kindred_screenshots/*.png &>/dev/null; then
    $FRAMES -o /tmp/framed_iphone /tmp/kindred_screenshots/*.png 2>&1 | tail -3
    echo "Framed $(ls /tmp/framed_iphone/*_framed.png 2>/dev/null | wc -l | tr -d ' ') iPhone screenshots"
fi

if ls /tmp/kindred_screenshots_ipad/*.png &>/dev/null; then
    $FRAMES -o /tmp/framed_ipad /tmp/kindred_screenshots_ipad/*.png 2>&1 | tail -3
    echo "Framed $(ls /tmp/framed_ipad/*_framed.png 2>/dev/null | wc -l | tr -d ' ') iPad screenshots"
fi

echo ""

# ---------------------------------------------------------------------------
# Step 4: Render marketing screenshots with Playwright
# ---------------------------------------------------------------------------
echo "--- Step 4: Rendering marketing screenshots ---"

cd "$CI_PRIMARY_REPOSITORY_PATH"

# Render 6.5" iPhone
node tools/render-marketing.mjs --iphone-only 2>&1 | tail -3

# Render 6.9" iPhone
sed -i '' 's/IPHONE_WIDTH = 1284/IPHONE_WIDTH = 1320/; s/IPHONE_HEIGHT = 2778/IPHONE_HEIGHT = 2868/' tools/render-marketing.mjs
sed -i '' 's|screenshots/screenshots.html|screenshots/screenshots_69.html|; s|appstore/iphone|appstore/iphone69|' tools/render-marketing.mjs
mkdir -p screenshots/appstore/iphone69
node tools/render-marketing.mjs --iphone-only 2>&1 | tail -3
# Restore
sed -i '' 's/IPHONE_WIDTH = 1320/IPHONE_WIDTH = 1284/; s/IPHONE_HEIGHT = 2868/IPHONE_HEIGHT = 2778/' tools/render-marketing.mjs
sed -i '' 's|screenshots/screenshots_69.html|screenshots/screenshots.html|; s|appstore/iphone69|appstore/iphone|' tools/render-marketing.mjs

# Render iPad
node tools/render-marketing.mjs --ipad-only 2>&1 | tail -3

echo ""
echo "6.5\" iPhone: $(ls screenshots/appstore/iphone/*.png 2>/dev/null | wc -l | tr -d ' ') screenshots"
echo "6.9\" iPhone: $(ls screenshots/appstore/iphone69/*.png 2>/dev/null | wc -l | tr -d ' ') screenshots"
echo "iPad 13\":    $(ls screenshots/appstore/ipad/*.png 2>/dev/null | wc -l | tr -d ' ') screenshots"
echo ""

# ---------------------------------------------------------------------------
# Step 5: Upload to App Store Connect
# ---------------------------------------------------------------------------
ASC_KEY_ID="${APP_STORE_CONNECT_KEY_ID:-}"
ASC_ISSUER_ID="${APP_STORE_CONNECT_ISSUER_ID:-}"
ASC_KEY_CONTENT="${APP_STORE_CONNECT_API_KEY:-}"

if [ -z "$ASC_KEY_ID" ] || [ -z "$ASC_ISSUER_ID" ] || [ -z "$ASC_KEY_CONTENT" ]; then
    echo "--- Step 5: Skipping upload (missing env vars) ---"
    echo "Set these in Xcode Cloud workflow environment variables:"
    echo "  APP_STORE_CONNECT_API_KEY      (Secret — base64 of .p8 file)"
    echo "  APP_STORE_CONNECT_KEY_ID       (Key ID)"
    echo "  APP_STORE_CONNECT_ISSUER_ID    (Issuer ID)"
    exit 0
fi

echo "--- Step 5: Uploading to App Store Connect ---"
echo "  Key ID:    $ASC_KEY_ID"
echo "  Issuer ID: $ASC_ISSUER_ID"

# Decode the .p8 key from base64 env var
echo "$ASC_KEY_CONTENT" | base64 -d > /tmp/asc_key.p8

# Build and run the Swift upload tool
swift build --package-path tools/asc-upload 2>&1 | tail -3
swift run --package-path tools/asc-upload asc-upload \
    --key-id "$ASC_KEY_ID" \
    --key-path /tmp/asc_key.p8 \
    --issuer-id "$ASC_ISSUER_ID" \
    2>&1

# Clean up key
rm -f /tmp/asc_key.p8

echo ""
echo "=== Screenshot pipeline complete ==="
