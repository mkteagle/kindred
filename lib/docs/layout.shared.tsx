import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="text-base font-bold tracking-tight">
          Kindred
          <span className="ml-1.5 text-xs font-normal text-fd-muted-foreground">Docs</span>
        </span>
      ),
    },
    links: [
      {
        text: 'Kindred',
        url: '/',
      },
      {
        text: 'GitHub',
        url: 'https://github.com/mkteagle/kindred',
        external: true,
      },
    ],
    githubUrl: 'https://github.com/mkteagle/kindred',
  };
}
