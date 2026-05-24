import { useEffect, useState } from "react";
import { api, type SettingsView } from "../lib/tauri";
import { Alert, KindredMark } from "./Primitives";

type Props = {
  initial: SettingsView;
  onSaved: () => void;
};

export function Onboarding({ initial, onSaved }: Props) {
  const [baseUrl, setBaseUrl] = useState(initial.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [concurrency, setConcurrency] = useState(initial.concurrency);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | "ok" | "fail">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrl(initial.base_url ?? "");
    setConcurrency(initial.concurrency);
  }, [initial]);

  async function save(advance: boolean) {
    setSaving(true);
    setError(null);
    try {
      await api.setSettings({
        baseUrl: baseUrl.trim(),
        concurrency,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      if (advance) onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      await api.setSettings({
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      const ok = await api.testConnection();
      setTestResult(ok ? "ok" : "fail");
    } catch (e) {
      setTestResult("fail");
      setError(String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      className="min-h-full flex items-center justify-center"
      style={{ background: "var(--color-paper)" }}
    >
      <div className="w-full max-w-[520px] px-8 py-10">
        {/* App icon mark */}
        <div className="flex justify-center mb-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, var(--color-ember) 0%, var(--color-gold) 100%)",
              boxShadow: "0 12px 32px rgba(201, 85, 28, 0.28)",
            }}
          >
            <KindredMark size={32} />
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="h-eyebrow mb-2" style={{ color: "var(--color-mist)" }}>
            Step 1 · Connect to Kindred
          </div>
          <h1 className="h-display" style={{ fontSize: 28, lineHeight: 1.15 }}>
            Tell the agent where home is.
          </h1>
          <p
            className="mt-3 mx-auto"
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "var(--color-pine)",
              maxWidth: 420,
            }}
          >
            Paste your API key from{" "}
            <code style={{ color: "var(--color-ember)", fontSize: 12 }}>
              kindredphotos.app → Settings → API Keys
            </code>
            . The endpoint defaults to the hosted API.
          </p>
        </div>

        {/* Form */}
        <div className="space-y-5">
          <Field
            label="API endpoint"
            action={
              baseUrl !== "https://api.kindredphotos.app" && (
                <button
                  type="button"
                  onClick={() => setBaseUrl("https://api.kindredphotos.app")}
                  className="text-[11px]"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    color: "var(--color-ember)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Use default
                </button>
              )
            }
          >
            <input
              type="url"
              className="input"
              placeholder="https://api.kindredphotos.app"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              autoFocus
            />
          </Field>

          <Field
            label="API key"
            hint={
              initial.api_key_set
                ? "A key is saved. Leave blank to keep it, or enter a new one to replace."
                : "Starts with knd_. Create one in Kindred under Settings → API Keys."
            }
            action={
              apiKey.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="text-[11px]"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    color: "var(--color-ember)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              )
            }
          >
            <input
              type={showKey ? "text" : "password"}
              className="input"
              placeholder={initial.api_key_set ? "•••••••••• (saved)" : "knd_live_..."}
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
        </div>

        {/* Result strips */}
        {testResult === "ok" && (
          <div className="mt-5">
            <Alert tone="ok">Connection successful. Ready to back up.</Alert>
          </div>
        )}
        {testResult === "fail" && !error && (
          <div className="mt-5">
            <Alert tone="warn">Could not reach the backend. Check the URL and your key.</Alert>
          </div>
        )}
        {error && (
          <div className="mt-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 flex items-center justify-between">
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--color-mist)",
            }}
          >
            API key stored in this app's data dir
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={test}
              disabled={!baseUrl.trim() || (!apiKey.trim() && !initial.api_key_set) || testing}
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => save(true)}
              disabled={!baseUrl.trim() || saving || (!apiKey.trim() && !initial.api_key_set)}
            >
              {saving ? "Saving…" : "Save and continue →"}
            </button>
          </div>
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
        <div
          className="mt-1.5"
          style={{ fontSize: 11.5, color: "var(--color-mist)", lineHeight: 1.4 }}
        >
          {hint}
        </div>
      )}
    </label>
  );
}
