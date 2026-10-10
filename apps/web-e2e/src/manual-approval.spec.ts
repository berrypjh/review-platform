import { expect, type Page, type PlaywrightWorkerArgs, test } from '@playwright/test';

import {
  approvalE2eUnavailable,
  OPERATOR,
  OPERATOR_TOKEN,
  OUTSIDER_TOKEN,
  pull,
  seed,
  sha,
  signIn,
} from './support/approval';
import { tabTo } from './support/keyboard';

/**
 * PR 수동 승인 화면. 전용 테스트 DB(`E2E_DATABASE_URL`)와 로컬 서버가 있어야 한다.
 * 승인 · Retry sync 요청은 GitHub를 부르므로 브라우저 경계에서 가로채고, 서버가 했을 DB 기록을 seed로 대신 한다 —
 * 서버의 승인 · GitHub 흐름 자체는 apps/web의 DB 통합 테스트가 본다. 인증 거부(401 · 403)는 실제 서버 route로 확인한다.
 */
test.skip(
  approvalE2eUnavailable,
  'Needs E2E_DATABASE_URL and a local server (docs/manual-approval/setup.md)',
);
test.describe.configure({ mode: 'serial' });

const DETAIL = '/pulls/101/7';
const APPROVE_API = '**/api/pulls/101/7/approve';

test.beforeEach(async ({ context, baseURL }) => {
  seed({ op: 'reset' });
  seed({ op: 'session', token: OPERATOR_TOKEN, ...OPERATOR });
  seed({ op: 'session', token: OUTSIDER_TOKEN, githubUserId: 7000, login: 'outsider' });
  await signIn(context, baseURL ?? '');
});

const approvalBadge = (page: Page) => page.getByRole('group', { name: 'Approval status' });
const approveButton = (page: Page) => page.getByRole('button', { name: /^Approve / });
/** 상세 화면의 Approval 영역. live region은 이 안에서만 찾는다(로그아웃 버튼 · Next route announcer와 겹치지 않게). */
const approvalRegion = (page: Page) => page.getByRole('region', { name: 'Approval' });

/** 실제 서버 route에 브라우저 없이 POST하고 status를 돌려준다. cookie · Origin을 직접 정한다. */
async function apiStatus(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
  path: string,
  cookie: string | null,
  origin = baseURL,
) {
  const api = await playwright.request.newContext({ baseURL });
  const response = await api.post(path, {
    form: { csrf: 'not-the-token', expectedHeadSha: sha('a'), expectedRevision: '1' },
    headers: { origin, ...(cookie ? { cookie: `__Host-rp_session=${cookie}` } : {}) },
  });
  await api.dispose();
  return response.status();
}

test.describe('Access', () => {
  test('asks to sign in and shows no pull request data when signed out', async ({
    page,
    context,
  }) => {
    seed({ op: 'observe', pull: pull(7, { title: 'Secret change' }), sync: 'synced' });
    await context.clearCookies();
    await page.goto('/pulls');

    await expect(page.getByText('Sign in required')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
      'href',
      '/api/auth/github/start?returnTo=%2Fpulls',
    );
    await expect(page.getByText('Secret change')).toHaveCount(0);
  });

  test('treats a GitHub user outside the approver list as signed out', async ({
    page,
    context,
    baseURL,
  }) => {
    seed({ op: 'observe', pull: pull(7, { title: 'Secret change' }), sync: 'synced' });
    await context.clearCookies();
    await signIn(context, baseURL ?? '', OUTSIDER_TOKEN);
    await page.goto(DETAIL);

    await expect(page.getByText('Sign in required')).toBeVisible();
    await expect(page.getByText('Secret change')).toHaveCount(0);
  });

  test('rejects mutations without a valid operator session on the server', async ({
    playwright,
    baseURL,
  }) => {
    const base = baseURL ?? '';
    const status = (path: string, cookie: string | null, origin?: string) =>
      apiStatus(playwright, base, path, cookie, origin);
    seed({ op: 'observe', pull: pull(7), sync: 'synced' });

    expect(await status('/api/pulls/101/7/approve', null)).toBe(401);
    expect(await status('/api/pulls/101/7/approve', OUTSIDER_TOKEN)).toBe(401);
    // 운영자 세션이어도 세션에 묶인 CSRF token이 아니면 403
    expect(await status('/api/pulls/101/7/approve', OPERATOR_TOKEN)).toBe(403);
    expect(await status('/api/pulls/101/7/approve', OPERATOR_TOKEN, 'https://evil.example')).toBe(
      403,
    );
    expect(await status('/api/github/reconcile', null)).toBe(401);
    expect(await status('/api/auth/logout', OPERATOR_TOKEN)).toBe(403);
  });

  test('signs out and the server forgets the session', async ({ page, playwright, baseURL }) => {
    await page.goto('/pulls');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('Sign in required')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Sign in required')).toBeVisible();
    // 쿠키만 지운 것이 아니라 서버 세션이 철회됐다 — 같은 token은 더 이상 운영자가 아니다
    expect(
      await apiStatus(playwright, baseURL ?? '', '/api/pulls/101/7/approve', OPERATOR_TOKEN),
    ).toBe(401);
  });
});

