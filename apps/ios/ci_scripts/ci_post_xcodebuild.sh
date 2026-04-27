#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# ci_post_xcodebuild.sh — Xcode Cloud post-build script
#
# For the "Screenshots" workflow: uploads pre-rendered marketing screenshots
# from the repo to App Store Connect using the Swift upload tool.
#
# Marketing screenshots are rendered LOCALLY (via Playwright + Chrome) and
# committed to screenshots/appstore/. This script just uploads them.
#
# Environment Variables (set in Xcode Cloud workflow):
#   APP_STORE_CONNECT_API_KEY       — base64-encoded .p8 key content (Secret)
#   APP_STORE_CONNECT_KEY_ID        — API Key ID
#   APP_STORE_CONNECT_ISSUER_ID     — Issuer ID
# ---------------------------------------------------------------------------

echo "=== Kindred Photos — Screenshot Upload ==="
echo ""

# Only run for the Screenshots workflow (case-insensitive)
WORKFLOW_LOWER=$(echo "${CI_WORKFLOW:-}" | tr '[:upper:]' '[:lower:]')
if [ "$WORKFLOW_LOWER" != "screenshots" ]; then
    echo "Not the Screenshots workflow (CI_WORKFLOW=${CI_WORKFLOW:-unset}). Skipping."
    exit 0
fi

echo "Workflow: $CI_WORKFLOW"
echo "Branch:   ${CI_BRANCH:-unknown}"
echo "Commit:   ${CI_COMMIT:-unknown}"
echo ""

REPO="$CI_PRIMARY_REPOSITORY_PATH"
SCREENSHOTS="$REPO/screenshots/appstore"

# Check screenshots exist in repo
IPHONE_COUNT=$(find "$SCREENSHOTS/iphone" -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
IPHONE69_COUNT=$(find "$SCREENSHOTS/iphone69" -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
IPAD_COUNT=$(find "$SCREENSHOTS/ipad" -name "*.png" 2>/dev/null | wc -l | tr -d ' ')

echo "Screenshots found in repo:"
echo "  iPhone 6.5\":  $IPHONE_COUNT"
echo "  iPhone 6.9\":  $IPHONE69_COUNT"
echo "  iPad 13\":     $IPAD_COUNT"
echo ""

if [ "$IPHONE_COUNT" -eq 0 ] && [ "$IPAD_COUNT" -eq 0 ]; then
    echo "No screenshots found. Render them locally first:"
    echo "  ./tools/screenshot-pipeline.sh"
    exit 1
fi

# Check API credentials
ASC_KEY_ID="${APP_STORE_CONNECT_KEY_ID:-}"
ASC_ISSUER_ID="${APP_STORE_CONNECT_ISSUER_ID:-}"
ASC_KEY_CONTENT="${APP_STORE_CONNECT_API_KEY:-}"

if [ -z "$ASC_KEY_ID" ] || [ -z "$ASC_ISSUER_ID" ] || [ -z "$ASC_KEY_CONTENT" ]; then
    echo "Missing API credentials. Set these in Xcode Cloud workflow:"
    echo "  APP_STORE_CONNECT_API_KEY      (Secret — base64 of .p8)"
    echo "  APP_STORE_CONNECT_KEY_ID"
    echo "  APP_STORE_CONNECT_ISSUER_ID"
    exit 1
fi

echo "API Key: $ASC_KEY_ID"
echo "Issuer:  $ASC_ISSUER_ID"
echo ""

# Decode the .p8 key
echo "$ASC_KEY_CONTENT" | base64 -d > /tmp/asc_key.p8

# Build the Swift upload tool
echo "Building upload tool..."
cd "$REPO"
swift build --package-path tools/asc-upload 2>&1 | tail -3

# Upload
echo ""
echo "Uploading to App Store Connect..."
swift run --package-path tools/asc-upload asc-upload \
    --key-id "$ASC_KEY_ID" \
    --key-path /tmp/asc_key.p8 \
    --issuer-id "$ASC_ISSUER_ID" \
    --screenshots-dir "$SCREENSHOTS" \
    2>&1

# Clean up
rm -f /tmp/asc_key.p8

echo ""
echo "=== Done ==="
