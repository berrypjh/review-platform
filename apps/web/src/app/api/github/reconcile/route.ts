import { guardMutation } from '@/lib/auth/session';
import { isValidCursor, reconcile, reconcilePullRequest } from '@/lib/manual-approval/reconcile';
import { formText, guardFailure } from '@/lib/manual-approval/route-input';
import { approvalRuntime, failureResponse, json } from '@/lib/manual-approval/runtime';
import { PullRequestKeySchema } from '@/lib/manual-approval/schema';

export const maxDuration = 60;

/**
 * 운영자 재동기화. `repositoryId` · `number`가 있으면 그 PR만, 없으면 반영되지 않은 PR과 허용 저장소의
 * open PR(bootstrap)을 시간 예산 안에서 처리하고 `cursor`를 돌려준다. 다음 호출에 `cursor`를 넘겨 이어 간다.
 */
export async function POST(request: Request) {
  try {
    const { sql, github, config } = approvalRuntime(50_000);
    const form = await request.formData().catch(() => null);
    const guard = await guardMutation(sql, config, {
      origin: request.headers.get('origin'),
      cookieHeader: request.headers.get('cookie'),
      csrfToken: formText(form, 'csrf'),
    });
    if (guard.kind !== 'ok') return guardFailure(guard.kind);

    const repositoryId = formText(form, 'repositoryId');
    const number = formText(form, 'number');
    if (repositoryId !== null || number !== null) {
      const key = PullRequestKeySchema.safeParse({
        repositoryId: Number(repositoryId),
        number: Number(number),
      });
      if (!key.success) return json(400, { error: 'invalid-input' });
      return json(200, { result: await reconcilePullRequest({ sql, github }, key.data) });
    }
    const cursor = formText(form, 'cursor');
    if (cursor !== null && !isValidCursor(cursor)) return json(400, { error: 'invalid-cursor' });
    return json(200, { ...(await reconcile({ sql, github }, cursor)) });
  } catch (error) {
    return failureResponse(error);
  }
}
