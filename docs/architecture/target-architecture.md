# Target Architecture

## 목표 구조

```
Nx Workspace (repository root)
├─ apps/web               Next.js + TypeScript — Review UI
├─ apps/web-e2e           Playwright
├─ libs/visual-contracts  zod — artifact 계약
├─ tools/visual           Node CLI — capture · compare · summary (Nx 프로젝트 아님)
├─ fixtures/visual        manifest · fixture run
├─ .github/workflows      reusable workflow
└─ docs/                  구조 · 개발 · 품질 · 연동 · 기록
```

## 현재 상태

| 영역                    | 상태                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nx workspace            | integrated, pnpm workspaces. project는 `web` · `web-e2e` · `visual-contracts`                                                                                            |
| `apps/web`              | App Router. `/`(Runs) · `/runs/[runId]`(Run Review) · `/artifacts/[runId]/[...path]`(PNG) · `/pulls`(수동 승인) · `/api/*`(승인 route). shadcn(radix-nova) + Tailwind v4 |
| `apps/web-e2e`          | Chromium 하나. fixture 데이터로 3200번 포트에 `next dev` 실행                                                                                                            |
| `libs/visual-contracts` | `VisualTargetManifest` · `VisualRun` · `VisualChange` · `deriveRunStatus`. 의존은 zod 하나                                                                               |
| `tools/visual`          | `visual:capture`(Playwright) · `visual:compare`(pixelmatch) · `visual:summary`(Markdown)                                                                                 |
| `.github/workflows`     | `visual-regression.yml` — `workflow_call`로 호출 저장소 PR의 base/head를 비교하고 artifact 업로드                                                                        |

project별 target은 `nx show project <이름>`이 기준.

실행 · 검증 명령은 [local-development.md](../development/local-development.md) · [quality-gates.md](../engineering/quality-gates.md).

## 흐름

```
libs/visual-contracts           zod 계약 한 벌 (React·Node·DOM 의존 없음)
        ▲                ▲
        │ 검증           │ 같은 schema로 검증
tools/visual                     apps/web (Next.js)
  capture → <data-dir>/runs/<id>/{baseline,current}/*.png
  compare → diff/*.png · run.json
  summary → Markdown (CI)        읽기: runs/*/run.json, 제공: artifacts/*.png
```

- **수집은 Node CLI, 표시는 web** — Visual에는 명령 endpoint 없음
- **`run.json`이 Visual 화면의 유일한 입력** — web은 mismatch를 다시 계산하지 않고 표시 형식만 바꿈
- **artifact 경로는 run 디렉터리 기준 상대 경로** — 디렉터리째 옮겨도 그대로 읽힘
- **한 run은 한 번만 비교** — `run.json` · `diff/`가 있으면 compare가 거부. capture는 이미 있는 출력 디렉터리를 거부

계약 상세는 [visual-contracts.md](./visual-contracts.md).

## 경계

이 저장소는 검사받는 저장소를 **데이터로만** 앎.

| 방향                                 | 무엇이 오가나                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| 검사 대상 → review-platform          | 없음                                                                            |
| review-platform → 검사 대상 (검사)   | Storybook base URL, story id (manifest)                                         |
| review-platform → 검사 대상 (패키지) | **없음.** `@berrypjh/*`를 포함해 검사 대상이 publish하는 패키지에 의존하지 않음 |

- lint · prettier · tsconfig 설정은 이 저장소 안에 직접 둠 ([기록](../records/2026-09-24-no-berrypjh-dependency.md))
- target manifest는 검사받는 저장소가 소유. 이 저장소의 `fixtures/visual/targets/`는 dogfooding · workflow 시험용

## 버전 정책

| 항목         | 버전                              |
| ------------ | --------------------------------- |
| Node         | 24.20.0 (`.nvmrc`)                |
| pnpm         | 11.25.0 (`packageManager`)        |
| Nx           | 23.2.1 (`nx`와 모든 `@nx/*` 동일) |
| Next.js      | 16.3.6                            |
| React        | 19.2.8 (정확히 고정)              |
| TypeScript   | 6.0.3                             |
| Tailwind CSS | 4.3.3                             |
| shadcn       | 4.21.0 (radix-nova)               |
| ESLint       | 9.39.5                            |
| Prettier     | 3.9.9                             |
| Vitest       | 4.1.11                            |
| Playwright   | 1.63.0                            |
| zod          | 4.6.5                             |
| postgres     | 3.4.9 (`apps/web`, 정확히 고정)   |
| pixelmatch   | 7.2.0 · pngjs 7.0.0               |

- **Nx** — `nx`와 모든 `@nx/*`는 같은 버전. 변경은 `nx migrate`로만
- **React** — root · `apps/web` 모두 `19.2.8` 정확히 고정
- **TypeScript 6.0.x** — `typescript-eslint` 8.70의 peer가 `<6.1.0`
- **Vitest 4.x** — `@nx/vitest` 23.2.1의 peer가 `^3 || ^4`
- **Playwright** — 비교가 정확 일치(pixelmatch `threshold: 0`)라 버전 변경 시 baseline 재촬영 필요

## 무엇이 있고 무엇이 없는가

있음:

- capture — 외부 Storybook URL의 story 촬영. 고정 viewport · DPR 1 · animation 비활성 · caret 숨김, `#storybook-root` 표시와 `document.fonts.ready` 대기
- compare — pixelmatch 정확 일치, diff PNG, schema로 검증한 `run.json`(임시 파일 → rename)
- summary — `run.json`을 Markdown 표로, `--fail-on`으로 종료 코드 결정
- Review UI — Runs 목록, Run Review(change 목록 · Baseline/Current/Diff 탭 · 좌우 비교), loading · empty · 오류 상태, artifact PNG 제공(데이터 디렉터리 밖 차단)
- reusable workflow — 호출 저장소 PR의 base/head Storybook build · 비교 · artifact 업로드 · step summary
- PR 수동 승인 — GitHub App webhook · 전용 Check `Review Platform / Manual Approval` · GitHub 로그인 · 전용 PostgreSQL · `/pulls` 화면. Visual과 분리, `run.json`을 고치지 않음 ([architecture.md](../manual-approval/architecture.md))

없음:

- Visual 결과의 PR 코멘트 · status check
- baseline 보관 — PR마다 base를 다시 build
- hosted Storybook
- Visual 결과의 영구 저장 · accept/reject 이력
- 허용치(threshold) 설정 — 비교는 정확 일치뿐
- Storybook이 없는 저장소 검사 — capture가 `#storybook-root`를 기다림
- 배포 설정 파일(`vercel.json` 등)
