#!/bin/bash
# ---------------------------------------------------------------------------
# nightly-screenshots.sh — Runs at 1am via launchd
#
# Checks if there are new commits on main since last run.
# If so: pulls, renders screenshots, uploads to App Store Connect.
# ---------------------------------------------------------------------------

set -euo pipefail

PROJECT="/Volumes/ExtendedDrive/developer/kindred"
LOG="$PROJECT/screenshots/nightly.log"
LAST_COMMIT_FILE="$PROJECT/screenshots/.last_nightly_commit"

exec > >(tee -a "$LOG") 2>&1
echo ""
echo "=== Nightly Screenshots — $(date) ==="

cd "$PROJECT"

# Pull latest
git pull --ff-only origin main 2>&1 || { echo "Pull failed, skipping."; exit 0; }

# Check if anything changed since last run
CURRENT_COMMIT=$(git rev-parse HEAD)
LAST_COMMIT=$(cat "$LAST_COMMIT_FILE" 2>/dev/null || echo "none")

if [ "$CURRENT_COMMIT" = "$LAST_COMMIT" ]; then
    echo "No new commits since last run ($CURRENT_COMMIT). Skipping."
    exit 0
fi

echo "New commits detected: $LAST_COMMIT -> $CURRENT_COMMIT"

# Run the full pipeline
echo ""
echo "--- Running screenshot pipeline ---"
./tools/screenshot-pipeline.sh --skip-tests --skip-frames 2>&1 || true

# Upload to ASC
echo ""
echo "--- Uploading to App Store Connect ---"
swift run --package-path tools/asc-upload asc-upload \
    --key-id "Z52M74MM87" \
    --key-path "$PROJECT/fastlane/AuthKey_Z52M74MM87.p8" \
    --issuer-id "f180b8c2-2c8a-4167-b8c4-c8270ed3b0f8" \
    2>&1 || true

# Save commit marker
echo "$CURRENT_COMMIT" > "$LAST_COMMIT_FILE"

echo ""
echo "=== Done — $(date) ==="
