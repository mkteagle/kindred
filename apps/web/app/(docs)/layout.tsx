import { RootProvider } from 'fumadocs-ui/provider/next';
import { DEFAULT_THEME, THEME_KEY } from '@/components/kx/theme-script';
import './docs-global.css';

export default function DocsRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RootProvider
      theme={{
        attribute: 'data-theme',
        storageKey: THEME_KEY,
        defaultTheme: DEFAULT_THEME,
        enableSystem: false,
      }}
    >
      <div className="kindred-docs">{children}</div>
    </RootProvider>
  );
}
