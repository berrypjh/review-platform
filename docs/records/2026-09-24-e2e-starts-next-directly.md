# E2E 서버를 nx 대신 Playwright가 직접 띄우도록 변경

`apps/web-e2e/playwright.config.mts`의 webServer는 `pnpm --dir apps/web exec next dev --port 3200`. fixture env가 Next에 전달되고, 테스트가 끝나면 서버도 종료됨.

## 상황

- e2e는 webServer `env`로 `REVIEW_DATA_DIR`를 넘김
- `@nx/playwright`는 webServer에 `env`가 있으면 Nx task로 관리하지 않고 Playwright에 맡김(`getWebserverCommandTasks`)
- `nx run web:dev`를 거치면 Playwright의 종료 신호가 `next dev`까지 가지 않아 고아 프로세스가 포트를 잡음

## 판단

- **nx를 거치지 않음** — Playwright가 `next dev`를 직접 소유
- **전용 포트 3200 · `reuseExistingServer: false`** — 3000번의 일반 `pnpm dev`를 재사용하지 않음
- **env는 절대 경로** — `join(workspaceRoot, 'fixtures/visual/review-data')`

## 반영

- `apps/web-e2e/playwright.config.mts` — command · port · `reuseExistingServer` · `env`

## 검증

- 연속 5회 실행 모두 통과. 종료 뒤 `next dev` 프로세스 · 3200번 포트 점유 없음
