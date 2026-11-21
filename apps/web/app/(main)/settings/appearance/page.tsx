"use client";

import { MoonIcon, SunIcon } from "@/components/kx/icons";
import { useTheme } from "@/components/kx/theme";

export default function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme();
  return <>
    <h2 className="kx-setting-title">Appearance</h2>
    <div className="kx-appearance-options" role="group" aria-label="Theme">
      <button className="kx-setting-row" aria-pressed={theme === "light"} onClick={() => setTheme("light")}><SunIcon /> Light</button>
      <button className="kx-setting-row" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><MoonIcon /> Dark</button>
    </div>
  </>;
}
