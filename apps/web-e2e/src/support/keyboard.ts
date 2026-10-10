import type { Locator, Page } from '@playwright/test';

/** target에 focus가 올 때까지 Tab을 누른다. `max`번 안에 도달하지 못하면 실패다. */
export async function tabTo(page: Page, target: Locator, max = 25) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Not reachable with Tab within ${max} presses`);
}
