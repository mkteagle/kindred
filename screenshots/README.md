# Kindred Photos - App Store Screenshot Automation

Automated pipeline for capturing, framing, and producing App Store-ready screenshots for the Kindred Photos iOS app.

## Quick Start

```bash
# From the project root
storeship ship --config storeship.yml --platform ios --dry-run

# Regenerate the full iPhone + iPad screenshot set without publishing
storeship capture --config storeship.yml --platform ios --out /tmp/kindred-storeship
```

StoreShip is the canonical App Store pipeline for Kindred. It invokes the
project's branded screenshot renderer, validates the generated Apple display
sizes, and publishes metadata, screenshots, and builds from `storeship.yml`.
The local renderer can still be run directly with `./tools/screenshot-pipeline.sh`,
but it never uploads to App Store Connect on its own.

The capture command will:
1. Run UI tests on the iPhone 15 Pro Max simulator to capture screenshots
2. Extract raw screenshots from the test results
3. Frame them with device bezels and marketing text
4. Output everything to `screenshots/raw/` and `screenshots/framed/`

## Requirements

- **Xcode 16+** with iOS 17+ simulator runtimes
- **Python 3** with Pillow: `pip3 install Pillow`
- **xcparse** (recommended): `brew install chargepoint/xcparse/xcparse`
  - Falls back to `xcresulttool` (bundled with Xcode) if xcparse is unavailable

## Output Structure

```
screenshots/
  raw/                          # Raw simulator screenshots
    01_home_feed.png
    02_library_people.png
    03_library_pets.png
    04_search_browse.png
    05_search_results.png
    06_photo_detail.png
    07_together_picker.png
    08_settings.png
    09_notifications_inbox.png
    10_onboarding.png
  framed/                       # Framed screenshots with marketing text
    6.7/                        # 1290x2796 (iPhone 15 Pro Max)
      01_home_feed.png
      ...
    6.1/                        # 1179x2556 (iPhone 15 Pro)
      01_home_feed.png
      ...
```

## Screens Captured

| # | Screenshot | Marketing Text |
|---|-----------|---------------|
| 01 | Home feed | "A calmer home for family photos." |
| 02 | Library - People | "Everyone you love, organized by AI." |
| 03 | Library - Pets | "Your furry family, automatically grouped." |
| 04 | Search (browse) | "Find any moment in seconds." |
| 05 | Search results | "Find any moment in seconds." |
| 06 | Photo detail | "Every detail, beautifully presented." |
| 07 | Together picker | "Find photos of people together." |
| 08 | Settings | "Your household, your control." |
| 09 | Notifications | "Stay in the loop with your family." |
| 10 | Onboarding | "A calmer home for family photos." |

## Configuration

### Authentication

The tests connect to the real backend at `api.kindredphotos.app`. Set demo credentials via environment variables:

```bash
export KINDRED_DEMO_EMAIL="demo@example.com"
export KINDRED_DEMO_PASSWORD="your-password"
```

Or configure them in the Xcode scheme's environment variables for the KindredScreenshots target.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KINDRED_API_BASE` | Backend URL | `https://api.kindredphotos.app` |
| `KINDRED_DEMO_EMAIL` | Login email | *(none)* |
| `KINDRED_DEMO_PASSWORD` | Login password | *(none)* |
| `KINDRED_SCREENSHOT_MODE` | Enable screenshot behaviors | `1` |
| `KINDRED_SHOW_ONBOARDING` | Force onboarding screen | *(unset)* |
| `KINDRED_SEARCH_QUERY` | Search term for screenshot | `beach` |

### Runner Script Options

```bash
# Use a different simulator
./tools/take-screenshots.sh --device "iPhone 16 Pro"

# Skip tests and re-frame existing screenshots
./tools/take-screenshots.sh --skip-tests

# Generate only 6.7" size
./tools/take-screenshots.sh --sizes "6.7"
```

## Customizing Marketing Text

Edit the `MARKETING_TEXT` dictionary in `tools/frame-screenshots.py`:

```python
MARKETING_TEXT = {
    "01_home_feed": {
        "eyebrow": "HOME",
        "headline": "A calmer home for\nfamily photos.",
    },
    # ...
}
```

Each entry maps to a screenshot filename (without extension) and contains:
- `eyebrow`: Small uppercase label (uses IBM Plex Mono)
- `headline`: Large headline text (uses Space Grotesk Bold)

## Adding New Screens

1. **Add the capture logic** in `KindredScreenshots.swift`:
   ```swift
   private func captureNewScreen() {
       // Navigate to the screen
       tapTab("TabName")
       sleep(2)
       takeScreenshot(named: "11_new_screen")
   }
   ```

2. **Call it** from `testCaptureAllScreenshots()`.

3. **Add marketing text** in `frame-screenshots.py`:
   ```python
   "11_new_screen": {
       "eyebrow": "FEATURE",
       "headline": "Your marketing\ncopy here.",
   },
   ```

## Design System

The framing script uses the Kindred brand palette:

| Token | Hex | Usage |
|-------|-----|-------|
| Paper | `#FBF4E7` | Background |
| Ash | `#2A201B` | Headline text |
| Ember | `#C9551C` | Eyebrow accent |
| Canvas | `#F7EBD4` | Gradient tint |

Fonts are loaded from the iOS app's `Kindred/Fonts/` directory:
- **Space Grotesk Bold** for headlines
- **IBM Plex Mono SemiBold** for eyebrow labels
- Falls back to system fonts if brand fonts are unavailable

## Running Just the Framing Script

If you already have raw screenshots (e.g., manual captures):

```bash
# Place PNGs in screenshots/raw/ then:
python3 tools/frame-screenshots.py

# Or specify custom paths:
python3 tools/frame-screenshots.py --input /path/to/raw --output /path/to/framed --sizes "6.7"
```

## Troubleshooting

- **"No screenshots extracted"**: Check that the UI tests actually ran. Look at `apps/ios/TestResults.xcresult` in Xcode's Result Browser.
- **Tests fail to authenticate**: Ensure `KINDRED_DEMO_EMAIL` and `KINDRED_DEMO_PASSWORD` are set and valid.
- **Pillow not found**: `pip3 install Pillow`
- **xcparse not found**: `brew install chargepoint/xcparse/xcparse` (or the script will fall back to xcresulttool)
- **Fonts look wrong**: The script tries to load Space Grotesk from the iOS app's Fonts directory. If that fails, it uses system fonts.
