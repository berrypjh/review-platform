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
  description: 'Review UI for visual regression runs and manual pull request approval.',
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
            <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-6 px-4 sm:px-6">
              <Link
                href="/"
                className={cn('inline-flex items-center gap-2 text-sm font-semibold', focusRing)}
              >
                <GitCompare aria-hidden="true" className="size-4" />
                Engineering Review
              </Link>
              {/* 세션을 읽지 않는 링크뿐이다 — Visual 화면은 DB 없이 그대로 동작한다. */}
              <nav aria-label="Sections" className="flex gap-4 text-sm">
                <Link
                  href="/"
                  className={cn('text-muted-foreground hover:text-foreground', focusRing)}
                >
                  Visual runs
                </Link>
                <Link
                  href="/pulls"
                  className={cn('text-muted-foreground hover:text-foreground', focusRing)}
                >
                  Pull requests
                </Link>
              </nav>
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
