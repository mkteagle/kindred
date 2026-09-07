"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "./icons";

export type DateField = "taken" | "added";

export interface DateRange {
  field: DateField;
  from: string;
  to: string;
}

const RANGE_LABEL = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });

function part(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : RANGE_LABEL.format(date);
}

/** "Taken · Jun 2026 – Aug 2026", or just the word when nothing is set. */
export function rangeChipLabel(range: DateRange): string {
  const field = range.field === "added" ? "Added" : "Taken";
  const span = [range.from, range.to].filter(Boolean).map(part).join(" – ");
  return span ? `${field} · ${span}` : field;
}

/**
 * The date facet: which date, and what range of it.
 *
 * The distinction earns its own control because an import lands tens of
 * thousands of files on a single day. Filtering a bulk-imported library by
 * "added" returns one afternoon; by "taken" it returns the decade the photos
 * actually cover. Maps to /search's `date_field`, `date_from` and `date_to`.
 */
export function KxDateFacet({
  value,
  onApply,
  onClear,
}: {
  value: DateRange;
  onApply: (range: DateRange) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const anchor = useRef<HTMLDivElement>(null);

  // Reopening after an Apply elsewhere should show what is actually in force.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const active = Boolean(value.from || value.to);

  return (
    <div className="kx-menu-anchor" ref={anchor}>
      <button
        className={`kx-chip withface ${active || open ? "is-active" : ""}`.trim()}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {rangeChipLabel(value)}
        <ChevronDownIcon />
      </button>

      {open && (
        <div className="kx-datepop">
          <span className="kx-eyebrow quiet">Which date</span>

          <div className="kx-segmented" role="radiogroup" aria-label="Which date">
            {(["taken", "added"] as DateField[]).map((field) => (
              <button
                key={field}
                role="radio"
                aria-checked={draft.field === field}
                className={draft.field === field ? "is-active" : ""}
                onClick={() => setDraft({ ...draft, field })}
              >
                {field === "taken" ? "Taken" : "Added"}
              </button>
            ))}
          </div>

          <p className="kx-datepop-note">
            An import lands thousands of files on one day. <strong>Taken</strong> is when the photo
            happened; <strong>Added</strong> is when it arrived here.
          </p>

          <div className="kx-datepop-fields">
            <label>
              <span className="kx-eyebrow quiet">From</span>
              <input
                type="date"
                value={draft.from}
                max={draft.to || undefined}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
            </label>
            <label>
              <span className="kx-eyebrow quiet">To</span>
              <input
                type="date"
                value={draft.to}
                min={draft.from || undefined}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              />
            </label>
          </div>

          <div className="kx-datepop-actions">
            <button
              className="kx-button primary"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              Apply
            </button>
            <button
              className="kx-button"
              onClick={() => {
                setDraft({ field: "taken", from: "", to: "" });
                onClear();
                setOpen(false);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
