import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'Kindred Docs',
    template: '%s | Kindred Docs',
  },
  description: 'Documentation for Kindred — self-hosted family photo library with face recognition',
  icons: {
    icon: '/icon.svg',
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen antialiased">
        <RootProvider
          theme={{
            defaultTheme: 'dark',
            forcedTheme: 'dark',
            enableSystem: false,
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
