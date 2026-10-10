import { clearCookie, guardMutation, hashToken, SESSION_COOKIE } from '@/lib/auth/session';
import { revokeSession } from '@/lib/auth/store';
import { approvalRuntime, failureResponse, json } from '@/lib/manual-approval/runtime';
import { formText, guardFailure } from '@/lib/manual-approval/route-input';

/** 로그아웃. 서버 세션을 철회하고 쿠키를 지운다. POST · Origin · CSRF가 맞아야 한다. */
export async function POST(request: Request) {
  try {
    const { sql, config } = approvalRuntime(5_000);
    const form = await request.formData().catch(() => null);
    const guard = await guardMutation(sql, config, {
      origin: request.headers.get('origin'),
      cookieHeader: request.headers.get('cookie'),
      csrfToken: formText(form, 'csrf'),
    });
    if (guard.kind !== 'ok') return guardFailure(guard.kind);
    await revokeSession(sql, hashToken(guard.sessionToken));
    const response = json(200, { result: 'logged-out' });
    response.headers.append('set-cookie', clearCookie(SESSION_COOKIE));
    return response;
  } catch (error) {
    return failureResponse(error);
  }
}
