// The selection model.
//
// Selection lives above the virtualiser and is keyed by photo id, never by
// index: a tile that scrolls out of the DOM must stay selected, and a page of
// older months arriving must not renumber what is already chosen. Each window
// owns its own — that is what "each window keeps its own selection" means.

import { useCallback, useRef, useState } from "react";

export type Selection = {
  selected: ReadonlySet<string>;
  /** The last id clicked without shift — where a ⇧ range measures from. */
  anchor: string | null;
  count: number;
  isSelected: (id: string) => boolean;
  /** A plain click: this one and nothing else. */
  selectOnly: (id: string) => void;
  /** ⌘/Ctrl click. */
  toggle: (id: string) => void;
  /** ⇧ click: everything between the anchor and this, in the order given. */
  selectRange: (id: string, ordered: string[]) => void;
  selectAll: (ids: string[]) => void;
  addAll: (ids: string[]) => void;
  clear: () => void;
};

export function useSelection(): Selection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);

  const setAnchorBoth = useCallback((id: string | null) => {
    anchorRef.current = id;
    setAnchor(id);
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const selectOnly = useCallback(
    (id: string) => {
      setSelected(new Set([id]));
      setAnchorBoth(id);
    },
    [setAnchorBoth],
  );

  const toggle = useCallback(
    (id: string) => {
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchorBoth(id);
    },
    [setAnchorBoth],
  );

  const selectRange = useCallback(
    (id: string, ordered: string[]) => {
      const from = anchorRef.current;
      if (!from) {
        setSelected(new Set([id]));
        setAnchorBoth(id);
        return;
      }
      const start = ordered.indexOf(from);
      const end = ordered.indexOf(id);
      if (start < 0 || end < 0) {
        // The anchor has scrolled out of the loaded range; fall back to a
        // plain click rather than selecting something arbitrary.
        setSelected(new Set([id]));
        setAnchorBoth(id);
        return;
      }
      const [low, high] = start <= end ? [start, end] : [end, start];
      setSelected(new Set(ordered.slice(low, high + 1)));
      // The anchor deliberately stays put, so a second ⇧ click re-measures
      // from the same place instead of walking.
    },
    [setAnchorBoth],
  );

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  const addAll = useCallback((ids: string[]) => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchorBoth(null);
  }, [setAnchorBoth]);

  return {
    selected,
    anchor,
    count: selected.size,
    isSelected,
    selectOnly,
    toggle,
    selectRange,
    selectAll,
    addAll,
    clear,
  };
}
