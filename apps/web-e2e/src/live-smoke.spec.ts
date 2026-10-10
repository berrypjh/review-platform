import { expect, test } from '@playwright/test';

/**
 * 배포 서버 읽기 전용 smoke. `LIVE_SMOKE=1 BASE_URL=https://…`일 때만 돈다 — 일반 실행 · CI에서는 skip.
 * PR을 만들거나 DB에 쓰지 않는다(로그인 시작 · 승인 · 재동기화를 부르지 않는다). 실제 승인 루프는 사람이 한다:
 * docs/manual-approval/setup.md.
 */
test.skip(
  process.env['LIVE_SMOKE'] !== '1' || !process.env['BASE_URL'],
  'Opt-in: LIVE_SMOKE=1 BASE_URL=https://<deployment> (docs/manual-approval/setup.md)',
);

test('serves the Visual runs page over HTTPS', async ({ page, baseURL }) => {
  expect(baseURL).toMatch(/^https:\/\//);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Visual runs' })).toBeVisible();
});

test('asks to sign in before showing pull requests', async ({ page }) => {
  await page.goto('/pulls');
  await expect(page.getByText('Sign in required')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
    'href',
    /^\/api\/auth\/github\/start\?returnTo=/,
  );
});

test('rejects a webhook with a wrong signature', async ({ request }) => {
  const response = await request.post('/api/github/webhook', {
    headers: {
      'x-github-event': 'ping',
      'x-github-delivery': 'live-smoke-wrong-signature',
      'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
      'content-type': 'application/json',
    },
    data: '{}',
  });
  expect(response.status()).toBe(401);
});

test('rejects an approval without a session', async ({ request, baseURL }) => {
  const response = await request.post('/api/pulls/1/1/approve', {
    headers: { origin: baseURL ?? '' },
    form: { csrf: 'none', expectedHeadSha: '0'.repeat(40), expectedRevision: '1' },
  });
  expect(response.status()).toBe(401);
});
