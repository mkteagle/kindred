// ⌘K.
//
// A focus-trapped overlay over whichever window opened it. Results come from
// /search, which answers free text from three sources (a person whose name
// matches, CLIP similarity, and a literal title match) — so the same field
// finds "Junie", "campfire" and "IMG_0042".

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Kbd, SearchIcon } from "./Chrome";
import { library, type SearchResult } from "../lib/library";
import { useMedia } from "../lib/media";
import { formatStamp } from "../lib/format";

export function SearchPalette({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (photoId: string, results: SearchResult[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement;
    inputRef.current?.focus();
    return () => {
      // Give the keyboard back to wherever it came from.
      (restoreFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  // Debounced: typing "campfire" should not be eight CLIP searches.
  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    if (!text) {
      setResults([]);
      setError(null);
      return;
    }
    let live = true;
    setBusy(true);
    const timer = window.setTimeout(() => {
      library
        .search({ q: text, limit: 40 })
        .then((response) => {
          if (!live) return;
          setResults(response.results ?? []);
          setHighlight(0);
          setError(null);
        })
        .catch((e) => live && setError(String(e)))
        .finally(() => live && setBusy(false));
    }, 220);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((h) => Math.min(results.length - 1, h + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (event.key === "Enter" && results[highlight]) {
        event.preventDefault();
        onPick(results[highlight].photo_id, results);
        onClose();
      }
      if (event.key === "Tab") {
        // A modal keeps its own focus: there is nothing behind it to reach.
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [results, highlight, onClose, onPick],
  );

  if (!open) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: "rgba(8, 9, 8, 0.72)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: 90,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search the library"
        onKeyDown={onKeyDown}
        className="k-rise"
        style={{
          width: 620,
          maxWidth: "calc(100% - 48px)",
          maxHeight: "70%",
          display: "flex",
          flexDirection: "column",
          background: "var(--k-sheet)",
          border: "1px solid var(--k-line-2)",
          borderRadius: "var(--k-radius)",
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 14px",
            height: 52,
            borderBottom: "1px solid var(--k-line)",
          }}
        >
          <span style={{ color: "var(--k-ink-4)", display: "flex" }}>
            <SearchIcon size={16} />
          </span>
          <input
            ref={inputRef}
            className="k-input"
            style={{ fontSize: 14, fontFamily: "var(--font-body)", letterSpacing: 0 }}
            placeholder="Search people, places, things…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search the library"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="k-scroll" style={{ flex: "1 1 auto" }} role="listbox" aria-label="Results">
          {error ? (
            <p style={{ padding: 16, color: "var(--k-danger-ink)", fontSize: 13 }}>{error}</p>
          ) : null}
          {!error && query.trim() && !busy && results.length === 0 ? (
            <p style={{ padding: 16, color: "var(--k-ink-4)", fontSize: 13 }}>
              Nothing matched “{query.trim()}”.
            </p>
          ) : null}
          {results.map((result, index) => (
            <ResultRow
              key={result.photo_id}
              result={result}
              active={index === highlight}
              onPick={() => {
                onPick(result.photo_id, results);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  result,
  active,
  onPick,
}: {
  result: SearchResult;
  active: boolean;
  onPick: () => void;
}) {
  const media = useMedia(result.photo_id, "thumb");
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      className="k-row"
      style={{
        borderRadius: 0,
        padding: "8px 14px",
        gap: 12,
        background: active ? "var(--k-fill-2)" : undefined,
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          flex: "none",
          borderRadius: 4,
          background: "var(--k-tile)",
          overflow: "hidden",
        }}
      >
        {media.src ? (
          <img
            src={media.src}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--k-ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {result.photo_title || "Untitled"}
        </span>
        <span className="k-mono">{formatStamp(result.date_taken)}</span>
      </span>
    </button>
  );
}
