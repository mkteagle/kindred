import { useEffect, useState } from "react";
import { api, type SettingsView } from "./lib/tauri";
import { Onboarding } from "./components/Onboarding";
import { Dashboard } from "./components/Dashboard";

type View = "loading" | "onboarding" | "dashboard";

function App() {
  const [view, setView] = useState<View>("loading");
  const [settings, setSettings] = useState<SettingsView | null>(null);

  async function refresh() {
    try {
      const s = await api.getSettings();
      setSettings(s);
      const ready = !!s.base_url && s.api_key_set;
      setView(ready ? "dashboard" : "onboarding");
    } catch (e) {
      setSettings({ base_url: null, concurrency: 3, api_key_set: false });
      setView("onboarding");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (view === "loading" || !settings) {
    return (
      <div
        className="min-h-full flex items-center justify-center"
        style={{ background: "var(--color-paper)" }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--color-mist)",
          }}
        >
          Loading…
        </div>
      </div>
    );
  }
  if (view === "onboarding") {
    return <Onboarding initial={settings} onSaved={refresh} />;
  }
  return <Dashboard onOpenSettings={() => setView("onboarding")} />;
}

export default App;
