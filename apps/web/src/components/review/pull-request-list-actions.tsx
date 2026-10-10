'use client';

import { LogOut, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { ActionMessage, postForm, useAction } from './action-feedback';
import { commonFailure } from './approval-actions';

/** 한 번 누를 때 이어 받는 재동기화 호출의 상한. 각 호출은 서버 시간 예산 안에서 끝나고 cursor를 돌려준다. */
const MAX_ROUNDS = 10;

/**
 * 목록의 Sync PRs. 반영되지 않은 PR과 허용 저장소의 open PR을 서버 재동기화로 맞춘다(bootstrap · 복구).
 * cursor가 null이 될 때까지 이어 부르고, 진행 상황을 `role=status`로 알린다.
 */
export function SyncPullRequestsButton({ csrfToken }: { csrfToken: string }) {
  const { run, pending, outcome, messageRef } = useAction();

  const sync = () =>
    run(async (progress) => {
      let cursor: string | null = null;
      let processed = 0;
      let notSynced = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const { status, body } = await postForm('/api/github/reconcile', {
          csrf: csrfToken,
          ...(cursor === null ? {} : { cursor }),
        });
        if (status !== 200) return { tone: 'error', message: commonFailure(status) };
        processed += Number(body['processed'] ?? 0);
        notSynced += Array.isArray(body['notSynced']) ? body['notSynced'].length : 0;
        cursor = typeof body['cursor'] === 'string' ? body['cursor'] : null;
        if (cursor === null) break;
        progress(`Synced ${processed} pull requests so far…`);
      }
      if (cursor !== null) {
        return {
          tone: 'info',
          message: `Synced ${processed} pull requests. More remain — select Sync PRs again.`,
        };
      }
      return notSynced === 0
        ? { tone: 'success', message: `Sync finished. ${processed} pull requests checked.` }
        : {
            tone: 'error',
            message: `Sync finished with problems. ${notSynced} of ${processed} pull requests are not confirmed on GitHub.`,
          };
    });

  return (
    <div className="space-y-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void sync();
        }}
      >
        <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
          <RefreshCw aria-hidden="true" />
          {pending ? 'Syncing…' : 'Sync PRs'}
        </Button>
      </form>
      <ActionMessage outcome={outcome} messageRef={messageRef} />
    </div>
  );
}

/** 로그아웃. 서버 세션을 철회한 뒤 화면을 다시 읽어 로그인 안내를 보인다. */
export function SignOutButton({ csrfToken }: { csrfToken: string }) {
  const { run, pending, outcome, messageRef } = useAction();
  const signOut = () =>
    run(async () => {
      const { status } = await postForm('/api/auth/logout', { csrf: csrfToken });
      return status === 200
        ? { tone: 'success', message: 'Signed out.' }
        : { tone: 'error', message: commonFailure(status) };
    });

  return (
    <div className="space-y-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void signOut();
        }}
      >
        <Button type="submit" variant="ghost" size="sm" disabled={pending} aria-busy={pending}>
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </form>
      <ActionMessage outcome={outcome} messageRef={messageRef} />
    </div>
  );
}
