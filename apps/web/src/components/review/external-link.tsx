import { ExternalLink as ExternalLinkIcon } from 'lucide-react';

import { focusRing } from '@/lib/styles';
import { cn } from '@/lib/utils';

/** 새 탭으로 여는 외부 링크. 스크린리더에 "(opens in a new tab)"을 알린다. */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn('inline-flex items-center gap-1 underline underline-offset-4', focusRing)}
    >
      {children}
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
