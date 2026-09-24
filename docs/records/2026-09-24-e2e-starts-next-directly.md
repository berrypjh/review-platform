# E2E 서버를 nx 대신 Playwright가 직접 띄우도록 변경

`apps/web-e2e/playwright.config.mts`의 webServer를 `pnpm exec nx run web:dev`에서 `pnpm --dir apps/web exec next dev --port 3200`으로 변경. fixture env가 Next에 닿고, 테스트가 끝나면 서버도 함께 종료됨.

## 상황

- e2e가 fixture run을 보려면 `next dev`에 `REVIEW_DATA_DIR`를 넘겨야 함. webServer의 `env`로 넣음
- 그 뒤 e2e가 끝나도 `next dev`가 고아 프로세스로 남아 3000번 포트를 잡고, 다음 e2e가 10분 넘게 멈춤
- `@nx/playwright` plugin source(`getWebserverCommandTasks`): webServer에 `env`가 있으면(`hasEnv`) Nx task로 관리하지 않고 Playwright에 맡김. Playwright의 종료 신호가 nx를 거쳐 실행된 `next dev`까지 전달되지 않음

## 판단

- **nx를 거치지 않음** — Playwright가 자식 프로세스를 직접 소유해야 종료가 전달됨
- **전용 포트 3200** — 3000번의 일반 `pnpm dev`(다른 데이터로 떠 있을 수 있음)를 재사용하지 않음. `reuseExistingServer: false`
- **절대 경로로 env 전달** — `join(workspaceRoot, 'fixtures/visual/review-data')`

## 반영

- `apps/web-e2e/playwright.config.mts` — command · port · `reuseExistingServer` · `env`
- `apps/web-e2e/src/review-flow.spec.ts` — fixture run 기준 시나리오 7개

## 검증

- 연속 5회 실행 모두 7 passed. 끝난 뒤 `next dev` 프로세스와 3200번 포트 점유 없음
- 수정 전 상태를 재현: 고아 `next dev`(PID 86589)가 3000번을 잡고 있었고 `kill` 뒤 정상
