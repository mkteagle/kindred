import { useEffect, useState } from "react";
import { api, type SettingsView } from "../lib/tauri";

type Props = {
  initial: SettingsView;
  onSaved: () => void;
};

export function Onboarding({ initial, onSaved }: Props) {
  const [baseUrl, setBaseUrl] = useState(initial.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [concurrency, setConcurrency] = useState(initial.concurrency);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | "ok" | "fail">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrl(initial.base_url ?? "");
    setConcurrency(initial.concurrency);
  }, [initial]);

  const canTest = baseUrl.trim().length > 0 && (apiKey.trim().length > 0 || initial.api_key_set);

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
      const payload = {
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      };
      console.log("[test] setSettings payload:", payload);
      await api.setSettings(payload);
      const current = await api.getSettings();
      console.log("[test] settings after save:", current);
      const ok = await api.testConnection();
      console.log("[test] testConnection result:", ok);
      setTestResult(ok ? "ok" : "fail");
    } catch (e) {
      console.error("[test] error:", e);
      setTestResult("fail");
      setError(String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Kindred Uploader</h1>
          <p className="text-ink-500 mt-1">
            Connect to your Kindred backend to start uploading.
          </p>
        </header>

        <div className="space-y-4">
          <Field label="Backend URL">
            <input
              type="url"
              className="input"
              placeholder="https://api.kindredphotos.app or http://localhost:8000"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              autoFocus
            />
          </Field>

          <Field
            label="API Key"
            hint={
              initial.api_key_set
                ? "A key is saved. Leave blank to keep it, or enter a new one to replace it."
                : "Create one in Kindred under Settings → API Keys (starts with knd_)"
            }
          >
            <input
              type="password"
              className="input"
              placeholder={initial.api_key_set ? "•••••••••••• (saved)" : "knd_..."}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>

          <Field label="Concurrent uploads">
            <input
              type="number"
              min={1}
              max={10}
              className="input w-24"
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
            />
          </Field>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {testResult === "ok" && (
          <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
            Connection successful.
          </div>
        )}
        {testResult === "fail" && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            Could not reach the backend. Check the URL and your API key.
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={test}
            disabled={!canTest || testing}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            type="button"
            className="btn-primary ml-auto"
            onClick={() => save(true)}
            disabled={!baseUrl.trim() || saving || (!apiKey.trim() && !initial.api_key_set)}
          >
            {saving ? "Saving…" : "Save and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-500 mt-1">{hint}</span>}
    </label>
  );
}
