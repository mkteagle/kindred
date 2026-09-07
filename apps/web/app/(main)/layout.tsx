import { Providers } from "./providers";
import { KxAppShell } from "@/components/kx/app-shell";
import { THEME_BOOT_SCRIPT } from "@/components/kx/theme-script";
import { SyncProgress } from "@/components/sync-progress";
import "./globals.css";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="main-app">
      {/* Sets <html data-theme> before first paint so the shell never flashes
          the wrong ground. Has to be inline and synchronous. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <Providers>
        <KxAppShell>
          <SyncProgress />
          {children}
        </KxAppShell>
      </Providers>
    </div>
  );
}
