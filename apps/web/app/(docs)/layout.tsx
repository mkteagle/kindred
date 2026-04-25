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
        enableSystem: true,
      }}
    >
      {children}
    </RootProvider>
  );
}
