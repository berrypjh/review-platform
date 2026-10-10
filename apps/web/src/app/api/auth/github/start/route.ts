import { startLogin } from '@/lib/auth/oauth';
import { cookie, OAUTH_COOKIE } from '@/lib/auth/session';
import { approvalRuntime, failureResponse } from '@/lib/manual-approval/runtime';

/** GitHub 로그인 시작. state를 DB에, 브라우저 binding을 쿠키에 두고 GitHub authorize로 보낸다. */
export async function GET(request: Request) {
  try {
    const { sql, config } = approvalRuntime(5_000);
    const returnTo = new URL(request.url).searchParams.get('returnTo');
    const { location, binding } = await startLogin(sql, config, returnTo);
    return new Response(null, {
      status: 302,
      headers: {
        location,
        'set-cookie': cookie(OAUTH_COOKIE, binding, 600),
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return failureResponse(error);
  }
}
