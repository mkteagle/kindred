"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "@/components/ui";
import { BACKEND, fmt } from "@/lib/constants";
import { useLightbox } from "@/components/photo-lightbox";
import type { LightboxPhoto } from "@/components/photo-lightbox";

interface EventPhoto {
  photo_id: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
  photo_url: string;
  date_taken: string | null;
}

interface Event {
  name: string;
  custom_name?: string;
  event_key?: string;
  photo_count: number;
  start_date: string | null;
  end_date: string | null;
  photos: EventPhoto[];
  total_photos: number;
}

interface EventsResponse {
  events: Event[];
  count: number;
}

function EventCard({
  event,
  onDismiss,
  onLabel,
}: {
  event: Event;
  onDismiss: (key: string) => void;
  onLabel: (key: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { openLightbox } = useLightbox();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(event.custom_name || "");
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = event.photos.slice(0, 8);
  const visible = expanded ? event.photos : preview;
  const remaining = event.total_photos - preview.length;
  const displayName = event.custom_name || event.name;
  const key = event.event_key || event.start_date || event.name;

  return (
    <article className="scene-card">
      <div className="scene-card-header">
        <div>
          {editing ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim()) { onLabel(key, draft.trim()); setEditing(false); }
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="Name this event..."
                autoFocus
                style={{ padding: "4px 8px", border: "1px solid var(--pine)", borderRadius: 4, fontSize: 14, outline: "none" }}
              />
              <Button small variant="primary" onClick={() => { if (draft.trim()) { onLabel(key, draft.trim()); setEditing(false); } }}>Save</Button>
              <Button small variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          ) : (
            <h3
              className="scene-card-label"
              onClick={() => { setDraft(event.custom_name || ""); setEditing(true); }}
              style={{ cursor: "pointer" }}
              title="Click to name this event"
            >
              {displayName}
              {event.custom_name && <span style={{ fontSize: 11, color: "var(--mist)", marginLeft: 8, fontWeight: 400 }}>{event.name}</span>}
            </h3>
          )}
          <span className="scene-card-count">
            {fmt.format(event.total_photos)} photo{event.total_photos !== 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {remaining > 0 && (
            <Button small variant="ghost" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : `Show all`}
            </Button>
          )}
          <Button small variant="danger" onClick={() => onDismiss(key)}>
            Dismiss
          </Button>
        </div>
      </div>
      <div className="scene-photo-grid">
        {visible.map((photo) => {
          const lbPhotos: LightboxPhoto[] = event.photos.map((p) => ({
            photo_id: p.photo_id, thumb_url: p.thumb_url || p.photo_url, flickr_url: p.flickr_url, photo_url: p.photo_url, photo_title: p.photo_title,
          }));
          return (
            <button key={photo.photo_id} className="clip-result-card" onClick={() => openLightbox(photo.photo_id, lbPhotos)} style={{ border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
              <img src={photo.thumb_url || photo.photo_url} alt={photo.photo_title || ""} />
              <div className="clip-result-info">
                <span className="clip-result-title">{photo.photo_title || "Untitled"}</span>
              </div>
            </button>
          );
        })}
      </div>
      {!expanded && remaining > 0 && (
        <p className="summary-note" style={{ textAlign: "left", marginTop: 10 }}>
          +{fmt.format(remaining)} more
        </p>
      )}
    </article>
  );
}

export default function EventsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<EventsResponse>({
    queryKey: ["events"],
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetch(`${BACKEND}/events`).then((r) => r.json()),
  });

  const events = data?.events || [];

  const handleDismiss = async (key: string) => {
    await fetch(`${BACKEND}/events/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_key: key }),
    });
    qc.invalidateQueries({ queryKey: ["events"] });
  };

  const handleLabel = async (key: string, name: string) => {
    await fetch(`${BACKEND}/events/label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_key: key, name }),
    });
    qc.invalidateQueries({ queryKey: ["events"] });
  };

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head" style={{ marginBottom: 24 }}>
          <div>
            <h2>Events</h2>
            <p>
              Photos grouped by when they were taken. Click an event name to rename it.
            </p>
          </div>
          {events.length > 0 && (
            <div className="summary-note">
              {fmt.format(events.length)} event{events.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="empty-state"><Spinner /></div>
        )}

        {!isLoading && events.length === 0 && (
          <div className="empty-state">
            <div>
              <h2>No events detected</h2>
              <p>Events require photos with date metadata. Run a metadata backfill first.</p>
            </div>
          </div>
        )}

        {!isLoading && events.map((event, i) => (
          <EventCard
            key={`${event.event_key || event.name}-${i}`}
            event={event}
            onDismiss={handleDismiss}
            onLabel={handleLabel}
          />
        ))}

        <footer className="kindling-footer">
          <span>By Kindling Signal</span>
          <p>Kindling builds useful software with character.</p>
        </footer>
      </main>
    </div>
  );
}
