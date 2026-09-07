"use client";

import React from "react";

/**
 * The redesign's icon set. Every glyph is a 24×24 stroked outline with round
 * caps and joins on `currentColor`, matching the paths the old topbar already
 * shipped — the "ways in" nav reuses those verbatim.
 */

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function Stroke({
  size = 18,
  strokeWidth = 1.8,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Renders one of the repo's space-separated path strings (the format the old
 * `topbar.tsx` nav icons use, where each sub-path starts at " M").
 */
export function NavIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <Stroke size={size}>
      {d.split(" M").map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </Stroke>
  );
}

/**
 * LIBRARY nav glyphs, in the same space-separated multi-path format `NavIcon`
 * already takes for the WAYS IN rows — so both sidebar groups draw their icons
 * through one renderer and inherit the same 24×24 / 1.8 stroke / round-cap
 * house style. Circles and ellipses are written as arc pairs rather than
 * <circle>/<ellipse> because that format carries paths only.
 *
 * The handoff gave LIBRARY rows no icon; these exist because a collapsed rail
 * has nothing else to show, and there the glyph is the row's only label.
 */
export const LIBRARY_ICON_PATHS = {
  /* Photo frame with a horizon and a sun — the library, whole. */
  allPhotos:
    "M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z M3 16.4l4.6-4.6 3.4 3.4 3.2-3.2L21 18 M10.2 9.4a1.6 1.6 0 1 1 -3.2 0 1.6 1.6 0 1 1 3.2 0z",
  /* One person. The group glyph is already spoken for by WAYS IN → Together. */
  people:
    "M20 20.5v-1.2a5.3 5.3 0 00-5.3-5.3H9.3A5.3 5.3 0 004 19.3v1.2 M15.6 7.4a3.6 3.6 0 1 1 -7.2 0 3.6 3.6 0 1 1 7.2 0z",
  /* Paw print: four toes over a pad. */
  animals:
    "M8.1 11a1.6 2 0 1 1 -3.2 0 1.6 2 0 1 1 3.2 0z M11.5 7.6a1.7 2.1 0 1 1 -3.4 0 1.7 2.1 0 1 1 3.4 0z M15.9 7.6a1.7 2.1 0 1 1 -3.4 0 1.7 2.1 0 1 1 3.4 0z M19.1 11a1.6 2 0 1 1 -3.2 0 1.6 2 0 1 1 3.2 0z M12 12.4c2.6 0 4.6 2 4.6 4.4 0 1.9-1.4 3.2-3.2 3.2-.6 0-1-.2-1.4-.2s-.8.2-1.4.2c-1.8 0-3.2-1.3-3.2-3.2 0-2.4 2-4.4 4.6-4.4z",
  /* Car in profile: cabin, waistline, two wheels. */
  vehicles:
    "M3.5 16.2v-3l1.9-4.7A2 2 0 017.3 7.2h9.4a2 2 0 011.9 1.3l1.9 4.7v3 M3.5 13.2h17 M8 16.2a2 2 0 1 1 -4 0 2 2 0 1 1 4 0z M20 16.2a2 2 0 1 1 -4 0 2 2 0 1 1 4 0z",
  /* Screen with a play triangle — deliberately unlike the photo frame above. */
  videos:
    "M4 5h16a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0120 19H4a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 014 5z M10.2 9.1l5.2 2.9-5.2 2.9z",
  /* Clock — the same library, in the order it happened. */
  timeline: "M21 12a9 9 0 1 1 -18 0 9 9 0 1 1 18 0z M12 7.1V12l3.3 2",
  /* Map pin. */
  locations:
    "M20 10.4c0 5.4-8 11.8-8 11.8s-8-6.4-8-11.8a8 8 0 1 1 16 0z M15 10.2a3 3 0 1 1 -6 0 3 3 0 1 1 6 0z",
  /* Three nodes joined — something handed on to someone else. */
  shared:
    "M15.9 6.4l-8.4 4.2 M7.5 13.4l8.4 4.2 M21 5.2a2.7 2.7 0 1 1 -5.4 0 2.7 2.7 0 1 1 5.4 0z M7.7 12a2.7 2.7 0 1 1 -5.4 0 2.7 2.7 0 1 1 5.4 0z M21 18.8a2.7 2.7 0 1 1 -5.4 0 2.7 2.7 0 1 1 5.4 0z",
  /* The outline `HeartIcon` draws, so the rail and the photo tiles agree. */
  favorites:
    "M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 000-7.8z",
} as const;

