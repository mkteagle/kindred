# Kindred for desktop

Rust + Tauri. Native window chrome, a real menu bar, multi-window, drag-out to
Finder, and an offline cache — the things the web app cannot have.

Design source: `DESKTOP.md` and `Kindred Desktop.dc.html` in the apps handoff
bundle, with the shared palette and type from that bundle's `README.md`.

## Running it

```sh
pnpm install
pnpm tauri dev      # or: pnpm dev for the view layer alone
```

`cargo check` from `src-tauri/` needs a Rust toolchain; the frontend needs only
Node.

> **`package.json` is gitignored.** The repository root's `.gitignore` has a
> bare `package.json` line, which swallows this app's manifest and makes a fresh
> clone unbuildable. `apps/desktop/.gitignore` now re-includes it with
> `!package.json`.

## The four windows

Every window loads the same bundle. `src-tauri/src/windows.rs` decides which is
which and what it was opened with; `src/Root.tsx` switches on that.

| kind | label | size | source |
|---|---|---|---|
| `library` | `main` | 1180×720 | `src/windows/LibraryWindow.tsx` |
| `viewer` | `viewer-N` | 1080×700 | `src/windows/ViewerWindow.tsx` |
| `review` | `review-N` | 980×660 | `src/windows/ReviewWindow.tsx` |
| `settings` | `settings` | 900×620 | `src/windows/SettingsWindow.tsx` |
| `uploader` | `uploader` | 1100×720 | `src/App.tsx` — the original bulk uploader, unchanged |

Geometry is remembered per *kind* in `config.json`, so the second viewer you
tear off lands where the last one was.

## Keyboard

Shortcuts split by mechanism, not by taste:

- **⌘-modified** — menu accelerators built in `src-tauri/src/menu.rs`. The OS
  dispatches them regardless of what has focus. `⌘K` search · `⌘A` select all ·
  `⌘⌫` remove · `⌘⇧N` new window · `⌘,` settings · `⌘R` sync · `⌘I` inspector ·
  `⌘U` upload · `⌘⇧E` export.
- **Bare keys** — DOM listeners in the window that owns them. `Space` quick
  look · `←`/`→` step · `F` full screen · `↵` save name · `M` merge · `S` skip ·
  `X` not a person. A menu accelerator beats a focused text field every time, so
  registering `S` would make "Sam" unspellable in the review window.

Menu selections are broadcast as a `menu-command` event and each window ignores
them unless `document.hasFocus()` — Tauri has no "deliver to the key window".

## Where the offline cache lives, and what it keeps

`src-tauri/src/cache.rs`. The decision, in full:

**Location.** `<app data dir>/media-cache/<variant>/<first two characters of the
photo id>/<id>.<ext>`, with the app data directory resolved by Tauri — on macOS
`~/Library/Application Support/app.kindredphotos.desktop`. The two-character
fan-out keeps any one directory from holding a million files. The index is a
separate SQLite database, `media-cache.db`, beside it rather than inside the
uploader's `state.db`, so neither feature's schema can break the other.

**What flows through it.** Everything the four windows draw. The view layer asks
Rust for a photo id and a variant, gets an absolute path back, and turns it into
an asset URL with `convertFileSrc`. Nothing in `src/` holds an HTTP URL to the
household server, and the API key never reaches the webview.

**Variants.** `thumb` (512px), `preview` (2048px), `clip` (the silent hover loop
for videos) and `original`. Thumbnails arrive as a side effect of browsing.
Originals arrive only deliberately — opening a photo full size, dragging it out,
exporting, or a pin — because a library of 412 videos would fill any allowance
long before the photos did. Video originals are pulled in 8 MB **byte ranges**
(`/photos/{id}/local` answers 206), so a 2 GB file is never held in memory.

**Eviction.** Entries carry a pin: `favorite`, `recent`, `shared`, `manual`.
Pinned entries are never evicted. Everything else — ordinary browsing — is
least-recently-used and is trimmed after *every* write once the total passes the
allowance from Settings → Local cache (200 GB by default), so the cache trims
itself rather than needing a sweep. If the pinned set alone exceeds the
allowance the cache stays over rather than silently dropping a favourite.

**What the UI shows on a miss.** `lookup` never fetches. A photo with no cached
copy renders the tile placeholder plus a small dot, and the inspector says "Not
kept offline" — so a photo that is on this machine is visibly different from one
that is only on the server, which is the whole point when the server is down.

**Clearing.** Settings → Local cache → Clear cache removes the tree and the
index. Always safe: the originals live on the household server.

## Tauri configuration

- `assetProtocol` enabled, scoped to `$APPDATA/media-cache/**` — the only files
  the webview may read.
- Capability `default` covers `main`, `viewer-*`, `review-*`, `settings` and
  `uploader`.
- Plugins: `opener` (Reveal in Finder), `dialog` (export folder picker) and
  `tauri-plugin-drag` (the real OS drag session behind drag-out).

## Talking to the server

There is no fixed host: every household runs its own. The base URL and API key
are entered in Settings → Server and stored by `settings.rs` — the same pair the
bulk uploader already used, so pairing once serves both. `src-tauri/src/api.rs`
holds a path allowlist; the view layer cannot reach an arbitrary URL on the
household LAN.
