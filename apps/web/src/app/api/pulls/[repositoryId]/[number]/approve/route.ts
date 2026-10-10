import { guardMutation } from '@/lib/auth/session';
import { approvePullRequest } from '@/lib/manual-approval/approve';
import { formText, guardFailure } from '@/lib/manual-approval/route-input';
import { approvalRuntime, failureResponse, json } from '@/lib/manual-approval/runtime';
import { ApproveInputSchema, PullRequestKeySchema } from '@/lib/manual-approval/schema';
import { approvalStatus } from '@/lib/manual-approval/state';

type Context = { params: Promise<{ repositoryId: string; number: string }> };

export const maxDuration = 30;

/**
 * 수동 승인. 운영자 세션 · Origin · CSRF를 확인한 뒤, 화면이 보던 HEAD SHA · revision으로 승인한다.
 * 승인자는 세션의 사용자다 — body의 사용자 정보는 읽지 않는다.
 * GitHub success까지 확인됐을 때만 200 `approved`. 기록만 되고 반영을 확인하지 못했으면 502 `not-confirmed`.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { sql, github, config } = approvalRuntime(25_000);
    const form = await request.formData().catch(() => null);
    const guard = await guardMutation(sql, config, {
      origin: request.headers.get('origin'),
      cookieHeader: request.headers.get('cookie'),
      csrfToken: formText(form, 'csrf'),
    });
    if (guard.kind !== 'ok') return guardFailure(guard.kind);

    const raw = await params;
    const key = PullRequestKeySchema.safeParse({
      repositoryId: Number(raw.repositoryId),
      number: Number(raw.number),
    });
    const input = ApproveInputSchema.safeParse({
      expectedHeadSha: formText(form, 'expectedHeadSha'),
      expectedRevision: formText(form, 'expectedRevision'),
    });
    if (!key.success || !input.success) return json(400, { error: 'invalid-input' });

    const outcome = await approvePullRequest({ sql, github }, key.data, input.data, guard.operator);
    switch (outcome.kind) {
      case 'approved':
        return json(200, {
          result: 'approved',
          headSha: outcome.snapshot.revision?.headSha,
          revision: outcome.snapshot.revision?.generation,
        });
      case 'not-confirmed':
        return json(502, { result: 'not-confirmed', status: approvalStatus(outcome.snapshot) });
      case 'conflict':
        return json(outcome.reason === 'not-found' ? 404 : 409, {
          result: 'conflict',
          reason: outcome.reason,
        });
      case 'forbidden-repository':
        return json(403, { error: 'repository-not-allowed' });
      case 'busy':
        return json(503, { result: 'busy' });
    }
  } catch (error) {
    return failureResponse(error);
  }
}
