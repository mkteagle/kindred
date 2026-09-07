// Window 4 — Settings. 900×620.
//
// A 200px rail beside one pane. Local cache is the pane the design draws in
// full and the one that carries real behaviour; Server is where the household
// address and key are entered, which is the only reason this app knows how to
// reach anything.

import { useCallback, useEffect, useState } from "react";
import { Button, Eyebrow, Kbd, TitleBar, Toggle } from "../desktop/Chrome";
import { ServerBanner } from "../desktop/Rails";
import { desktop, type CachePrefs, type CacheStats, type ServerStatus } from "../lib/desktop";
import { api, type SettingsView } from "../lib/tauri";
import { formatBytes } from "../lib/format";
import { forgetAllMedia } from "../lib/media";

type PaneId = "general" | "household" | "cache" | "server" | "notifications" | "shortcuts" | "about";

const PANES: { id: PaneId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "household", label: "Household" },
  { id: "cache", label: "Local cache" },
  { id: "server", label: "Server" },
  { id: "notifications", label: "Notifications" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "about", label: "About" },
];

export function SettingsWindow({ params }: { params: { pane?: PaneId } }) {
  const [pane, setPane] = useState<PaneId>(params.pane ?? "cache");
  const [status, setStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    const read = () => desktop.serverStatus().then(setStatus).catch(() => {});
    read();
    const timer = window.setInterval(read, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="k-root">
      <TitleBar title="Kindred — Settings" />
      <div className="k-body">
        <nav
          aria-label="Settings"
          style={{
            width: 200,
            flex: "none",
            borderRight: "1px solid var(--k-line)",
            padding: "14px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <span className="k-eyebrow" style={{ padding: "0 8px 7px" }}>
            Settings
          </span>
          {PANES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="k-row"
              aria-current={pane === entry.id}
              onClick={() => setPane(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div
          className="k-scroll"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            padding: "20px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {pane === "cache" ? <CachePane status={status} /> : null}
          {pane === "server" ? <ServerPane status={status} onChanged={setStatus} /> : null}
          {pane === "shortcuts" ? <ShortcutsPane /> : null}
          {pane === "about" ? <AboutPane /> : null}
          {pane === "general" || pane === "household" || pane === "notifications" ? (
            <NotYetPane pane={pane} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PaneHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        className="k-display"
        style={{ margin: "9px 0 6px", fontSize: 24, fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--k-ink-3)", maxWidth: "56ch" }}>
        {body}
      </p>
    </div>
  );
}

/* ── Local cache ──────────────────────────────────────────────────────── */

function CachePane({ status }: { status: ServerStatus | null }) {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [prefs, setPrefs] = useState<CachePrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryIn, setRetryIn] = useState<number | null>(null);

  const refresh = useCallback(() => {
    desktop.cacheStats().then(setStats).catch(() => {});
    desktop.cachePrefs().then(setPrefs).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!status || status.reachable) {
      setRetryIn(null);
      return;
    }
    setRetryIn(30);
    const timer = window.setInterval(
      () => setRetryIn((s) => (s === null ? null : s <= 1 ? 30 : s - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  const update = async (patch: Partial<CachePrefs>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      setStats(await desktop.setCachePrefs(next));
    } catch {
      refresh();
    }
  };

  const used = stats?.used_bytes ?? 0;
  const limit = stats?.limit_bytes ?? 1;
  const segment = (bytes: number) => `${Math.min(100, (bytes / limit) * 100)}%`;

  return (
    <>
      <PaneHeader
        eyebrow="Local cache"
        title="Keep some of it on this Mac."
        body="Originals stay on your server. The desktop app keeps a working set so browsing stays instant on a plane."
      />

      <div
        className="k-card"
        style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <strong style={{ fontSize: 14, fontWeight: 700 }}>{formatBytes(used)} used</strong>
          <span className="k-mono-11">
            of {formatBytes(limit)} allowance · {stats?.entries.toLocaleString() ?? "—"} files
          </span>
          <span style={{ marginLeft: "auto" }}>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await desktop.clearCache();
                  // The in-memory map still points at files that are gone.
                  forgetAllMedia();
                  refresh();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Clear cache
            </Button>
          </span>
        </span>
        <span
          style={{
            height: 8,
            borderRadius: 999,
            background: "rgba(241,241,236,.1)",
            overflow: "hidden",
            display: "flex",
          }}
        >
          <span style={{ width: segment(stats?.favorites_bytes ?? 0), background: "var(--k-terracotta)" }} />
          <span style={{ width: segment(stats?.recent_bytes ?? 0), background: "var(--k-amber)" }} />
          <span style={{ width: segment(stats?.shared_bytes ?? 0), background: "var(--k-sage)" }} />
          <span style={{ width: segment(stats?.evictable_bytes ?? 0), background: "var(--k-fill-4)" }} />
        </span>
        <span style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span className="k-mono" style={{ color: "var(--k-terracotta)" }}>
            ■ Favorites {formatBytes(stats?.favorites_bytes ?? 0)}
          </span>
          <span className="k-mono" style={{ color: "var(--k-amber)" }}>
            ■ Recent {prefs?.keep_recent_days ?? 90} days {formatBytes(stats?.recent_bytes ?? 0)}
          </span>
          <span className="k-mono" style={{ color: "var(--k-sage-ink)" }}>
            ■ Shared {formatBytes(stats?.shared_bytes ?? 0)}
          </span>
          <span className="k-mono">■ Browsed {formatBytes(stats?.evictable_bytes ?? 0)}</span>
        </span>
      </div>

      <div className="k-card" style={{ overflow: "hidden", padding: 0 }}>
        <ToggleRow
          label="Keep favorites offline"
          hint="Always, at full resolution"
          checked={prefs?.keep_favorites ?? false}
          onChange={(v) => void update({ keep_favorites: v })}
        />
        <ToggleRow
          label={`Keep last ${prefs?.keep_recent_days ?? 90} days`}
          hint="Downscaled to 2048px"
          checked={prefs?.keep_recent ?? false}
          onChange={(v) => void update({ keep_recent: v })}
        />
        <ToggleRow
          label="Download on Wi-Fi only"
          checked={prefs?.wifi_only ?? false}
          onChange={(v) => void update({ wifi_only: v })}
        />
        <ToggleRow
          label="Pause syncing while on battery"
          checked={prefs?.pause_on_battery ?? false}
          onChange={(v) => void update({ pause_on_battery: v })}
          last
        />
      </div>

      <p className="k-mono" style={{ lineHeight: 1.7 }}>
        Cached files live in {stats?.root ?? "the app data folder"}. Browsed photos are evicted
        least-recently-used first once the allowance is reached; favourites, recent and shared
        photos are never evicted.
        {/* TODO: the "keep favorites offline" and "keep last N days" toggles are
            stored and honoured by eviction (those entries are pinned and never
            dropped), but nothing pre-downloads them in the background yet. That
            wants a Rust warm-up task walking /favorites and /library/photos with
            a date range — no new endpoint needed. */}
      </p>

      {status && !status.reachable ? (
        <ServerBanner
          status={status}
          retryInSeconds={retryIn}
          onRetry={() => void desktop.pingServer()}
        />
      ) : null}
    </>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  last,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 16px",
        borderBottom: last ? "none" : "1px solid rgba(241,241,236,.07)",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        {hint ? <span className="k-mono">{hint}</span> : null}
      </span>
      <span style={{ marginLeft: "auto" }}>
        <Toggle checked={checked} onChange={onChange} label={label} />
      </span>
    </div>
  );
}

/* ── Server ───────────────────────────────────────────────────────────── */

/**
 * Where the household address is entered.
 *
 * There is no fixed host: every household runs its own server, so the app is
 * useless until this is filled in. It reuses the uploader's stored settings, so
 * pairing once serves both.
 *
 * TODO: pair by code the way iOS does. `POST /public/pairing/claim` takes a
 * one-time code and hands back a key, which would replace this form with
 * "type the six characters on your phone".
 */
function ServerPane({
  status,
  onChanged,
}: {
  status: ServerStatus | null;
  onChanged: (status: ServerStatus) => void;
}) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setBaseUrl(s.base_url ?? "");
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.setSettings({
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      const next = await desktop.pingServer();
      onChanged(next);
      setMessage(next.reachable ? "Connected." : `Saved, but not reachable: ${next.last_error}`);
      setApiKey("");
      setSettings(await api.getSettings());
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PaneHeader
        eyebrow="Server"
        title="Your household's own server."
        body="Kindred does not run in the cloud. Point this Mac at the machine your library lives on."
      />
      <div className="k-card" style={{ padding: 16, display: "grid", gap: 12, maxWidth: 520 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="k-eyebrow-quiet">Server address</span>
          <input
            className="k-input"
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: "var(--k-radius)",
              background: "var(--k-fill)",
              border: "1px solid var(--k-line-2)",
            }}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://kindred.local:8000"
            spellCheck={false}
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="k-eyebrow-quiet">
            API key {settings?.api_key_set ? "(one is stored — leave blank to keep it)" : ""}
          </span>
          <input
            className="k-input"
            type="password"
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: "var(--k-radius)",
              background: "var(--k-fill)",
              border: "1px solid var(--k-line-2)",
            }}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="knd_…"
            spellCheck={false}
          />
        </label>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !baseUrl.trim()}>
            Save and connect
          </Button>
          <span className="k-mono">
            {status?.reachable ? "Reachable" : status?.configured ? "Not answering" : "Not paired"}
          </span>
        </span>
        {message ? (
          <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--k-ink-3)" }}>
            {message}
          </p>
        ) : null}
      </div>
    </>
  );
}

/* ── Shortcuts ────────────────────────────────────────────────────────── */

const SHORTCUTS: { keys: string[]; label: string; where: string }[] = [
  { keys: ["⌘", "K"], label: "Search", where: "Menu" },
  { keys: ["⌘", "A"], label: "Select all", where: "Menu" },
  { keys: ["⇧", "click"], label: "Select a range", where: "Grid" },
  { keys: ["Space"], label: "Quick look", where: "Grid" },
  { keys: ["←", "→"], label: "Step", where: "Viewer" },
  { keys: ["F"], label: "Full screen", where: "Viewer" },
  { keys: ["⌘", "⇧", "N"], label: "New window", where: "Menu" },
  { keys: ["⌘", "⌫"], label: "Remove from library", where: "Menu" },
  { keys: ["↵"], label: "Save name", where: "Review" },
  { keys: ["M"], label: "Merge", where: "Review" },
  { keys: ["S"], label: "Skip", where: "Review" },
  { keys: ["X"], label: "Not a person", where: "Review" },
  { keys: ["⌘", ","], label: "Settings", where: "Menu" },
  { keys: ["⌘", "R"], label: "Sync now", where: "Menu" },
];

function ShortcutsPane() {
  return (
    <>
      <PaneHeader
        eyebrow="Shortcuts"
        title="Everything without the mouse."
        body="Shortcuts with ⌘ are menu accelerators and work whatever has focus. Single keys are contextual, so they never steal a letter from a text field."
      />
      <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
        {SHORTCUTS.map((shortcut, index) => (
          <div
            key={shortcut.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 16px",
              borderBottom:
                index === SHORTCUTS.length - 1 ? "none" : "1px solid rgba(241,241,236,.07)",
            }}
          >
            <span style={{ display: "flex", gap: 4, width: 110 }}>
              {shortcut.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
            <span style={{ fontSize: 13 }}>{shortcut.label}</span>
            <span className="k-mono" style={{ marginLeft: "auto" }}>
              {shortcut.where}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── About ────────────────────────────────────────────────────────────── */

function AboutPane() {
  const [version, setVersion] = useState("");
  const [stats, setStats] = useState<CacheStats | null>(null);
  useEffect(() => {
    desktop.appVersion().then(setVersion).catch(() => {});
    desktop.cacheStats().then(setStats).catch(() => {});
  }, []);
  return (
    <>
      <PaneHeader
        eyebrow="About"
        title="Kindred for desktop."
        body="A Rust and Tauri app that talks to your household's own server. Nothing leaves the house."
      />
      <div className="k-card" style={{ padding: 16, display: "grid", gap: 8 }}>
        <span className="k-mono-11">Version {version || "…"} · rust + tauri</span>
        <span className="k-mono-11">Cache {stats?.root ?? "…"}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={() => void desktop.openWindow("uploader")}>Open the bulk uploader</Button>
      </div>
    </>
  );
}

function NotYetPane({ pane }: { pane: PaneId }) {
  const copy: Record<string, { title: string; body: string }> = {
    general: {
      title: "General",
      body: "Window behaviour and startup live here. Nothing in this pane needs the server, so it is the next one to build out.",
    },
    household: {
      title: "Household",
      body: "Members and invites come from /users and /invites — both exist. TODO: wire the member list and the invite flow.",
    },
    notifications: {
      title: "Notifications",
      body: "/notifications and /notifications/read exist. TODO: a native notification when an upload finishes or a new face group appears.",
    },
  };
  const entry = copy[pane];
  return <PaneHeader eyebrow={entry.title} title={entry.title} body={entry.body} />;
}
