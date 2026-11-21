"use client";

import { CloseIcon } from "./icons";

export function ClearSearchButton({ onClear }: { onClear: () => void }) {
  return (
    <button type="button" className="kx-clear-search" aria-label="Clear search" title="Clear search" onClick={onClear}>
      <CloseIcon size={16} />
    </button>
  );
}
