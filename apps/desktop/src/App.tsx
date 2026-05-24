import { useEffect, useState } from "react";
import { api, type SettingsView } from "./lib/tauri";
import { AppStateProvider } from "./lib/appState";
import { Onboarding } from "./components/Onboarding";
import { SidebarShell, type Page } from "./components/SidebarShell";
import { DashboardPage } from "./pages/Dashboard";
import { IndexerPage } from "./pages/Indexer";
import { UploadsPage } from "./pages/Uploads";
import { SourcesPage } from "./pages/Sources";
import { ActivityPage } from "./pages/Activity";
import { SettingsPage } from "./pages/Settings";

type View = "loading" | "onboarding" | "app";

function App() {
  const [view, setView] = useState<View>("loading");
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [page, setPage] = useState<Page>("dashboard");

  async function refresh() {
    try {
      const s = await api.getSettings();
      setSettings(s);
      const ready = !!s.base_url && s.api_key_set;
      setView(ready ? "app" : "onboarding");
    } catch (_e) {
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

  return (
    <AppStateProvider>
      <SidebarShell current={page} onNavigate={setPage}>
        {page === "dashboard" && <DashboardPage onNavigate={setPage} />}
        {page === "indexer" && <IndexerPage />}
        {page === "uploads" && <UploadsPage />}
        {page === "sources" && <SourcesPage />}
        {page === "activity" && <ActivityPage />}
        {page === "settings" && <SettingsPage onSignedOut={refresh} />}
      </SidebarShell>
    </AppStateProvider>
  );
}

export default App;
