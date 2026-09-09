# Photo delivery and performance

## Existing flow

Uploads/imports use `LocalStorageProvider.store_file`: one original under
`PHOTO_STORAGE_ROOT/<prefix>/<uuid>/original.<ext>` (videos have a `videos/`
prefix). `photo_copies` records its location. Album folders use symlinks.
The backend resolves catalog and legacy identities, prefers NAS, then falls
back to the existing Flickr copy. No object-storage/CDN transform service is
configured. Nginx explicitly disables proxy caching. Next.js is standalone;
the browser uses the authenticated `/api/backend` proxy, not `next/image`.

Previously, gallery `size=n` mapped to an indefinitely cached 512px JPEG on
NAS and the lightbox's `size=h` mapped to a fixed 2048px JPEG. Neither normally
requested the original. However, missing Flickr size labels fell back to the
largest result, potentially Original; legacy URL fields could also bypass
thumbnail selection. The lightbox loaded every filmstrip thumbnail eagerly.
iOS preferred supplied thumbnail URLs even for previews and could fall back
to a Flickr page URL rather than image bytes.

## New flow

The same original feeds `/photos/{id}/image?w=640&q=80&format=auto`.
The existing Pillow dependency handles resizing, EXIF orientation and modern
encoding. Supported widths are 160, 320, 480, 640, 960, 1280, 1600, 2048, 2560;
quality is 70, 80 or 90 (clients use 80). Both output dimensions are capped at
2560 and small sources are not enlarged. `auto` uses explicitly accepted
AVIF/WebP when the installed Pillow encoder supports them, otherwise JPEG.
iOS explicitly requests WebP. The proxy forwards Accept and validators.

Legacy `size` aliases and `/local?variant=thumb|preview` still work through
the same cache. `size=o` without `w` and `/local?variant=original` keep original
download behavior. Videos retain their existing poster, playback and range
response paths. Public shares retain scope/password/expiry/download checks
before the same local transform path runs.

Only catalog or indexed legacy photos can reach Flickr lookup. Sources must
come from the authenticated Flickr API and HTTPS staticflickr.com subdomains;
redirects and arbitrary client-supplied source URLs are not accepted. Flickr
previews use an available non-Original derivative, then undergo the same
bounded encoding; an Original-only remote result fails rather than silently
downloading it. REST calls use the existing shared Flickr quota helper.
Decode limits are 100 MiB source bytes, 80 million pixels, two concurrent
encodes per process, and three concurrent remote transfers per process.

## Cache and privacy

Transforms live only in a disposable SQLite platform cache, separate from
original storage and photo_copies. The default is
`/tmp/kindred-image-cache.sqlite3`, with a 256 MiB payload budget, seven-day
expiry and least-recently-used eviction on writes. SQLite reuses freed pages;
physical usage includes overhead, one insertion and transient journals.
Same-process duplicate encode misses are coalesced. Multiple workers sharing
the file share cached results but can duplicate cold encodes.

