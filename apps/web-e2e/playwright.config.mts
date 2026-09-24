import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// 3000번의 일반 `pnpm dev`(다른 데이터로 떠 있을 수 있음)를 재사용하지 않도록 e2e 전용 포트를 쓴다.
const PORT = 3200;
const baseURL = process.env['BASE_URL'] || `http://localhost:${PORT}`;

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    // nx를 거치지 않고 Playwright가 직접 띄운다. 그래야 fixture env가 Next에 전달되고,
    // 테스트가 끝날 때 서버도 함께 종료된다 (nx 경유 시 next dev가 고아 프로세스로 남았다).
    command: `pnpm --dir apps/web exec next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    cwd: workspaceRoot,
    env: { REVIEW_DATA_DIR: join(workspaceRoot, 'fixtures/visual/review-data') },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
