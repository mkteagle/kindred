"use client";

import { useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/constants";
import { ChevronDownIcon } from "./icons";
import { useNamedPeople } from "./use-people";

/**
 * The "With Junie" chip and its popover. Same facet as search's Who filter,
 * drawn as faces rather than a select — a household recognises the people in
 * its own photos faster than it reads their names.
 *
 * Multi-select: picking two people means photos with both, which is the same
 * question /together answers.
 */
export function KxPeoplePicker({
  selected,
  onChange,
  label = "Who is in it",
}: {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  label?: string;
}) {
  const { data: people } = useNamedPeople();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

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

  const chosen = (people ?? []).filter((person) => selected.has(person.id));

  // One name reads as a name; more than one reads as a count.
  const chipLabel =
    chosen.length === 0
      ? "With someone"
      : chosen.length === 1
        ? `With ${chosen[0].label}`
        : `With ${fmt.format(chosen.length)} people`;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="kx-menu-anchor" ref={anchor}>
      <button
        className={`kx-chip withface ${chosen.length ? "is-active" : ""}`.trim()}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {chosen.length === 1 && chosen[0].avatar && (
          <img src={chosen[0].avatar} alt="" className="kx-chip-avatar" />
        )}
        {chipLabel}
        <ChevronDownIcon />
      </button>

      {open && (
        <div className="kx-menu picker" role="menu">
          <span className="kx-eyebrow quiet" style={{ padding: "8px 10px 6px" }}>
            {label}
          </span>
          {(people ?? []).length === 0 && (
            <span className="kx-menu-note">Nobody has a name yet. Name someone on People.</span>
          )}
          {(people ?? []).map((person) => {
            const on = selected.has(person.id);
            return (
              <button
                key={person.id}
                className={`kx-menu-item ${on ? "is-on" : ""}`.trim()}
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => toggle(person.id)}
              >
                {person.avatar ? (
                  <img src={person.avatar} alt="" className="kx-chip-avatar lg" />
                ) : (
                  <span className="kx-chip-avatar lg blank" aria-hidden="true" />
                )}
                <span>{person.label}</span>
                <span className="kx-navcount">{on ? "✓" : ""}</span>
              </button>
            );
          })}
          {chosen.length > 0 && (
            <button className="kx-menu-item" onClick={() => onChange(new Set())}>
              <span>Clear</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
