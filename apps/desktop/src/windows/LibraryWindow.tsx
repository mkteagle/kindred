// Window 1 — Library. 1180×720.
//
// Sidebar, toolbar, virtualised mosaic, year scrubber, status bar. This is the
// window the app opens into and the one every other window is torn off from.

import { useCallback, useEffect, useMemo, useState } from "react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  Avatar,
  Button,
  Kbd,
  SearchIcon,
  TitleBar,
} from "../desktop/Chrome";
import { Mosaic } from "../desktop/Mosaic";
import { Sidebar, VIEW_TITLES, type ViewId } from "../desktop/Sidebar";
import { ServerBanner, StatusBar, YearScrubber } from "../desktop/Rails";
import { SearchPalette } from "../desktop/SearchPalette";
import {
  AlbumPicker,
  ClusterWall,
  EventsList,
  ObjectsList,
  Placeholder,
  SharesList,
} from "../desktop/Browse";
import { QuickLook } from "../desktop/QuickLook";

import { desktop, onMenuCommand, type CacheStats, type ServerStatus } from "../lib/desktop";
import { groupByDay, useDayTitles, usePhotoFeed, type FeedSource } from "../lib/feed";
import { formatAgo, formatCount } from "../lib/format";
import {
  library,
  loadSidebarCounts,
  type MediaFilter,
  type SidebarCounts,
  type YearBucket,
} from "../lib/library";
import { useSelection } from "../lib/selection";

/** Views that draw the photo mosaic, and what each one asks the server for. */
const MOSAIC_VIEWS: Partial<Record<ViewId, { source: FeedSource; media: MediaFilter }>> = {
  all: { source: "timeline", media: "all" },
  timeline: { source: "timeline", media: "all" },
  videos: { source: "gallery", media: "video" },
  favorites: { source: "favorites", media: "all" },
};

