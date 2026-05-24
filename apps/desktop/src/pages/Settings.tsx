import { useEffect, useState } from "react";
import { api, type SettingsView } from "../lib/tauri";
import { useAppState } from "../lib/appState";
import { Alert } from "../components/Primitives";
import { PageHeader } from "../components/PageHeader";

type Tab = "connection" | "behavior" | "advanced";

export function SettingsPage({ onSignedOut }: { onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>("connection");
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Connection, behavior, and the occasional escape hatch."
      />
      <div className="px-7 py-6 max-w-[1040px]">
        {/* Tab bar */}
        <div
          className="flex gap-1 mb-5"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          {(["connection", "behavior", "advanced"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-2.5"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: tab === t ? 700 : 600,
                fontSize: 12.5,
                color: tab === t ? "var(--color-ember)" : "var(--color-pine)",
                borderBottom: tab === t ? "2px solid var(--color-ember)" : "2px solid transparent",
                marginBottom: -1,
                background: "transparent",
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "connection" && <ConnectionTab onSignedOut={onSignedOut} />}
        {tab === "behavior" && <BehaviorTab />}
        {tab === "advanced" && <AdvancedTab />}
      </div>
    </div>
  );
}

function ConnectionTab({ onSignedOut }: { onSignedOut: () => void }) {
  const [s, setS] = useState<SettingsView | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [concurrency, setConcurrency] = useState(3);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "ok" | "fail" | "running"; msg?: string }>({ state: "idle" });

  useEffect(() => {
    (async () => {
      const v = await api.getSettings();
      setS(v);
      setBaseUrl(v.base_url ?? "");
      setConcurrency(v.concurrency);
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.setSettings({
        baseUrl: baseUrl.trim(),
        concurrency,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      const v = await api.getSettings();
      setS(v);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTest({ state: "running" });
    try {
      await api.setSettings({
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      const ok = await api.testConnection();
      setTest({ state: ok ? "ok" : "fail" });
    } catch (e) {
      setTest({ state: "fail", msg: String(e) });
    }
  }

  if (!s) return null;

  return (
    <div className="space-y-5 max-w-[640px]">
      <div className="card-pad space-y-4">
        <Field
          label="Backend URL"
          action={
            baseUrl !== "https://api.kindredphotos.app" && (
              <LinkBtn onClick={() => setBaseUrl("https://api.kindredphotos.app")}>
                Use default
              </LinkBtn>
            )
          }
        >
          <input
            type="url"
            className="input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>

        <Field
          label="API key"
          hint={s.api_key_set ? "A key is saved. Enter a new one to replace, or leave blank." : "Paste your knd_ key from Kindred → Settings → API Keys."}
          action={apiKey.length > 0 && (
            <LinkBtn onClick={() => setShowKey((v) => !v)}>
              {showKey ? "Hide" : "Show"}
            </LinkBtn>
          )}
        >
          <input
            type={showKey ? "text" : "password"}
            className="input"
            placeholder={s.api_key_set ? "•••••••••• (saved)" : "knd_..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>

        <Field label="Concurrent uploads">
          <input
            type="number"
            min={1}
            max={10}
            className="input"
            style={{ width: 96 }}
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
          />
        </Field>

        {test.state === "ok" && <Alert tone="ok">Connection successful.</Alert>}
        {test.state === "fail" && <Alert tone="warn">{test.msg ?? "Could not reach the backend."}</Alert>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={runTest} disabled={test.state === "running"} className="btn-secondary">
            {test.state === "running" ? "Testing…" : "Test connection"}
          </button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <div className="card-pad space-y-3">
        <div className="h-eyebrow">Disconnect</div>
        <p style={{ fontSize: 12.5, color: "var(--color-pine)", lineHeight: 1.5 }}>
          Removes the saved API key and returns to onboarding. The local upload queue stays — your
          drive scan isn't lost.
        </p>
        <div>
          <button
            onClick={async () => {
              if (!confirm("Disconnect from Kindred? Your queue stays, but the key is removed.")) return;
              await api.setSettings({ apiKey: "" });
              onSignedOut();
            }}
            className="btn-danger"
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}

function BehaviorTab() {
  return (
    <div className="card-pad space-y-2 max-w-[640px]">
      <div className="h-eyebrow">Behavior</div>
      <p style={{ fontSize: 12.5, color: "var(--color-mist)", lineHeight: 1.5 }}>
        Open at login · Wi-Fi only · Pause when battery low · Throttle while you're working · Notify
        on errors. These toggles need macOS integration (LaunchAgent, IOKit) that hasn't been wired
        up yet — they'll arrive in a follow-up.
      </p>
    </div>
  );
}

function AdvancedTab() {
  const { clearQueue } = useAppState();
  return (
    <div className="space-y-5 max-w-[640px]">
      <div className="card-pad space-y-3">
        <div className="h-eyebrow">Reset queue</div>
        <p style={{ fontSize: 12.5, color: "var(--color-pine)", lineHeight: 1.5 }}>
          Clears every row from the local SQLite queue — pending, done, failed, all of it. Files
          already uploaded to Flickr stay on Flickr. Mostly useful if you want to re-scan a drive
          from scratch.
        </p>
        <div>
          <button onClick={clearQueue} className="btn-danger">
            Clear local queue
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1.5">
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-mist)",
          }}
        >
          {label}
        </span>
        {action}
      </div>
      {children}
      {hint && (
        <div className="mt-1.5" style={{ fontSize: 11.5, color: "var(--color-mist)", lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </label>
  );
}

function LinkBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        fontWeight: 600,
        color: "var(--color-ember)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        background: "transparent",
        border: "none",
      }}
    >
      {children}
    </button>
  );
}