export const SearchIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </Stroke>
);

/** Four squares — steps the mosaic down to smaller tiles. */
export const ZoomOutIcon = (p: IconProps) => (
  <Stroke size={16} {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </Stroke>
);

/** One square — steps the mosaic up to bigger tiles. */
export const ZoomInIcon = (p: IconProps) => (
  <Stroke size={16} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </Stroke>
);

export const CloseIcon = (p: IconProps) => (
  <Stroke size={15} strokeWidth={2} {...p}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Stroke>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Stroke strokeWidth={2} {...p}>
    <polyline points="15 18 9 12 15 6" />
  </Stroke>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Stroke strokeWidth={2} {...p}>
    <polyline points="9 18 15 12 9 6" />
  </Stroke>
);

export const MenuIcon = (p: IconProps) => (
  <Stroke strokeWidth={2} {...p}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </Stroke>
);

/**
 * The rail toggle's glyph: the shell seen from above — a panel with its left
 * column marked — plus a chevron pointing the way the rail will move.
 */
export const SidebarIcon = ({ direction = "left", ...p }: IconProps & { direction?: "left" | "right" }) => (
  <Stroke size={16} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
    {direction === "left" ? (
      <polyline points="16.5 9.5 14 12 16.5 14.5" />
    ) : (
      <polyline points="14 9.5 16.5 12 14 14.5" />
    )}
  </Stroke>
);

export const UploadIcon = (p: IconProps) => (
  <Stroke strokeWidth={1.5} {...p}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </Stroke>
);

export const PersonIcon = (p: IconProps) => (
  <Stroke size={16} strokeWidth={2} {...p}>
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Stroke>
);

export const DocsIcon = (p: IconProps) => (
  <Stroke size={16} strokeWidth={2} {...p}>
    <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
    <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
  </Stroke>
);

export const QrIcon = (p: IconProps) => (
  <Stroke size={16} strokeWidth={2} {...p}>
    <rect x="2" y="2" width="8" height="8" rx="1" />
    <rect x="14" y="2" width="8" height="8" rx="1" />
    <rect x="2" y="14" width="8" height="8" rx="1" />
    <rect x="14" y="14" width="4" height="4" />
    <line x1="22" y1="14" x2="22" y2="18" />
    <line x1="18" y1="22" x2="22" y2="22" />
  </Stroke>
);

export const EyeIcon = (p: IconProps) => (
  <Stroke size={16} strokeWidth={2} {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Stroke>
);

export const SignOutIcon = (p: IconProps) => (
  <Stroke size={16} strokeWidth={2} {...p}>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </Stroke>
);

export const VolumeIcon = (p: IconProps) => (
  <Stroke size={17} {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 010 7.07" />
  </Stroke>
);

export const FullscreenIcon = (p: IconProps) => (
  <Stroke size={17} {...p}>
    <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
  </Stroke>
);

/** The error banner's glyph — always drawn in `--danger-ink`. */
export const AlertIcon = (p: IconProps) => (
  <Stroke size={18} {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </Stroke>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Stroke size={11} strokeWidth={2.5} {...p}>
    <polyline points="6 9 12 15 18 9" />
  </Stroke>
);

export const PinIcon = (p: IconProps) => (
  <Stroke size={16} {...p}>
    <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </Stroke>
);

export const PlusIcon = (p: IconProps) => (
  <Stroke size={13} strokeWidth={2} {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Stroke>
);

/**
 * The favourite heart. It is the one glyph that fills: an empty outline until
 * the member favourites the photo, solid accent after.
 */
export function HeartIcon({ size = 15, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 000-7.8z" />
    </svg>
  );
}

/** Solid play triangle — the only filled glyph in the set. */
export function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6 3 20 12 6 21" />
    </svg>
  );
}

export function SunIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />
    </svg>
  );
}
