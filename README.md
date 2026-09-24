# review-platform

다른 저장소의 UI 변경을 사람이 검토할 수 있게 증거를 수집하고 보여 주는 플랫폼. 첫 기능은 **Storybook Visual Regression** — 외부 Storybook의 story를 Chromium으로 찍고, baseline과 current를 픽셀 단위로 비교해 diff와 `run.json`을 만들고, 로컬 Review UI에서 본다.

```
target manifest ─▶ capture(baseline) ─▶ capture(current) ─▶ compare ─▶ run.json ─▶ Review UI
                                                              └▶ diff/*.png
```

## 구조

| 위치                    | 스택                    | 역할                                 |
| ----------------------- | ----------------------- | ------------------------------------ |
| `apps/web`              | Next.js 16 (App Router) | Review UI                            |
| `apps/web-e2e`          | Playwright              | Review UI E2E                        |
| `libs/visual-contracts` | zod                     | artifact JSON 계약                   |
| `tools/visual`          | Node · Playwright       | capture · compare · summary CLI      |
| `fixtures/visual`       | —                       | manifest · fixture run               |
| `.github/workflows`     | GitHub Actions          | 다른 저장소의 PR이 호출하는 workflow |

Nx가 작업 orchestration을 담당한다. 검사 대상 저장소와는 코드로 연결하지 않고 Storybook URL과 story id만 주고받는다.

## 시작하기

필요한 것: Node 24.20.0 (`.nvmrc`), pnpm 11.25.0

```bash
nvm use
pnpm install
pnpm exec playwright install chromium   # Playwright 버전이 바뀔 때마다 한 번
```

Review UI는 `REVIEW_DATA_DIR`(기본 `.review-data`)의 run을 보여 준다. 커밋된 fixture로 바로 보려면:

```bash
REVIEW_DATA_DIR=fixtures/visual/review-data pnpm dev   # http://localhost:3000
```

실제 Storybook을 비교하는 순서는 [local-development.md](docs/development/local-development.md), shared-stack으로 돌려 보는 절차는 [shared-stack-dogfood.md](docs/integration/shared-stack-dogfood.md).

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm tools:check   # tools/ — Nx affected가 닿지 않는 영역
pnpm test:hooks    # .claude/hooks/
pnpm e2e           # Playwright (브라우저 필요)
```

명령별 대상과 테스트 현황은 [quality-gates.md](docs/engineering/quality-gates.md).

## 라이선스

MIT
