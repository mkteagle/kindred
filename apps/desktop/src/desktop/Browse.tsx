// The sidebar destinations that are not the photo mosaic.
//
// People / Animals / Vehicles are cluster walls; the "ways in" are lists over
// the endpoints that back them. Face and object chips arrive from the server as
// `data:` URIs, so unlike photos they do not go through the offline cache.

import { useEffect, useState, type ReactNode } from "react";
import { Button, Eyebrow } from "./Chrome";
import { formatCount } from "../lib/format";
import {
  library,
  type Album,
  type Cluster,
  type LibraryEvent,
  type Share,
} from "../lib/library";

/* ── Loading / empty / error shells ───────────────────────────────────── */

export function Placeholder({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 32 }}>
      <div style={{ maxWidth: 420, textAlign: "center", display: "grid", gap: 8 }}>
        <strong className="k-display" style={{ fontSize: 20 }}>
          {title}
        </strong>
        {body ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--k-ink-3)", lineHeight: 1.5 }}>{body}</p>
        ) : null}
      </div>
    </div>
  );
}

function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    load()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e) => live && setState({ data: null, error: String(e), loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/* ── Cluster wall ─────────────────────────────────────────────────────── */

export function ClusterWall({
  category,
  onOpenCluster,
  onReview,
}: {
  category: "people" | "pets" | "vehicles";
  onOpenCluster: (cluster: Cluster) => void;
  onReview: () => void;
}) {
  const { data, error, loading } = useAsync(
    () => library.clusters(category, { limit: 120 }),
    [category],
  );

  if (loading) return <Placeholder title="Loading…" />;
  if (error) return <Placeholder title="Could not load" body={error} />;
  const clusters = data?.clusters ?? [];
  const unnamed = clusters.filter((c) => !c.label).length;

  return (
    <div className="k-scroll" style={{ flex: "1 1 auto", padding: "14px 16px" }}>
      {category === "people" && unnamed > 0 ? (
        <div
          className="k-card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 14px",
            marginBottom: 16,
          }}
        >
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <strong style={{ fontSize: 13 }}>{formatCount(unnamed)} still to name</strong>
            <span className="k-mono">Largest group first</span>
          </span>
          <span style={{ marginLeft: "auto" }}>
            <Button variant="primary" onClick={onReview}>
              Start a review session
            </Button>
          </span>
        </div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))",
          gap: 12,
        }}
      >
        {clusters.map((cluster) => (
          <button
            key={cluster.id}
            type="button"
            onClick={() => onOpenCluster(cluster)}
            style={{
              display: "grid",
              gap: 8,
              justifyItems: "center",
              padding: 8,
              border: "none",
              background: "transparent",
              borderRadius: "var(--k-radius)",
              color: "inherit",
            }}
          >
            <span
              style={{
                width: "100%",
                aspectRatio: "1",
                borderRadius: 999,
                background: "var(--k-tile)",
                overflow: "hidden",
              }}
            >
              {cluster.avatar ? (
                <img
                  src={cluster.avatar}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: cluster.label ? "var(--k-ink)" : "var(--k-ink-3)",
                fontStyle: cluster.label ? "normal" : "italic",
                textAlign: "center",
              }}
            >
              {cluster.label ?? "Unnamed"}
            </span>
            <span className="k-mono">{formatCount(cluster.photo_count)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Ways in ──────────────────────────────────────────────────────────── */

export function EventsList({ onOpenDay }: { onOpenDay: (isoDate: string) => void }) {
  const { data, error, loading } = useAsync(() => library.events(), []);
  if (loading) return <Placeholder title="Finding events…" />;
  if (error) return <Placeholder title="Could not load events" body={error} />;
  const events = (data ?? []) as LibraryEvent[];
  if (events.length === 0) {
    return (
      <Placeholder
        title="No events yet"
        body="Events appear once photos carry capture times close enough together to group."
      />
    );
  }
  return (
    <div className="k-scroll" style={{ flex: "1 1 auto", padding: "14px 16px", display: "grid", gap: 8 }}>
      {events.map((event) => (
        <button
          key={event.event_key ?? event.name}
          type="button"
          className="k-card"
          onClick={() => event.start_date && onOpenDay(event.start_date)}
          style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", color: "inherit", textAlign: "left" }}
        >
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <strong style={{ fontSize: 13 }}>{event.custom_name ?? event.name}</strong>
            <span className="k-mono">
              {formatCount(event.photo_count)} photos
              {event.start_date ? ` · from ${event.start_date.slice(0, 10)}` : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function SharesList() {
  const { data, error, loading } = useAsync(() => library.shares(), []);
  if (loading) return <Placeholder title="Loading shares…" />;
  if (error) return <Placeholder title="Could not load shares" body={error} />;
  const shares = (data ?? []) as Share[];
  if (shares.length === 0) {
    return <Placeholder title="Nothing shared" body="Select photos and choose Share to make a link." />;
  }
  return (
    <div className="k-scroll" style={{ flex: "1 1 auto", padding: "14px 16px", display: "grid", gap: 8 }}>
      {shares.map((share) => (
        <div
          key={share.id}
          className="k-card"
          style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px" }}
        >
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <strong style={{ fontSize: 13 }}>{share.album_name ?? "A selection"}</strong>
            <span className="k-mono">
              {share.created_at ? `Shared ${String(share.created_at).slice(0, 10)}` : "Shared"}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function ObjectsList({ onPick }: { onPick: (label: string) => void }) {
  const { data, error, loading } = useAsync(() => library.objects(), []);
  if (loading) return <Placeholder title="Looking for objects…" />;
  if (error) return <Placeholder title="Could not load objects" body={error} />;
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return <Placeholder title="No objects detected yet" />;
  return (
    <div className="k-scroll" style={{ flex: "1 1 auto", padding: "14px 16px" }}>
      <Eyebrow>Also in view</Eyebrow>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        {entries.map(([label, photos]) => (
          <button key={label} type="button" className="k-pill" onClick={() => onPick(label)}>
            {label}
            <span style={{ color: "var(--k-ink-4)" }}>{photos.length}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AlbumPicker({
  onCancel,
  onPick,
}: {
  onCancel: () => void;
  onPick: (album: Album) => void;
}) {
  const { data, error, loading } = useAsync(() => library.albums(), []);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: "rgba(8,9,8,.72)",
        display: "grid",
        placeItems: "center",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to album"
        className="k-rise"
        style={{
          width: 420,
          maxHeight: "60%",
          display: "flex",
          flexDirection: "column",
          background: "var(--k-sheet)",
          border: "1px solid var(--k-line-2)",
          borderRadius: "var(--k-radius)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--k-line)" }}>
          <Eyebrow>Add to album</Eyebrow>
        </div>
        <div className="k-scroll" style={{ flex: "1 1 auto", padding: 8 }}>
          {loading ? <p className="k-mono" style={{ padding: 12 }}>Loading…</p> : null}
          {error ? (
            <p style={{ padding: 12, fontSize: 13, color: "var(--k-danger-ink)" }}>{error}</p>
          ) : null}
          {(data ?? []).map((album) => (
            <button
              key={album.id ?? album.name}
              type="button"
              className="k-row"
              onClick={() => onPick(album)}
            >
              {album.name}
              <span className="k-row-count">{formatCount(album.photo_count)}</span>
            </button>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid var(--k-line)", textAlign: "right" }}>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
