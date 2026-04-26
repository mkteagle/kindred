import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 text-base font-bold tracking-tight">
          <img
            src="/kindred-icon.svg"
            alt="Kindred Photos"
            className="h-6 w-6 rounded"
          />
          Kindred
          <span className="text-xs font-normal text-fd-muted-foreground">Docs</span>
        </span>
      ),
    },
    links: [
      {
        text: 'Kindred Photos',
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