export function LibraryWindow() {
  const [view, setView] = useState<ViewId>("all");
  const [counts, setCounts] = useState<SidebarCounts | null>(null);
  const [years, setYears] = useState<YearBucket[]>([]);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  const [quickLookId, setQuickLookId] = useState<string | null>(null);
  const [dragBusy, setDragBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeYear, setActiveYear] = useState<number | null>(null);

  const selection = useSelection();
  const mosaicConfig = MOSAIC_VIEWS[view];
  const feed = usePhotoFeed(
    mosaicConfig?.source ?? "timeline",
    mosaicConfig?.media ?? "all",
  );
  const dayTitles = useDayTitles();

  const sections = useMemo(
    () => (mosaicConfig ? groupByDay(feed.photos, dayTitles) : []),
    [mosaicConfig, feed.photos, dayTitles],
  );
  const ordered = useMemo(() => feed.photos.map((p) => p.photo_id), [feed.photos]);

  /* ── Chrome data ────────────────────────────────────────────────────── */

  const refreshChrome = useCallback(() => {
    loadSidebarCounts().then(setCounts).catch(() => {});
    library.years("all").then(setYears).catch(() => {});
    desktop.cacheStats().then(setCache).catch(() => {});
    desktop.serverStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refreshChrome();
    const timer = window.setInterval(
      () => desktop.serverStatus().then(setStatus).catch(() => {}),
      5000,
    );
    return () => window.clearInterval(timer);
  }, [refreshChrome]);

  // Count down to the next automatic retry, so the banner's promise is real.
  useEffect(() => {
    if (!status || status.reachable) {
      setRetryIn(null);
      return;
    }
    setRetryIn(30);
    const timer = window.setInterval(() => {
      setRetryIn((seconds) => {
        if (seconds === null) return null;
        if (seconds <= 1) {
          void desktop.pingServer().then(setStatus).catch(() => {});
          return 30;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status?.reachable, status]);

  /* ── Actions ────────────────────────────────────────────────────────── */

  const selectedIds = useMemo(() => Array.from(selection.selected), [selection.selected]);

  const openViewer = useCallback(
    (photoId: string) => {
      void desktop.openWindow("viewer", {
        photoId,
        // The viewer gets the ids it can step through, so ← / → work without
        // it re-querying the server for a page it cannot reconstruct.
        photoIds: ordered.slice(0, 500),
      });
    },
    [ordered],
  );

  /**
   * Drag out to Finder.
   *
   * Two halves, and only one of them is the frontend's: Rust pulls the
   * originals into the cache and returns real paths (`prepare_originals`),
   * then `tauri-plugin-drag` starts an actual OS drag session with those paths
   * and a cached thumbnail as the drag image. A webview cannot do the second
   * half at all — an HTML5 drag has no way to hand a file to Finder.
   */
  const dragOut = useCallback(async () => {
    if (selectedIds.length === 0 || dragBusy) return;
    setDragBusy(true);
    setNotice(null);
    try {
      const paths = await desktop.prepareOriginals(selectedIds);
      // The drag image wants a real file path, not an asset URL — the cached
      // thumbnail if we have one, otherwise the original itself.
      const thumb = await desktop.mediaRef(selectedIds[0], "thumb").catch(() => null);
      await startDrag({ item: paths, icon: thumb?.path ?? paths[0], mode: "copy" });
    } catch (e) {
      setNotice(`Could not prepare the originals — ${String(e)}`);
    } finally {
      setDragBusy(false);
      desktop.cacheStats().then(setCache).catch(() => {});
    }
  }, [selectedIds, dragBusy]);

  const exportSelection = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const destination = await openDialog({ directory: true, multiple: false });
    if (typeof destination !== "string") return;
    setNotice("Exporting…");
    try {
      const titles = selectedIds.map(
        (id) => feed.photos.find((p) => p.photo_id === id)?.photo_title ?? id,
      );
      const result = await desktop.exportOriginals(selectedIds, titles, destination);
      setNotice(
        result.failed.length
          ? `Wrote ${result.written.length}, ${result.failed.length} failed.`
          : `Wrote ${result.written.length} to ${destination}.`,
      );
    } catch (e) {
      setNotice(String(e));
    }
  }, [selectedIds, feed.photos]);

  const addToAlbum = useCallback(
    async (albumRef: string) => {
      setAlbumPickerOpen(false);
      try {
        await library.addToAlbum(albumRef, selectedIds);
        setNotice(`Added ${formatCount(selectedIds.length)} to the album.`);
      } catch (e) {
        setNotice(String(e));
      }
    },
    [selectedIds],
  );

  /**
   * ⌘⌫.
   *
   * TODO: nothing on the backend removes a photo from the library. `/flickr/delete`
   * deletes from Flickr and is admin-only and irreversible, which is not the
   * same promise. A `DELETE /photos/{id}` (or `POST /photos/archive`) that
   * unlists a photo without destroying the original would close this — and the
   * design's rule that "everything destructive is server-confirmed before the
   * UI commits" means the grid must not drop the tile until it answers.
   */
  const removeFromLibrary = useCallback(() => {
    if (selectedIds.length === 0) return;
    setNotice(
      `Removing photos is not wired up yet — the server has no endpoint that unlists a photo without deleting the original.`,
    );
  }, [selectedIds]);

  const syncNow = useCallback(() => {
    desktop.pingServer().then(setStatus).catch(() => {});
    feed.reload();
    refreshChrome();
  }, [feed, refreshChrome]);

  /* ── Keyboard ───────────────────────────────────────────────────────── */

  // The menu owns every ⌘-modified shortcut; this is where they land.
  useEffect(() => {
    const unlisten = onMenuCommand((id) => {
      switch (id) {
        case "search":
          setSearchOpen(true);
          break;
        case "select-all": {
          // ⌘A in a text field must still be select-all-text.
          const active = document.activeElement;
          const editable =
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement ||
            (active instanceof HTMLElement && active.isContentEditable);
          if (editable) document.execCommand?.("selectAll");
          else selection.selectAll(ordered);
          break;
        }
        case "deselect":
          selection.clear();
          break;
        case "sync":
          syncNow();
          break;
        case "remove":
          removeFromLibrary();
          break;
        case "add-to-album":
          if (selectedIds.length) setAlbumPickerOpen(true);
          break;
        case "export":
          void exportSelection();
          break;
        case "new-window":
        case "open-viewer": {
          const first = selectedIds[0] ?? ordered[0];
          if (first) openViewer(first);
          break;
        }
        case "open-review":
          void desktop.openWindow("review", { category: "people" });
          break;
        case "quick-look":
          setQuickLookId(selectedIds[0] ?? ordered[0] ?? null);
          break;
        case "favorite":
          if (selectedIds[0]) {
            void library
              .setFavorite(selectedIds[0], true)
              .then(() => refreshChrome())
              .catch((e) => setNotice(String(e)));
          }
          break;
        case "toggle-sidebar":
        case "toggle-inspector":
          // The library window has no inspector; the viewer handles these.
          break;
        default:
          break;
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [
    ordered,
    selection,
    selectedIds,
    syncNow,
    removeFromLibrary,
    exportSelection,
    openViewer,
    refreshChrome,
  ]);

  // Bare keys stay in the DOM so they never swallow typing. See menu.rs.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (quickLookId) setQuickLookId(null);
        else if (searchOpen) setSearchOpen(false);
        else selection.clear();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [quickLookId, searchOpen, selection]);

  /* ── Year scrubber ──────────────────────────────────────────────────── */

  const jumpToYear = useCallback(
    (year: number) => {
      setActiveYear(year);
      // Paging back to a year that is decades deep would be dozens of round
      // trips, so the scrubber asks the server for that year directly.
      setNotice(null);
      library
        .gallery({ dateFrom: `${year}-01-01`, dateTo: `${year}-12-31`, limit: 100 })
        .then((page) => {
          if (page.photos.length === 0) {
            setNotice(`Nothing in ${year}.`);
            return;
          }
          const first = page.photos[0];
          setNotice(`Jumped to ${year} — showing from ${first.photo_title || "the first photo"}.`);
          // TODO: seek the timeline itself to this year. /timeline pages
          // backwards from newest with `before`, so a `from` (or a
          // `?month=YYYY-MM` anchor) would let the mosaic land on the year
          // rather than opening it as a filtered result.
          setQuickLookId(first.photo_id);
        })
        .catch((e) => setNotice(String(e)));
    },
    [],
  );

  /* ── Render ─────────────────────────────────────────────────────────── */

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (counts?.allPhotos != null) parts.push(`${formatCount(counts.allPhotos)} photos`);
    if (counts?.videos != null) parts.push(`${formatCount(counts.videos)} videos`);
    parts.push(status?.last_ok ? `synced ${formatAgo(status.last_ok)}` : "not synced yet");
    return parts.join(" · ");
  }, [counts, status]);

  const offline = status !== null && !status.reachable;

  return (
    <div className="k-root">
      <TitleBar title={`Kindred — ${VIEW_TITLES[view]}`} />
      <div className="k-body">
        <Sidebar
          current={view}
          onNavigate={(next) => {
            setView(next);
            selection.clear();
          }}
          counts={counts}
          cache={cache}
          onOpenCacheSettings={() => desktop.openWindow("settings", { pane: "cache" })}
        />
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Toolbar
            title={VIEW_TITLES[view]}
            subtitle={subtitle}
            onSearch={() => setSearchOpen(true)}
            onSelectAll={() => selection.selectAll(ordered)}
            onUpload={() => desktop.openWindow("uploader")}
          />
          {offline || notice ? (
            <div style={{ padding: "10px 16px 0" }}>
              {offline && status ? (
                <ServerBanner
                  status={status}
                  retryInSeconds={retryIn}
                  onRetry={() => {
                    // Retrying an address that was never entered is theatre;
                    // send them where they can enter one.
                    if (!status.configured) {
                      void desktop.openWindow("settings", { pane: "server" });
                      return;
                    }
                    desktop.pingServer().then(setStatus).catch(() => {});
                  }}
                />
              ) : null}
              {notice ? (
                <p
                  role="status"
                  style={{ margin: "8px 0 0", fontSize: 12, color: "var(--k-ink-3)" }}
                >
                  {notice}
                </p>
              ) : null}
            </div>
          ) : null}

          <div style={{ flex: "1 1 auto", display: "flex", minHeight: 0, position: "relative" }}>
            <Content
              view={view}
              feed={feed}
              sections={sections}
              ordered={ordered}
              selection={selection}
              onOpen={openViewer}
              onQuickLook={setQuickLookId}
              onNavigate={setView}
            />
            {mosaicConfig ? (
              <YearScrubber years={years} active={activeYear} onPick={jumpToYear} />
            ) : null}
          </div>

          <StatusBar
            selectedCount={selection.count}
            onShare={() =>
              setNotice(
                // TODO: POST /shares exists but takes an album, not a loose
                // selection. Sharing the current selection needs either an
                // album created on the fly or a `photo_ids` body on /shares.
                "Sharing a loose selection needs a /shares body that takes photo ids — add the photos to an album first.",
              )
            }
            onAddToAlbum={() => setAlbumPickerOpen(true)}
            onDragOut={() => void dragOut()}
            dragOutBusy={dragBusy}
          />
        </div>
      </div>

      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={(photoId) => openViewer(photoId)}
      />
      {albumPickerOpen ? (
        <AlbumPicker
          onCancel={() => setAlbumPickerOpen(false)}
          onPick={(album) => void addToAlbum(album.id ?? album.slug ?? album.name)}
        />
      ) : null}
      {quickLookId ? (
        <QuickLook photoId={quickLookId} onClose={() => setQuickLookId(null)} />
      ) : null}
    </div>
  );
}

/* ── Toolbar ──────────────────────────────────────────────────────────── */

function Toolbar({
  title,
  subtitle,
  onSearch,
  onSelectAll,
  onUpload,
}: {
  title: string;
  subtitle: string;
  onSearch: () => void;
  onSelectAll: () => void;
  onUpload: () => void;
}) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 18px",
        borderBottom: "1px solid var(--k-line)",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <strong style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600 }}>
          {title}
        </strong>
        <span className="k-mono">{subtitle}</span>
      </span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          className="k-field"
          onClick={onSearch}
          style={{ width: 260, cursor: "text" }}
          aria-label="Search the library"
        >
          <span style={{ color: "var(--k-ink-4)", display: "flex" }}>
            <SearchIcon size={14} />
          </span>
          <span className="k-mono-11">Search</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <Button onClick={onSelectAll}>Select</Button>
        <Button variant="primary" onClick={onUpload}>
          Upload
        </Button>
        <Avatar name="Kindred" />
      </span>
    </div>
  );
}

