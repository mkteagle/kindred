import { RootProvider } from 'fumadocs-ui/provider/next';
import './docs-global.css';

export default function DocsRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RootProvider
      theme={{
        defaultTheme: 'dark',
        forcedTheme: 'dark',
        enableSystem: false,
      }}
    >
      {children}
    </RootProvider>
  );
}
