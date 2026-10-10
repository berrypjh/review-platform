import { completeLogin } from '@/lib/auth/oauth';
import {
  clearCookie,
  cookie,
  OAUTH_COOKIE,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@/lib/auth/session';
import { deadlineIn } from '@/lib/github/http';
import { approvalRuntime, failureResponse, json } from '@/lib/manual-approval/runtime';

export const maxDuration = 15;

/**
 * GitHub 로그인 callback. state · binding · PKCE가 맞고 운영자일 때만 세션 쿠키를 준다.
 * binding 쿠키는 결과와 관계없이 지운다.
 */
export async function GET(request: Request) {
  try {
    const { sql, config, transport } = approvalRuntime(10_000);
    const url = new URL(request.url);
    const result = await completeLogin(
      { sql, transport, config, deadline: deadlineIn(10_000) },
      {
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        binding: readCookie(request.headers.get('cookie'), OAUTH_COOKIE),
      },
    );
    if (result.kind !== 'ok') {
      const response = json(result.kind === 'forbidden' ? 403 : 400, {
        error: result.kind === 'forbidden' ? 'not-an-approver' : 'invalid-login',
      });
      response.headers.append('set-cookie', clearCookie(OAUTH_COOKIE));
      return response;
    }
    const headers = new Headers({
      location: `${config.publicBaseUrl}${result.returnTo}`,
      'cache-control': 'no-store',
    });
    headers.append('set-cookie', clearCookie(OAUTH_COOKIE));
    headers.append('set-cookie', cookie(SESSION_COOKIE, result.sessionToken, SESSION_TTL_SECONDS));
    return new Response(null, { status: 303, headers });
  } catch (error) {
    return failureResponse(error);
  }
}