test.describe('Pull request list', () => {
  test('shows an empty state with the Sync PRs action', async ({ page }) => {
    await page.goto('/pulls');
    await expect(page.getByRole('heading', { level: 1, name: 'Pull requests' })).toBeVisible();
    await expect(page.getByText('No pull requests yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync PRs' })).toBeVisible();
  });

  test('lists stored pull requests with their approval state as text', async ({ page }) => {
    const longTitle = `Refactor ${'very-long-component-name-'.repeat(12)}end`;
    seed({ op: 'observe', pull: pull(1), sync: 'synced' });
    seed({ op: 'observe', pull: pull(2, { headSha: sha('b') }), sync: 'synced' });
    seed({ op: 'approve', repositoryId: 101, number: 2, ...OPERATOR, sync: 'synced' });
    seed({ op: 'observe', pull: pull(3, { state: 'closed' }) });
    seed({
      op: 'observe',
      pull: pull(4, { title: longTitle, name: `shared-stack-${'x'.repeat(60)}` }),
      sync: 'synced',
    });
    await page.goto('/pulls');

    const row = (number: number) => page.getByRole('row', { name: new RegExp(`#${number} `) });
    await expect(row(1).getByText('Pending approval')).toBeVisible();
    await expect(row(2).getByText('Approved')).toBeVisible();
    await expect(row(3).getByText('Closed')).toBeVisible();
    await expect(row(1).getByRole('link', { name: /#1 \(opens in a new tab\)/ })).toHaveAttribute(
      'target',
      '_blank',
    );
    await expect(
      page.getByRole('link', { name: new RegExp(`#4 ${longTitle.slice(0, 30)}`) }),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Approval', () => {
  test('approves from the keyboard once and keeps Approved after reload', async ({ page }) => {
    seed({ op: 'observe', pull: pull(7), sync: 'synced' });
    const posted: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(APPROVE_API, async (route) => {
      posted.push(route.request().postData() ?? '');
      await held;
      seed({ op: 'approve', repositoryId: 101, number: 7, ...OPERATOR, sync: 'synced' });
      await route.fulfill({
        status: 200,
        json: { result: 'approved', headSha: sha('a'), revision: 1 },
      });
    });
    await page.goto(DETAIL);
    await expect(approvalBadge(page)).toHaveText('Pending approval');

    const button = approveButton(page);
    await tabTo(page, button, 40);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Approving…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Approving…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await page.keyboard.press('Enter');
    release();

    await expect(approvalRegion(page).getByRole('status')).toContainText(
      'Approved. GitHub confirmed the check',
    );
    expect(posted).toHaveLength(1);
    const body = new URLSearchParams(posted[0]);
    expect(body.get('expectedHeadSha')).toBe(sha('a'));
    expect(body.get('expectedRevision')).toBe('1');
    expect(body.get('csrf')).toBeTruthy();
    await expect(approvalBadge(page)).toHaveText('Approved');
    await expect(approveButton(page)).toHaveCount(0);

    await page.reload();
    await expect(approvalBadge(page)).toHaveText('Approved');
    await expect(
      page.getByRole('row', { name: /1 \(current\).*Approved.*@operator/ }),
    ).toBeVisible();
  });

  test('a double click sends one approval request', async ({ page }) => {
    seed({ op: 'observe', pull: pull(7), sync: 'synced' });
    let calls = 0;
    await page.route(APPROVE_API, async (route) => {
      calls++;
      await route.fulfill({ status: 409, json: { result: 'conflict', reason: 'not-open' } });
    });
    await page.goto(DETAIL);
    await approveButton(page).dblclick();
    await expect(approvalRegion(page).getByRole('alert')).toContainText('no longer open');
    expect(calls).toBe(1);
  });

  test('asks to review the new commit when the head changed', async ({ page }) => {
    seed({ op: 'observe', pull: pull(7), sync: 'synced' });
    await page.route(APPROVE_API, async (route) => {
      seed({ op: 'observe', pull: pull(7, { headSha: sha('b') }), sync: 'synced' });
      await route.fulfill({
        status: 409,
        json: { result: 'conflict', reason: 'revision-changed' },
      });
    });
    await page.goto(DETAIL);
    await approveButton(page).click();

    await expect(approvalRegion(page).getByRole('alert')).toContainText('A new commit was pushed');
    await expect(page.getByText(sha('b'))).toBeVisible();
    await expect(approvalBadge(page)).toHaveText('Pending approval');
    await expect(page.getByRole('button', { name: 'Approve bbbbbbb' })).toBeVisible();
    await expect(page.getByRole('row', { name: /^1 .*Superseded/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /2 \(current\)/ })).toBeVisible();
  });

  test('does not show approved when the request fails', async ({ page }) => {
    seed({ op: 'observe', pull: pull(7), sync: 'synced' });
    await page.route(APPROVE_API, (route) =>
      route.fulfill({ status: 502, json: { error: 'github', kind: 'timeout' } }),
    );
    await page.goto(DETAIL);
    await approveButton(page).click();

    await expect(approvalRegion(page).getByRole('alert')).toContainText(
      'Nothing new is confirmed on GitHub',
    );
    await expect(approvalBadge(page)).toHaveText('Pending approval');
    await expect(approveButton(page)).toBeEnabled();
  });

  test('explains an unknown sync and retries it', async ({ page }) => {
    seed({ op: 'observe', pull: pull(7), sync: 'synced' });
    seed({ op: 'approve', repositoryId: 101, number: 7, ...OPERATOR, sync: 'unknown' });
    await page.route('**/api/github/reconcile', async (route) => {
      seed({ op: 'observe', pull: pull(7), sync: 'synced' });
      await route.fulfill({ status: 200, json: { result: 'synced' } });
    });
    await page.goto(DETAIL);

    await expect(approvalBadge(page)).toHaveText('Sync unknown');
    await expect(page.getByText('may or may not have reached GitHub')).toBeVisible();
    await page.getByRole('button', { name: 'Retry sync' }).click();
    await expect(approvalRegion(page).getByRole('status')).toContainText('Sync finished');
    await expect(approvalBadge(page)).toHaveText('Approved');
  });

  test('disables approval for closed and merged pull requests', async ({ page }) => {
    seed({ op: 'observe', pull: pull(7, { state: 'closed' }) });
    seed({ op: 'observe', pull: pull(8, { state: 'merged' }) });

    await page.goto(DETAIL);
    await expect(approvalBadge(page)).toHaveText('Closed');
    await expect(
      page.getByText('This pull request is closed. Approval is disabled.'),
    ).toBeVisible();
    await expect(approveButton(page)).toHaveCount(0);

    await page.goto('/pulls/101/8');
    await expect(approvalBadge(page)).toHaveText('Merged');
    await expect(approveButton(page)).toHaveCount(0);
  });
});
