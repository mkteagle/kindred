"use client";

import { use, useCallback, useEffect, useState } from "react";

/**
 * Public share viewer.
 *
 * Deliberately outside the (main) route group: no topbar, no session, no
 * library navigation. Everything on this page comes from one share token, and
 * the backend re-checks that token's scope on every media request.
 */

interface ShareItem {
  photo_id: string;
  photo_title: string;
  media_kind: "photo" | "video";
  duration_seconds: number | null;
  date_taken: string;
  thumb_url: string;
  preview_url: string;
  clip_url: string | null;
}

interface ShareView {
  locked: boolean;
  subject_type: "photo" | "album";
  title: string;
  items: ShareItem[];
  allow_download: boolean;
  expires_at?: string | null;
}

/**
 * Media URLs arrive absolute, pointing at the API origin. Re-point them at the
 * same-origin proxy so the page works wherever it is served, keeping the query
 * string intact — for a password-protected share it carries the signature.
 */
function sameOrigin(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return `/api/backend${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [view, setView] = useState<ShareView | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [active, setActive] = useState<ShareItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/backend/public/shares/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("gone");
        return response.json();
      })
      .then((data: ShareView) => {
        if (cancelled) return;
        setView(data);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const unlock = useCallback(async () => {
    setUnlocking(true);
    setPasswordError(null);
    try {
      const response = await fetch(
        `/api/backend/public/shares/${encodeURIComponent(token)}/unlock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      if (response.status === 401) {
        setPasswordError("That password didn't work.");
        return;
      }
      if (!response.ok) {
        setStatus("missing");
        return;
      }
      setView(await response.json());
    } catch {
      setPasswordError("Something went wrong. Try again.");
    } finally {
      setUnlocking(false);
    }
  }, [token, password]);

  if (status === "loading") {
    return <main className="share-page"><p role="status">Loading…</p></main>;
  }

  // Revoked, expired and never-existed are deliberately indistinguishable.
  if (status === "missing" || !view) {
    return (
      <main className="share-page">
        <div className="share-empty">
          <h1>This link isn&rsquo;t available</h1>
          <p>It may have expired, or been turned off by whoever shared it.</p>
        </div>
      </main>
    );
  }

  if (view.locked) {
    return (
      <main className="share-page">
        <div className="share-lock">
          <h1>{view.title || "Shared with you"}</h1>
          <p>This one needs a password.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              aria-label="Share password"
            />
            <button type="submit" className="button primary" disabled={unlocking || !password}>
              {unlocking ? "Checking…" : "View"}
            </button>
          </form>
          {passwordError && <p className="share-error" role="alert">{passwordError}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="share-page">
      <header className="share-head">
        <h1>{view.title || "Shared with you"}</h1>
        <p>
          {view.items.length} item{view.items.length === 1 ? "" : "s"}
          {view.expires_at && <> · available until {new Date(view.expires_at).toLocaleDateString()}</>}
        </p>
      </header>

      <div className="share-grid">
        {view.items.map((item) => {
          const duration = formatDuration(item.duration_seconds);
          return (
            <button key={item.photo_id} className="share-tile" onClick={() => setActive(item)}>
              <img src={sameOrigin(item.thumb_url)} alt={item.photo_title} loading="lazy" />
              {item.media_kind === "video" && (
                <span className="share-tile-video" aria-hidden="true">
                  {duration ?? "Video"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active && (
        <div className="share-viewer" role="dialog" aria-modal="true" onClick={() => setActive(null)}>
          <button className="share-viewer-close" onClick={() => setActive(null)} aria-label="Close">
            &times;
          </button>
          <div className="share-viewer-body" onClick={(e) => e.stopPropagation()}>
            {active.media_kind === "video" ? (
              <video
                src={sameOrigin(active.preview_url).replace("variant=preview", "variant=original")}
                poster={sameOrigin(active.thumb_url)}
                controls
                autoPlay
                playsInline
              />
            ) : (
              <img src={sameOrigin(active.preview_url)} alt={active.photo_title} />
            )}
            <div className="share-viewer-meta">
              <span>{active.photo_title}</span>
              {view.allow_download && (
                <a
                  href={sameOrigin(active.preview_url).replace("variant=preview", "variant=original")}
                  download
                  className="button small"
                >
                  Download
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="share-foot">
        <span>Shared from Kindred</span>
      </footer>
    </main>
  );
}
