import { BrandWordmark } from '@/components/brand-mark';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      url: '/docs',
      title: (
        <span className="kindred-docs-brand">
          <BrandWordmark className="kindred-docs-wordmark" />
          <span>Docs</span>
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
