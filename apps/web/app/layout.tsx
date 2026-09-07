import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Kindred — Private Family Photo Library",
    template: "%s | Kindred",
  },
  description: "A calmer home for family photos, with people, places, and moments organized for the whole household.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"),
  openGraph: {
    type: "website",
    siteName: "Kindred",
    title: "Kindred — Private Family Photo Library",
    description: "A calmer home for family photos, with people, places, and moments organized for the whole household.",
    url: process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Kindred — Private Family Photo Library",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Kindred — Private Family Photo Library",
    description: "A calmer home for family photos.",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The boot scripts in (main)/layout.tsx stamp data-theme and
    // data-sidebar onto <html> before first paint, so the server markup
    // cannot match. Without this React reports the mismatch as one it
    // "won't patch up" and abandons hydration of the tree: the client
    // component never renders, so every screen sticks on its server-
    // rendered skeleton and no query ever runs.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
