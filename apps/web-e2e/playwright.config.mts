import { generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// 3000번의 일반 `pnpm dev`(다른 데이터로 떠 있을 수 있음)를 재사용하지 않도록 e2e 전용 포트를 쓴다.
const PORT = 3200;
const localURL = `http://localhost:${PORT}`;
// BASE_URL을 주면 이미 떠 있는(배포된) 서버를 본다. 그때는 로컬 서버를 띄우지 않는다.
const liveURL = process.env['BASE_URL'];
const baseURL = liveURL || localURL;

/**
 * 수동 승인 E2E용 서버 설정. `E2E_DATABASE_URL`(전용 테스트 DB)이 있을 때만 붙인다.
 * GitHub App 값은 형식만 맞춘 테스트 값이다 — spec은 GitHub를 부르는 요청을 브라우저 경계에서 가로채고,
 * 서버까지 가는 요청은 인증 단계(401 · 403)에서 끝나는 것만 보낸다.
 */
function approvalEnv(databaseUrl: string): Record<string, string> {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    DATABASE_URL: databaseUrl,
    GITHUB_APP_CLIENT_ID: 'Iv1.e2e',
    GITHUB_APP_CLIENT_SECRET: 'e2e-client-secret',
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    GITHUB_WEBHOOK_SECRET: 'e2e-webhook-secret',
    GITHUB_INSTALLATION_ID: '5',
    GITHUB_ALLOWED_REPOSITORY_IDS: '101,102',
    APPROVER_GITHUB_IDS: '42',
    PUBLIC_BASE_URL: localURL,
  };
}

const approvalDatabase = process.env['E2E_DATABASE_URL'];

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: liveURL
    ? undefined
    : {
        // nx를 거치지 않고 Playwright가 직접 띄운다. 그래야 fixture env가 Next에 전달되고,
        // 테스트가 끝날 때 서버도 함께 종료된다 (nx 경유 시 next dev가 고아 프로세스로 남았다).
        command: `pnpm --dir apps/web exec next dev --port ${PORT}`,
        url: localURL,
        reuseExistingServer: false,
        cwd: workspaceRoot,
        env: {
          REVIEW_DATA_DIR: join(workspaceRoot, 'fixtures/visual/review-data'),
          ...(approvalDatabase ? approvalEnv(approvalDatabase) : {}),
        },
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
