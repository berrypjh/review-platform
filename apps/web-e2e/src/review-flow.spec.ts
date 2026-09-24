import { expect, type Locator, type Page, test } from '@playwright/test';

// 커밋된 fixture run: fixtures/visual/review-data/runs/sample/run.json
const RUN = {
  id: 'sample',
  repository: 'berrypjh/shared-stack',
  baseSha: '7888724e59b35e45880c736f03b4ecf3215f8e78',
  headSha: '951cadd',
};

/** 이미지가 레이아웃만 잡힌 상태가 아니라 실제로 디코딩될 때까지 기다린다. */
async function expectLoaded(image: Locator) {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
}

/** target에 focus가 올 때까지 Tab을 누른다. `max`번 안에 도달하지 못하면 실패다. */
async function tabTo(page: Page, target: Locator, max = 25) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Not reachable with Tab within ${max} presses`);
}

const changesNav = (page: Page) => page.getByRole('navigation', { name: /Changes/ });
const activePanel = (page: Page) => page.getByRole('tabpanel');

test.describe('Runs page', () => {
  test('lists the fixture run with its repository and status as text', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Visual runs' })).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(RUN.id) });
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell', { name: RUN.repository })).toBeVisible();
    await expect(row.getByText('Review required')).toBeVisible();
  });

  test('opens a run from the keyboard', async ({ page }) => {
    await page.goto('/');

    const runLink = page.getByRole('link', { name: RUN.id, exact: true });
    await tabTo(page, runLink);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(`/runs/${RUN.id}`);
    await expect(page.getByRole('heading', { level: 1, name: `Run ${RUN.id}` })).toBeVisible();
  });
});

test.describe('Run review', () => {
  test('navigates from the runs list to the run and shows its SHAs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: RUN.id, exact: true }).click();

    await expect(page).toHaveURL(`/runs/${RUN.id}`);
    await expect(page.getByRole('heading', { level: 1, name: `Run ${RUN.id}` })).toBeVisible();
    await expect(page.getByText(RUN.baseSha, { exact: true })).toBeVisible();
    await expect(page.getByText(RUN.headSha, { exact: true })).toBeVisible();
  });

  test('lists both a changed and an unchanged target', async ({ page }) => {
    await page.goto(`/runs/${RUN.id}`);

    const nav = changesNav(page);
    await expect(nav.getByRole('link', { name: /Card \/ Default.*Changed/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Button \/ Primary.*Unchanged/ })).toBeVisible();
  });

  test('shows baseline, current and diff images for the changed target', async ({ page }) => {
    await page.goto(`/runs/${RUN.id}`);

    const changed = changesNav(page).getByRole('link', { name: /Card \/ Default/ });
    await expect(changed).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('heading', { level: 2, name: 'Card / Default' })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'Diff', selected: true })).toBeVisible();
    await expectLoaded(activePanel(page).getByRole('img', { name: /Card \/ Default: diff/ }));

    await page.getByRole('tab', { name: 'Baseline' }).click();
    await expectLoaded(activePanel(page).getByRole('img', { name: /baseline screenshot/ }));

    await page.getByRole('tab', { name: 'Current' }).click();
    await expectLoaded(activePanel(page).getByRole('img', { name: /current screenshot/ }));
  });

  test('says no diff was generated for the unchanged target', async ({ page }) => {
    await page.goto(`/runs/${RUN.id}`);
    await changesNav(page)
      .getByRole('link', { name: /Button \/ Primary/ })
      .click();

    await expect(page).toHaveURL(`/runs/${RUN.id}?change=button--primary`);
    await expect(page.getByRole('heading', { level: 2, name: 'Button / Primary' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Diff' })).toBeDisabled();
    await expect(
      page.getByText('No diff generated because baseline and current are identical.'),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Current', selected: true })).toBeVisible();
    await expectLoaded(activePanel(page).getByRole('img', { name: /current screenshot/ }));
  });

  test('reaches the changes, the screenshot tabs and full-size links with the keyboard', async ({
    page,
  }) => {
    await page.goto(`/runs/${RUN.id}`);

    await tabTo(page, changesNav(page).getByRole('link', { name: /Button \/ Primary/ }));

    const diffTab = page.getByRole('tab', { name: 'Diff' });
    await tabTo(page, diffTab);
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Current', selected: true })).toBeFocused();

    await tabTo(page, activePanel(page).getByRole('link', { name: /Open full size/ }));
  });
});
