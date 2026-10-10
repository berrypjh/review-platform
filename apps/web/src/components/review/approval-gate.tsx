import { CircleX, LogIn, Settings, ShieldAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { focusRing } from '@/lib/styles';
import { cn } from '@/lib/utils';

import { SignOutButton } from './pull-request-list-actions';

/** 로그인 안 함 · 운영자 아님. PR 데이터는 서버에서 아예 읽지 않는다. */
export function SignedOut({ returnTo }: { returnTo: string }) {
  return (
    <Alert>
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>Sign in required</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Pull request approvals are only visible to approvers. Sign in with a GitHub account that
          is listed as an approver on this server.
        </p>
        <a
          href={`/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`}
          className={cn(
            'inline-flex items-center gap-2 font-medium text-foreground underline underline-offset-4',
            focusRing,
          )}
        >
          <LogIn aria-hidden="true" className="size-4" />
          Sign in with GitHub
        </a>
      </AlertDescription>
    </Alert>
  );
}

/** 승인 설정(DB · GitHub App)이 없는 서버. 어떤 값이 없는지는 서버 로그에만 남긴다. */
export function NotConfigured() {
  return (
    <Alert>
      <Settings aria-hidden="true" />
      <AlertTitle>Manual approval is not configured</AlertTitle>
      <AlertDescription>
        This server has no database or GitHub App settings for pull request approval. Visual runs
        still work. See docs/manual-approval/setup.md.
      </AlertDescription>
    </Alert>
  );
}

/** DB 등을 읽지 못했다. 원인은 서버 로그에 있고 화면에는 내보내지 않는다. */
export function LoadFailed({ what }: { what: string }) {
  return (
    <Alert variant="destructive">
      <CircleX aria-hidden="true" />
      <AlertTitle>Could not load {what}</AlertTitle>
      <AlertDescription>
        The approval database could not be read. Nothing is shown as approved. Reload the page to
        try again.
      </AlertDescription>
    </Alert>
  );
}

/** 로그인한 운영자 표시와 로그아웃. */
export function OperatorBar({ login, csrfToken }: { login: string; csrfToken: string }) {
  return (
    <div className="flex flex-wrap items-start justify-end gap-3 text-sm text-muted-foreground">
      <span className="pt-1.5 break-all">Signed in as @{login}</span>
      <SignOutButton csrfToken={csrfToken} />
    </div>
  );
}
