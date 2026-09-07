// Shared chrome for the four library windows: the title bar, the small
// primitives every window uses, and the icon set.
//
// Icons are the web app's own 24×24 strokes at 1.8–1.9 weight with round caps,
// drawn inline rather than pulled from a font so they inherit `currentColor`
// and stay crisp at the sizes the design uses.

import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SVGProps,
} from "react";
import { desktop } from "../lib/desktop";

/* ── Title bar ────────────────────────────────────────────────────────── */

/**
 * 40px, centred mono title, mono build tag right.
 *
 * The window's own traffic lights are the real ones — Tauri draws native
 * decorations — so this leaves a 68px gutter for them rather than painting
 * fake ones the way the prototype does. `-webkit-app-region: drag` (in
 * styles.css) makes the strip itself move the window.
 */
export function TitleBar({ title, children }: { title: string; children?: ReactNode }) {
  const version = useAppVersion();
  return (
    // `data-tauri-drag-region` is what actually moves the window: WKWebView
    // does not implement `-webkit-app-region`, so the CSS in styles.css is only
    // a hint for the platforms that do. Tauri's shim fires on the element
    // carrying the attribute, never on a descendant, so the controls inside
    // stay clickable.
    <header className="k-title-bar" data-tauri-drag-region>
      <span className="k-title-bar-lights" aria-hidden="true" data-tauri-drag-region />
      <h1 className="k-title-bar-title" data-tauri-drag-region>
        {title}
      </h1>
      {children}
      <span className="k-title-bar-build" data-tauri-drag-region>
        {version} · rust + tauri
      </span>
    </header>
  );
}

function useAppVersion() {
  const [version, setVersion] = useState("v0.9");
  useEffect(() => {
    desktop
      .appVersion()
      .then((v) => setVersion(`v${v.split(".").slice(0, 2).join(".")}`))
      .catch(() => {});
  }, []);
  return version;
}

/* ── Text ─────────────────────────────────────────────────────────────── */

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="k-eyebrow">{children}</span>;
}

export function QuietEyebrow({ children }: { children: ReactNode }) {
  return <span className="k-eyebrow-quiet">{children}</span>;
}

export function Mono({ children, size = 10 }: { children: ReactNode; size?: 10 | 11 }) {
  return <span className={size === 11 ? "k-mono-11" : "k-mono"}>{children}</span>;
}

/* ── Keyboard chip ────────────────────────────────────────────────────── */

/** The 18px mono chip the design uses to show a shortcut in place. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="k-kbd">{children}</kbd>;
}

/** "⌘A select all" — a chip and its meaning, as the status bar legend uses. */
export function KbdHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span className="k-mono">{label}</span>
    </span>
  );
}

/* ── Buttons ──────────────────────────────────────────────────────────── */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "quiet";
};

export function Button({ variant = "default", className, ...props }: ButtonProps) {
  const variants = {
    default: "k-btn",
    primary: "k-btn k-btn-primary",
    danger: "k-btn k-btn-danger",
    quiet: "k-btn k-btn-quiet",
  };
  return <button type="button" {...props} className={[variants[variant], className].filter(Boolean).join(" ")} />;
}

/* ── Toggle ───────────────────────────────────────────────────────────── */

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="k-toggle"
      onClick={() => onChange(!checked)}
    />
  );
}

/* ── Brand ────────────────────────────────────────────────────────────── */

/**
 * The reversed lockup for dark chrome. Never recoloured, and never on a
 * background plate — the handoff is explicit about both.
 */
export function Lockup() {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 9, padding: "2px 6px" }}>
      <img src="/logo-light.svg" alt="" style={{ width: 17, height: 19 }} />
      <img src="/wordmark-light.svg" alt="Kindred" style={{ height: 16 }} />
    </span>
  );
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, var(--k-forest), var(--k-terracotta))",
        fontSize: size * 0.43,
        fontWeight: 700,
        color: "#f4f3ee",
        flex: "none",
      }}
    >
      {initial}
    </span>
  );
}

/* ── Icons ────────────────────────────────────────────────────────────── */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </Icon>
);

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 5.5v13l11-6.5z" />
  </Icon>
);

export const HeartIcon = ({ filled, ...props }: IconProps & { filled?: boolean }) => (
  <Icon {...props} fill={filled ? "currentColor" : "none"}>
    <path d="M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 15.6 12 20 12 20z" />
  </Icon>
);

export const ChevronLeft = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const ChevronRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

export const CloudOffIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 4l16 16" />
    <path d="M18.4 15.5A3.5 3.5 0 0 0 17 9h-1.3A6 6 0 0 0 7.5 6.2" />
    <path d="M5.6 8.6A4.5 4.5 0 0 0 7 17.5h9" />
  </Icon>
);
