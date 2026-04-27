#!/usr/bin/env node

// ---------------------------------------------------------------------------
// render-marketing.mjs — Render App Store marketing screenshots via Playwright
//
// Starts a local HTTP server serving the project root, loads the iPhone and
// iPad HTML templates, and captures each of the 10 screens at exact App Store
// dimensions.
//
// Usage:
//   node tools/render-marketing.mjs [options]
//
// Options:
//   --project-root PATH     Project root directory (default: auto-detect)
//   --output-iphone PATH    iPhone output directory
//   --output-ipad PATH      iPad output directory
//   --iphone-only           Only render iPhone screenshots
//   --ipad-only             Only render iPad screenshots
//   --screens 1,2,3         Comma-separated screen numbers to render (default: all)
//
// Requires: npx playwright (Chromium)
// ---------------------------------------------------------------------------

import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getArg(name, defaultValue = null) {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

function hasFlag(name) {
  return args.includes(name);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultProjectRoot = resolve(__dirname, '..');

const PROJECT_ROOT = getArg('--project-root', defaultProjectRoot);
const OUTPUT_IPHONE = getArg('--output-iphone', join(PROJECT_ROOT, 'screenshots/appstore/iphone'));
const OUTPUT_IPAD = getArg('--output-ipad', join(PROJECT_ROOT, 'screenshots/appstore/ipad'));
const IPHONE_ONLY = hasFlag('--iphone-only');
const IPAD_ONLY = hasFlag('--ipad-only');
const SCREENS_ARG = getArg('--screens', null);

const DO_IPHONE = !IPAD_ONLY;
const DO_IPAD = !IPHONE_ONLY;

// Which screens to render (1-10)
const ALL_SCREENS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SCREENS = SCREENS_ARG
  ? SCREENS_ARG.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n >= 1 && n <= 10)
  : ALL_SCREENS;

// App Store dimensions
const IPHONE_WIDTH = 1284;
const IPHONE_HEIGHT = 2778;
const IPAD_WIDTH = 2064;
const IPAD_HEIGHT = 2752;

// Screen names (used for output filenames)
const SCREEN_NAMES = {
  1:  '01_home_feed',
  2:  '02_library_people',
  3:  '03_person_detail',
  4:  '04_library_pets',
  5:  '05_library_vehicles',
  6:  '06_search_results',
  7:  '07_together_picker',
  8:  '08_settings',
  9:  '09_login',
  10: '10_onboarding',
};

// ---------------------------------------------------------------------------
// MIME types for the HTTP server
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

// ---------------------------------------------------------------------------
// HTTP Server — serves project root + /tmp paths for framed images
// ---------------------------------------------------------------------------
function startServer() {
  return new Promise((resolvePromise) => {
    const server = createServer(async (req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);

      // Resolve file path:
      // - /tmp/... paths are served from the actual /tmp directory
      // - /demo/photos/... is served from apps/web/public/demo/photos/
      // - Everything else is relative to project root
      let filePath;
      if (urlPath.startsWith('/tmp/')) {
        filePath = urlPath; // absolute path
      } else if (urlPath.startsWith('/demo/')) {
        filePath = join(PROJECT_ROOT, 'apps/web/public', urlPath);
      } else {
        filePath = join(PROJECT_ROOT, urlPath);
      }

      try {
        const data = await readFile(filePath);
        const ext = extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': mime,
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      } catch (err) {
        // Try index.html for directory requests
        if (!extname(urlPath)) {
          try {
            const indexPath = join(filePath, 'index.html');
            const data = await readFile(indexPath);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
            return;
          } catch { /* fall through */ }
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found: ${urlPath}`);
        if (!urlPath.includes('favicon')) {
          console.warn(`  [404] ${urlPath} -> ${filePath}`);
        }
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolvePromise({ server, port });
    });
  });
}

// ---------------------------------------------------------------------------
// Render screenshots from an HTML template
// ---------------------------------------------------------------------------
async function renderScreenshots({ browser, port, htmlPath, width, height, outputDir, label }) {
  console.log(`\n  Rendering ${label} screenshots (${width}x${height})...`);
  console.log(`  Template: ${htmlPath}`);
  console.log(`  Output:   ${outputDir}\n`);

  await mkdir(outputDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  // Load the HTML template
  const url = `http://127.0.0.1:${port}${htmlPath}`;
  console.log(`  Loading ${url}...`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // Wait for fonts to load
  await page.evaluate(() => document.fonts.ready);

  // Wait a bit for any remaining image loads
  await page.waitForTimeout(2000);

  // Screenshot each screen by scrolling to it and clipping
  for (const screenNum of SCREENS) {
    const screenId = `s${String(screenNum).padStart(2, '0')}`;
    const screenName = SCREEN_NAMES[screenNum];
    const outputPath = join(outputDir, `${screenName}.png`);

    // Check if the screen element exists
    const elementExists = await page.evaluate((id) => {
      return document.getElementById(id) !== null;
    }, screenId);

    if (!elementExists) {
      console.warn(`  [SKIP] Screen #${screenId} not found in template`);
      continue;
    }

    // Scroll the element into view and get its position
    const boundingBox = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      el.scrollIntoView({ behavior: 'instant', block: 'start' });
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }, screenId);

    if (!boundingBox) {
      console.warn(`  [SKIP] Could not get bounds for #${screenId}`);
      continue;
    }

    // Take a clipped screenshot at the exact App Store dimensions
    await page.screenshot({
      path: outputPath,
      clip: {
        x: boundingBox.x,
        y: boundingBox.y,
        width: Math.min(boundingBox.width, width),
        height: Math.min(boundingBox.height, height),
      },
    });

    console.log(`  [OK] ${screenName}.png (${width}x${height})`);
  }

  await context.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Kindred Photos — Marketing Screenshot Renderer ===\n');
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Screens:      ${SCREENS.join(', ')}`);
  if (DO_IPHONE) console.log(`iPhone out:   ${OUTPUT_IPHONE}`);
  if (DO_IPAD)   console.log(`iPad out:     ${OUTPUT_IPAD}`);

  // Verify HTML templates exist
  const iphoneHtml = '/screenshots/screenshots.html';
  const ipadHtml = '/screenshots/screenshots_ipad.html';

  if (DO_IPHONE && !existsSync(join(PROJECT_ROOT, 'screenshots/screenshots.html'))) {
    console.error('ERROR: iPhone HTML template not found at screenshots/screenshots.html');
    process.exit(1);
  }
  if (DO_IPAD && !existsSync(join(PROJECT_ROOT, 'screenshots/screenshots_ipad.html'))) {
    console.error('ERROR: iPad HTML template not found at screenshots/screenshots_ipad.html');
    process.exit(1);
  }

  // Verify framed screenshots exist
  if (DO_IPHONE && !existsSync('/tmp/framed_iphone')) {
    console.error('ERROR: Framed iPhone screenshots not found at /tmp/framed_iphone/');
    console.error('Run the framing step first (or run the full pipeline without --skip-frames).');
    process.exit(1);
  }
  if (DO_IPAD && !existsSync('/tmp/framed_ipad')) {
    console.error('ERROR: Framed iPad screenshots not found at /tmp/framed_ipad/');
    console.error('Run the framing step first (or run the full pipeline without --skip-frames).');
    process.exit(1);
  }

  // Start the local HTTP server
  console.log('\nStarting local HTTP server...');
  const { server, port } = await startServer();
  console.log(`Server running on http://127.0.0.1:${port}`);

  // Launch Chromium
  console.log('Launching Chromium...');
  const browser = await chromium.launch({
    headless: true,
  });

  try {
    // Render iPhone screenshots
    if (DO_IPHONE) {
      await renderScreenshots({
        browser,
        port,
        htmlPath: iphoneHtml,
        width: IPHONE_WIDTH,
        height: IPHONE_HEIGHT,
        outputDir: OUTPUT_IPHONE,
        label: 'iPhone 6.7"',
      });
    }

    // Render iPad screenshots
    if (DO_IPAD) {
      await renderScreenshots({
        browser,
        port,
        htmlPath: ipadHtml,
        width: IPAD_WIDTH,
        height: IPAD_HEIGHT,
        outputDir: OUTPUT_IPAD,
        label: 'iPad 13"',
      });
    }

    console.log('\n=== Rendering complete ===\n');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
