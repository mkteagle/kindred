"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKEND, fmt } from "@/lib/constants";
import { useUser } from "@/lib/use-user";
import { useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { KxEmpty, KxErrorBanner, KxSkeletonCards } from "@/components/kx/states";
import { photoThumb } from "@/lib/photo-url";

interface EventPhoto {
  photo_id: string;
  thumb_url: string;
  flickr_url: string;
  photo_title: string;
  photo_url: string;
  date_taken: string | null;
}

interface LibraryEvent {
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
  events: LibraryEvent[];
  count: number;
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const DAY_SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });

/** "13 – 15 June 2026", or one date when the event lasted a day. */
function dateRange(start: string | null, end: string | null): string {
  const from = start ? new Date(start.replace(" ", "T")) : null;
  const to = end ? new Date(end.replace(" ", "T")) : null;
  if (!from || Number.isNaN(from.getTime())) return "";
  if (!to || Number.isNaN(to.getTime()) || from.toDateString() === to.toDateString()) {
    return DAY.format(from);
  }
  return `${DAY_SHORT.format(from)} – ${DAY.format(to)}`;
}

/**
 * One event card: a stack of five photos, the day's title, when and where,
 * then the count. Five is enough of a day to recognise it without turning the
 * card into a contact sheet.
 */
function EventCard({ event }: { event: LibraryEvent }) {
  const { isAdmin } = useUser();
  const { openLightbox } = useLightbox();
  const queryClient = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const key = event.event_key || event.start_date || event.name;

  const label = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch(`${BACKEND}/events/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_key: key, name }),
      });
      if (!response.ok) throw new Error("That name could not be saved.");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kx-events"] });
      void queryClient.invalidateQueries({ queryKey: ["kx-day-labels"] });
    },
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${BACKEND}/events/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_key: key }),
      });
      if (!response.ok) throw new Error("That could not be dismissed.");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["kx-events"] }),
  });

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  const lightboxPhotos: LightboxPhoto[] = event.photos.map((photo) => ({
    photo_id: photo.photo_id,
    thumb_url: photoThumb(photo),
    photo_url: photo.photo_url,
    flickr_url: photo.flickr_url,
    photo_title: photo.photo_title,
  }));

  const stack = event.photos.slice(0, 5);
  // The endpoint names an event after its date when nobody has. That is the
  // line underneath already, so an unnamed day says so plainly.
  const named = Boolean(event.custom_name);

  const save = () => {
    const name = draft.trim();
    if (name) label.mutate(name);
    setNaming(false);
    setDraft("");
  };

  return (
    <div className="kx-card-lift kx-eventcard">
      <button
        className="kx-eventstack"
        onClick={() => stack[0] && openLightbox(stack[0].photo_id, lightboxPhotos)}
        aria-label={`Open ${event.custom_name || "this day"}`}
        style={{ border: 0, padding: 0, cursor: "pointer" }}
      >
        {stack.map((photo) => (
          <img key={photo.photo_id} src={photoThumb(photo)} alt="" loading="lazy" />
        ))}
      </button>

      <div className={`kx-eventcard-body ${named ? "" : "unnamed"}`.trim()}>
        {naming ? (
          <input
            ref={inputRef}
            className="kx-eventname"
            value={draft}
            placeholder="Name this day"
            aria-label="Name this day"
            onChange={(event_) => setDraft(event_.target.value)}
            onBlur={save}
            onKeyDown={(event_) => {
              if (event_.key === "Enter") save();
              if (event_.key === "Escape") {
                event_.stopPropagation();
                setNaming(false);
                setDraft("");
              }
            }}
          />
        ) : (
          <strong>{event.custom_name || "Unnamed gathering"}</strong>
        )}

        {/* TODO: the design pairs the range with the place — "13 – 15 June
            2026 · Lake Verity, Oregon" — and the count with people and video
            tallies. /events returns none of those: nothing reverse-geocodes,
            and the response carries no per-event cluster or media breakdown.
            Adding `place`, `people_count` and `video_count` to each event row
            would complete both lines. */}
        <span className="kx-cardmeta">{dateRange(event.start_date, event.end_date)}</span>
        <span className="kx-cardmeta accent">
          {fmt.format(event.total_photos)} {event.total_photos === 1 ? "photo" : "photos"}
        </span>

        {isAdmin && !naming && (
          <span className="kx-eventcard-actions">
            <button
              className="kx-button compact"
              onClick={() => {
                setDraft(event.custom_name || "");
                setNaming(true);
              }}
            >
              {named ? "Rename" : "Name this day"}
            </button>
            <button
              className="kx-button compact danger"
              disabled={dismiss.isPending}
              onClick={() => dismiss.mutate()}
            >
              Not a day
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export default function EventsPage() {
  const { data, error, isPending, refetch } = useQuery<EventsResponse>({
    queryKey: ["kx-events"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/events`);
      if (!response.ok) throw new Error("Your events could not be loaded.");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const events = data?.events ?? [];

  return (
    <main className="kx-page">
      <span className="kx-eyebrow">Events</span>
      <h1 className="kx-title">Days that clustered on their own.</h1>
      <p className="kx-lede">
        Photos taken close together in time and place, grouped without anyone naming them. Name one
        and it becomes the day&rsquo;s title.
      </p>

      {error && <KxErrorBanner detail={(error as Error).message} onRetry={() => void refetch()} />}
      {!error && isPending && <KxSkeletonCards count={6} minWidth={320} height={260} />}
      {!error && !isPending && events.length === 0 && (
        <KxEmpty
          title="Nothing here yet."
          body="Days group themselves once photos carry the time they were taken. The next sync will fill this in."
          action={{ label: "Browse the library", href: "/gallery", primary: true }}
        />
      )}

      {events.length > 0 && (
        <div className="kx-eventgrid">
          {events.map((event, index) => (
            <EventCard key={`${event.event_key || event.name}-${index}`} event={event} />
          ))}
        </div>
      )}
    </main>
  );
}
