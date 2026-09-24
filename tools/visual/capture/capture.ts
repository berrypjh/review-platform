import { type Browser, chromium } from '@playwright/test';
import type { VisualTarget, VisualTargetManifest } from '@review-platform/visual-contracts';

import { artifactPath, resolveArtifact } from '../paths.ts';
import type { CaptureKind } from './args.ts';
import { joinTargetUrl } from './url.ts';

export type CaptureStage = 'navigate' | 'wait-root' | 'wait-fonts' | 'screenshot';

/** target 하나의 capture 실패. 어떤 target이 어느 단계에서 실패했는지 메시지에 담는다. */
export class CaptureError extends Error {
  constructor(
    readonly targetId: string,
    readonly stage: CaptureStage,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Target "${targetId}" failed at stage "${stage}": ${reason}`, { cause });
  }
}

async function stage<T>(targetId: string, name: CaptureStage, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new CaptureError(targetId, name, error);
  }
}

/**
 * target 하나를 새 browser context에서 찍는다. context 옵션(고정 viewport, DPR 1, light, reduced motion, UTC)과
 * 화면 준비 대기(#storybook-root 표시, document.fonts.ready)로 결정적인 결과를 만든다. 고정 sleep은 쓰지 않는다.
 */
async function captureTarget(
  browser: Browser,
  manifest: VisualTargetManifest,
  target: VisualTarget,
  baseUrl: URL,
  runRoot: string,
  kind: CaptureKind,
): Promise<string> {
  const url = joinTargetUrl(baseUrl, target.path);
  const path = resolveArtifact(runRoot, artifactPath(kind, target.id));
  const context = await browser.newContext({
    viewport: manifest.viewport,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  try {
    const page = await context.newPage();
    await stage(target.id, 'navigate', async () => {
      const response = await page.goto(url.href, { waitUntil: 'load' });
      if (!response?.ok())
        throw new Error(`HTTP ${response?.status() ?? 'no response'} for ${url.href}`);
    });
    await stage(target.id, 'wait-root', () =>
      page.locator('#storybook-root').waitFor({ state: 'visible' }),
    );
    await stage(target.id, 'wait-fonts', () =>
      page.evaluate(async () => void (await document.fonts.ready)),
    );
    await stage(target.id, 'screenshot', () =>
      page.screenshot({
        path,
        fullPage: false,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      }),
    );
    return path;
  } finally {
    await context.close();
  }
}

/** manifest의 target을 순서대로 Chromium에서 찍는다. 병렬로 찍지 않고, 첫 실패에서 멈춘다. */
export async function captureTargets(
  manifest: VisualTargetManifest,
  baseUrl: URL,
  runRoot: string,
  kind: CaptureKind,
): Promise<string[]> {
  const browser = await chromium.launch();
  try {
    const written: string[] = [];
    for (const target of manifest.targets) {
      written.push(await captureTarget(browser, manifest, target, baseUrl, runRoot, kind));
    }
    return written;
  } finally {
    await browser.close();
  }
}
