import { Providers } from "./providers";
import { Topbar } from "./topbar";
import { SyncProgress } from "@/components/sync-progress";
import "./globals.css";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="main-app">
      <Providers>
        <Topbar />
        <SyncProgress />
        {children}
      </Providers>
    </div>
  );
}
