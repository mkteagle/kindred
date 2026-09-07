"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKEND } from "@/lib/constants";

/**
 * A day header is always `date · N photos`. A label is added only when one
 * exists, and it always says where it came from. Nothing here invents one:
 * `/events` derives a name from the date when nobody has set one, and that is
 * a restatement of the header, not a label.
 */
export interface DayLabel {
  /** The name a member gave the day, or null when nobody has named it. */
  label: string | null;
  /** Where the label came from, as the provenance chip states it. */
  source: "member" | "location" | null;
  /** The key /events/label writes against. */
  eventKey: string;
}

interface EventRow {
  name: string;
  custom_name?: string;
  event_key?: string;
  start_date: string | null;
}

/** "2026-06-14 21:48:00" or an ISO string → "2026-06-14". */
export function dayKeyOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? match[0] : null;
}

/**
 * Labels for the days the library is showing, keyed YYYY-MM-DD.
 *
 * TODO: this reads the whole of `/events`, which is the only source of day
 * names today. A `/library/days?from=&to=` returning label, provenance and
 * count per calendar day would let the mosaic ask only for the days on screen.
 *
 * TODO: `event_labels` records the name but not who wrote it, so the member's
 * own name cannot be shown. An author column would let the chip read
 * "named by Mara" as the design has it, instead of "named by a member".
 *
 * TODO: the "from location" provenance has no source at all. Nothing
 * reverse-geocodes, and `photo_metadata` carries no place name, so a day is
 * never labelled from where it happened.
 *
 * TODO: only a day that /events grouped into an event can be named, because
 * `event_labels` is keyed by the event's start timestamp. A day-keyed label
 * (`POST /library/days/{YYYY-MM-DD}/label`) would let any day take a name.
 */
export function useDayLabels(enabled = true) {
  const { data } = useQuery<Map<string, DayLabel>>({
    queryKey: ["kx-day-labels"],
    queryFn: async () => {
      const response = await fetch(`${BACKEND}/events`);
      if (!response.ok) return new Map<string, DayLabel>();
      const body: { events?: EventRow[] } = await response.json();
      const labels = new Map<string, DayLabel>();
      for (const event of body.events ?? []) {
        const key = dayKeyOf(event.start_date);
        const eventKey = event.event_key || event.start_date;
        if (!key || !eventKey) continue;
        // Only a name somebody gave counts as a label. `name` is the date
        // restated, which the header already says. An entry with a null label
        // still carries the key, which is what makes the day nameable.
        labels.set(key, {
          label: event.custom_name ?? null,
          source: event.custom_name ? "member" : null,
          eventKey,
        });
      }
      return labels;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => data ?? new Map<string, DayLabel>(), [data]);
}

/** Names a day. Admin-only on the backend, so the affordance is too. */
export function useNameDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventKey, name }: { eventKey: string; name: string }) => {
      const response = await fetch(`${BACKEND}/events/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_key: eventKey, name }),
      });
      if (!response.ok) throw new Error("That name could not be saved.");
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kx-day-labels"] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

/** The provenance chip's words, and the title that explains them. */
export const PROVENANCE = {
  member: {
    text: "named by a member",
    title: "Event label — named by a member; falls back to the reverse-geocoded place from EXIF GPS",
  },
  location: {
    text: "from location",
    title: "Event label — reverse-geocoded from EXIF GPS when no member has named the day",
  },
} as const;