Keys include encoder revision, resolved source path/inode/size/mtime/ctime
(or Flickr's source URL/version secret), width, quality and selected format.
Replacing a NAS original under the same photo ID changes the key. Response
ETags derive from this key. Browser responses use `private, no-cache`, vary on
Accept and authentication inputs, and return 304 after authorization and source
version checks. This deliberately trades one revalidation request for immediate
access/source validation. **Do not publicly CDN-cache these authenticated routes.**
Long-lived transformed bytes are cached inside the authenticated platform;
there is no permanent derivative library or public image proxy.

Existing old JPEG cache files are left untouched; new still-image requests
no longer generate or read them. Their deletion is optional maintenance,
not part of this change. Video poster/clip caches remain unchanged.

## Client behavior

Web mosaic/favorite/search/event/location/together thumbnails use the actual
CSS box width from ResizeObserver and device scale (up to 3x), rounded up to
an allowed width and capped at 960. Existing CSS fixes tile dimensions/aspect
ratios. This measurement accounts for mosaic spans without an approximate
`sizes` formula; no full-original URL is used. Other legacy photoThumb callers
use the bounded 320px transform.

IntersectionObserver keeps images far away from receiving a source. A window
about 1.5 viewport heights around the viewport schedules at most three low
priority transfers with 32 pending jobs. Leaving the window cancels queued
work. Visible images do not wait behind speculative work. Save-Data and
2G/3G disable speculation. The last 200 displayed thumbnail URLs can provide
an immediate lightbox placeholder.

The web lightbox subtracts CSS padding (including the info panel) from its
available box, fits the cached thumbnail/metadata aspect ratio and multiplies by DPR,
rounding to a maximum 2560px width. A ResizeObserver updates this on resize
and panel changes. Once the preview loads, two previous/two next optimized
previews are prefetched. Filmstrip images use the same bounded lazy component.
Only Download Original requests original still-image bytes. Zoom continues
to operate on the preview.

iOS uses measured view width × displayScale with the same 960/2560 limits
(and fits known thumbnail aspect ratios within the preview height),
a shared URLSession/in-flight deduplication and a bounded decoded thumbnail
cache for placeholders. Geometry gates loads to the viewport/ahead window.
Speculation is limited to three active/32 waiting requests and disallowed on
expensive/constrained connections or Low Power Mode. The viewer explicitly
prefetches two neighbors in each direction and avoids constructing distant
preview loaders; its filmstrip is lazy. Existing demo images remain local.

## Deployment and validation

Deploy backend and web together, then rebuild iOS. No PostgreSQL schema,
original storage, required environment variable or CDN configuration changes.
`IMAGE_CACHE_PATH` optionally relocates the disposable cache to an existing
writable local directory. Containers may discard it on restart. The installed
Pillow determines AVIF availability; WebP/JPEG fallback requires no new image
service or dependency. Do not place this SQLite cache on a network share.

Verification commands:

- `PYTHONPATH=backend python -m unittest discover -s backend/tests`
  (Python 3.11; existing test dependencies plus Pillow/HEIF, piexif and Torch).
- In apps/web: `pnpm exec tsc --noEmit` and `pnpm build`.
- In apps/ios: `xcodegen generate` and an unsigned simulator `xcodebuild`.
- `scripts/test-image-delivery-browser.py` exercises a running web build on
  localhost:3109 with 200 synthetic API photos, using Python Playwright/Pillow
  and Chrome (`CHROME_PATH` can select its executable). API bytes/data are
  mocked: this validates browser requests/UI, not production NAS latency.
  Backend HTTP tests separately exercise real route/encoder/cache behavior.

The existing `pnpm lint` script runs removed `next lint` and fails before
linting; no lint tooling was configured by this change.

Remaining costs: first requests still read/decode the original on NAS; Flickr
fallback still requires a paced getSizes lookup before cache lookup so remote
source versions remain current; large galleries retain their existing DOM
and metadata paging behavior. Production NAS/network latency and physical iOS
scrolling were not measured. No deployment was performed.

## Changed files

- Backend: `backend/main.py`, `backend/image_transforms.py`;
  tests: `backend/tests/test_image_transforms.py`, `backend/tests/test_library_api.py`.
- Web delivery: `apps/web/lib/image-delivery.ts`, `apps/web/lib/photo-url.ts`,
  `apps/web/components/optimized-photo.tsx`, `apps/web/components/photo-lightbox.tsx`,
  `apps/web/app/api/backend/[...path]/route.ts`.
- Web integration: `apps/web/components/kx/photos.ts`,
  `apps/web/components/kx/search-overlay.tsx`, `apps/web/types/index.ts`, and
  `apps/web/app/(main)/{gallery,favorites,events,locations,together}/page.tsx`.
- iOS: `apps/ios/Kindred/Services/APIClient+Library.swift`,
  `apps/ios/Kindred/Views/Shared/{KindredThumbnail,PhotoGridView}.swift`,
  `apps/ios/Kindred/Views/Viewer/PhotoViewerView.swift`.
- Browser regression fixture: `scripts/test-image-delivery-browser.py`.
- Documentation: this file.

Implementation references: [Pillow thumbnail behavior](https://pillow.readthedocs.io/en/stable/reference/Image.html)
and [Next.js image authentication limitations](https://nextjs.org/docs/app/api-reference/components/image).

## Verification results

- 555 backend tests passed; the final resource-limit adjustment also passed all
  12 dedicated transform/HTTP tests.
- Web TypeScript and production build passed; unsigned iOS simulator build passed.
- Browser fixture at 1280×800 / 2× DPR: 29 initial thumbnail requests out of 200
  photos; 2048px main preview; four adjacent optimized previews; zero automatic
  original requests. Download Original produced the expected download URL.
- A second browser run with `PORTRAIT=1` selected a 960px height-fitted preview
  at the same viewport, with four adjacent optimized previews.
- Save-Data at the same viewport loaded only eight visible thumbnails, with
  speculation disabled. No browser JavaScript errors in the gallery/viewer run.
