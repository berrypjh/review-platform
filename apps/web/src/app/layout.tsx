import './global.css';

import { GitCompare } from 'lucide-react';
import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import Link from 'next/link';

import { TooltipProvider } from '@/components/ui/tooltip';
import { focusRing } from '@/lib/styles';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: { default: 'Engineering Review', template: '%s · Engineering Review' },
  description: 'Local review UI for visual regression runs.',
};

/** 공통 shell: skip link, header, `main` landmark. 화면 너비는 스크린샷 비교가 넓게 보이도록 2xl까지 쓴다. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <TooltipProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
          >
            Skip to content
          </a>
          <header className="border-b">
            <div className="mx-auto flex h-14 max-w-screen-2xl items-center px-4 sm:px-6">
              <Link
                href="/"
                className={cn('inline-flex items-center gap-2 text-sm font-semibold', focusRing)}
              >
                <GitCompare aria-hidden="true" className="size-4" />
                Engineering Review
              </Link>
            </div>
          </header>
          <main id="main" className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
            {children}
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}
