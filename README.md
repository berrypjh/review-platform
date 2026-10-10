# review-platform

다른 저장소의 변경을 사람이 검토할 수 있게 증거를 수집하고 보여 주는 플랫폼.

- **Storybook Visual Regression** — 외부 Storybook의 story를 Chromium으로 찍고 baseline과 current를 픽셀 단위로 비교해 diff와 `run.json`을 만들고, Review UI에서 봄
- **PR 수동 승인** — GitHub App으로 PR에 전용 Check를 붙이고 Review UI(`/pulls`)에서 승인

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

## 시작하기

Node 24.20.0(`.nvmrc`), pnpm 11.25.0

```bash
nvm use
pnpm install
pnpm exec playwright install chromium
REVIEW_DATA_DIR=fixtures/visual/review-data pnpm dev   # http://localhost:3000
```

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm tools:check   # tools/ (Nx 프로젝트 아님)
pnpm test:hooks    # .claude/hooks/
pnpm e2e           # Playwright
```

## 라이선스

MIT