/* ── Content router ───────────────────────────────────────────────────── */

function Content({
  view,
  feed,
  sections,
  ordered,
  selection,
  onOpen,
  onQuickLook,
  onNavigate,
}: {
  view: ViewId;
  feed: ReturnType<typeof usePhotoFeed>;
  sections: ReturnType<typeof groupByDay>;
  ordered: string[];
  selection: ReturnType<typeof useSelection>;
  onOpen: (photoId: string) => void;
  onQuickLook: (photoId: string) => void;
  onNavigate: (view: ViewId) => void;
}) {
  if (MOSAIC_VIEWS[view]) {
    if (feed.loading && feed.photos.length === 0) {
      return <Placeholder title="Loading the library…" />;
    }
    if (feed.error && feed.photos.length === 0) {
      return (
        <Placeholder
          title="The server did not answer"
          body={`${feed.error} — anything already kept offline is still here.`}
        />
      );
    }
    return (
      <Mosaic
        sections={sections}
        ordered={ordered}
        selection={selection}
        onOpen={onOpen}
        onQuickLook={onQuickLook}
        onReachEnd={feed.loadMore}
        loadingMore={feed.loadingMore}
        empty={<Placeholder title="Nothing here yet" />}
      />
    );
  }

  switch (view) {
    case "people":
    case "animals":
    case "vehicles":
      return (
        <ClusterWall
          category={view === "people" ? "people" : view === "animals" ? "pets" : "vehicles"}
          onOpenCluster={(cluster) =>
            void desktop.openWindow("review", {
              category: view === "people" ? "people" : view === "animals" ? "pets" : "vehicles",
              clusterId: cluster.id,
            })
          }
          onReview={() => void desktop.openWindow("review", { category: "people" })}
        />
      );
    case "shared":
      return <SharesList />;
    case "events":
      return <EventsList onOpenDay={() => onNavigate("all")} />;
    case "objects":
      return <ObjectsList onPick={() => onNavigate("all")} />;
    case "locations":
      return (
        <Placeholder
          title="Locations"
          body="Photos carry coordinates but almost none carry a place name yet. TODO: /locations groups by location_name; this becomes a map once reverse geocoding has run."
        />
      );
    case "together":
      return (
        <Placeholder
          title="Together"
          body="Pick two or more people to see the photos they are both in. TODO: wire the people picker to /photos/together?people=id,id."
        />
      );
    case "colors":
      return (
        <Placeholder
          title="Colors"
          body="TODO: /search/color takes a hex value; this becomes a swatch wall once the palette set is decided."
        />
      );
    case "duplicates":
      return (
        <Placeholder
          title="Duplicates"
          body="TODO: /duplicates returns near-identical pairs by CLIP distance; this becomes a merge queue like the review window's."
        />
      );
    default:
      return <Placeholder title={VIEW_TITLES[view]} />;
  }
}
