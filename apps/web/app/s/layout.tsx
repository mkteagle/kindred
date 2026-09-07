import type { Metadata } from "next";

// The share viewer sits outside the (main) route group on purpose: no topbar,
// no providers, no session. It still needs the stylesheet that group owns.
import "../(main)/globals.css";

export const metadata: Metadata = {
  title: "Shared with you · Kindred",
  // A share link is meant for one recipient, not for search engines.
  robots: { index: false, follow: false },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
