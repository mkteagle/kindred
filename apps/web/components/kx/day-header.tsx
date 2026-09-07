"use client";

import { useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/constants";
import { useUser } from "@/lib/use-user";
import { PROVENANCE, useNameDay, type DayLabel } from "./day-labels";

/**
 * A day section's header. Always the date and the count; a label only when one
 * exists, and never without saying where it came from — a name a member typed
 * and a place a machine guessed are different claims and should not look alike.
 *
 * With neither, the header offers to take a name rather than inventing one.
 */
export function KxDayHeader({
  label,
  count,
  day,
  allSelected,
  onSelectDay,
  headerRef,
  year,
}: {
  /** "Saturday, 14 June". */
  label: string;
  count: number;
  /** The day's event label, if it has one. */
  day: DayLabel | null;
  allSelected: boolean;
  onSelectDay: () => void;
  headerRef: (node: HTMLDivElement | null) => void;
  year: number;
}) {
  const { isAdmin } = useUser();
  const nameDay = useNameDay();
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  const provenance = day?.source ? PROVENANCE[day.source] : null;
  const meta = `${day?.label ? `${day.label} · ` : ""}${fmt.format(count)} ${count === 1 ? "photo" : "photos"}`;

  const save = () => {
    const name = draft.trim();
    if (!name || !day?.eventKey) {
      setNaming(false);
      return;
    }
    nameDay.mutate({ eventKey: day.eventKey, name });
    setNaming(false);
  };

  return (
    <div className="kx-dayhead" ref={headerRef} data-year={year}>
      <h2>{label}</h2>
      <span className="kx-mono">{meta}</span>

      {provenance && (
        <span className="kx-provenance" title={provenance.title}>
          {provenance.text}
        </span>
      )}

      {/* Only offered where it can actually be honoured: naming a day writes an
          event label, which needs the day to have an event key and the member
          to be an admin. */}
      {!day?.label && day?.eventKey && isAdmin && !naming && (
        <button className="kx-nameday" onClick={() => setNaming(true)}>
          + Name this day
        </button>
      )}

      {naming && (
        <input
          ref={inputRef}
          className="kx-nameday-input"
          value={draft}
          placeholder="Name this day"
          aria-label="Name this day"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") {
              event.stopPropagation();
              setDraft("");
              setNaming(false);
            }
          }}
        />
      )}

      <button className="kx-selectday" data-selectday onClick={onSelectDay}>
        {allSelected ? "Deselect" : "Select all"} {fmt.format(count)}
      </button>
    </div>
  );
}
