import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import type { BrowserContext } from '@playwright/test';

const SEED = join(workspaceRoot, 'apps/web/src/lib/manual-approval/e2e-seed.ts');

/** 수동 승인 E2E는 전용 테스트 DB와 로컬 서버가 있어야 한다. 배포 서버(BASE_URL)에는 쓰지 않는다. */
export const approvalE2eUnavailable =
  !process.env['E2E_DATABASE_URL'] || Boolean(process.env['BASE_URL']);

export const OPERATOR = { githubUserId: 42, login: 'operator' };
export const OPERATOR_TOKEN = 'e2e-operator-session-token-000000000000000';
export const OUTSIDER_TOKEN = 'e2e-outsider-session-token-000000000000000';

/** 테스트 DB에 행을 만든다. 앱의 repository 함수를 그대로 쓰는 seed CLI를 실행한다. */
export function seed(command: Record<string, unknown>): void {
  execFileSync(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SEED, JSON.stringify(command)],
    {
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
}

export const sha = (char: string) => char.repeat(40);

export function pull(number: number, overrides: Record<string, unknown> = {}) {
  return {
    repositoryId: 101,
    number,
    installationId: 5,
    owner: 'berrypjh',
    name: 'shared-stack',
    title: `Update button styles ${number}`,
    authorLogin: 'octocat',
    htmlUrl: `https://github.com/berrypjh/shared-stack/pull/${number}`,
    headSha: sha('a'),
    state: 'open',
    ...overrides,
  };
}

/**
 * 테스트 harness가 만든 세션을 브라우저에 넣는다. 운영 코드의 인증을 건너뛰는 경로가 아니라,
 * 로그인 callback이 만들었을 것과 같은 DB 세션 + `__Host-` cookie다.
 * `url`을 주면 Playwright가 http에서 `secure`를 false로 덮어써 `__Host-`가 거부되므로 domain · path로 넣는다.
 */
export async function signIn(context: BrowserContext, baseURL: string, token = OPERATOR_TOKEN) {
  await context.addCookies([
    {
      name: '__Host-rp_session',
      value: token,
      domain: new URL(baseURL).hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}
