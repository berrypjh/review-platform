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

| 영역                    | 상태                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Nx workspace            | integrated, pnpm workspaces. project는 `web` · `web-e2e` · `visual-contracts` 셋                                                   |
| `apps/web`              | App Router. `/`(Runs) · `/runs/[runId]`(Run Review) · `/artifacts/[runId]/[...path]`(PNG 제공). shadcn(radix · nova) + Tailwind v4 |
| `apps/web-e2e`          | Chromium 하나. fixture 데이터로 3200번 포트에 `next dev`를 직접 띄운다                                                             |
| `libs/visual-contracts` | `VisualTargetManifest` · `VisualRun` · `VisualChange` · `deriveRunStatus`. 의존은 zod 하나                                         |
| `tools/visual`          | `visual:capture`(Playwright) · `visual:compare`(pixelmatch) · `visual:summary`(CI용 Markdown)                                      |
| `.github/workflows`     | `visual-regression.yml` — `workflow_call`로 다른 저장소의 PR에서 base/head를 비교하고 artifact로 올린다                            |

프로젝트 목록과 각 프로젝트의 실제 target은 `nx show projects` · `nx show project <이름>`이 기준이다. 이 문서에 목록을 박아두지 않는다.

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

- **수집은 Node, 표시는 브라우저.** 브라우저는 명령을 실행하지 않는다. Visual에는 명령 endpoint가 없다
- **`run.json`이 Visual 화면의 유일한 source of truth다.** web은 mismatch를 다시 계산하지 않고 표시 형식만 바꾼다
- **모든 artifact 경로는 run 디렉터리 기준 상대 경로다.** `run.json`에 절대 경로가 들어가지 않으므로 디렉터리째 옮기거나 artifact로 올려도 그대로 읽힌다
- **한 run은 한 번만 비교한다.** `run.json` · `diff/`가 있으면 compare가 거부한다. 다시 하려면 직접 지운다

계약의 상세는 [visual-contracts.md](./visual-contracts.md).

## 경계

이 저장소는 검사받는 저장소를 **데이터로만** 안다.

| 방향                                 | 무엇이 오가나                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| 검사 대상 → review-platform          | 없음. 그쪽은 이 저장소를 모른다                                                   |
| review-platform → 검사 대상 (검사)   | Storybook base URL, story id (manifest)                                           |
| review-platform → 검사 대상 (패키지) | **없음.** `@berrypjh/*`를 포함해 검사 대상이 publish하는 패키지에 의존하지 않는다 |

검사하는 쪽이 검사받는 쪽에 기대면 검사 대상의 결함이 도구까지 깨뜨리고, 패키지 업그레이드가 "검사 대상 변경"인지 "도구 변경"인지 구분되지 않는다. lint · prettier · tsconfig 설정도 이 저장소 안에 직접 둔다 ([기록](../records/2026-09-24-no-berrypjh-dependency.md)).

target manifest는 검사받는 저장소가 소유한다. story 이름을 바꾸는 PR이 manifest도 같은 PR에서 고칠 수 있어야 하기 때문이다. 이 저장소의 `fixtures/visual/targets/`는 dogfooding · workflow 시험용이다.

## 버전 정책

아래는 전부 실제 설치된 것을 읽은 값이다.

| 항목         | 버전                              |
| ------------ | --------------------------------- |
| Node         | 24.20.0 (`.nvmrc`)                |
| pnpm         | 11.25.0 (`packageManager`)        |
| Nx           | 23.2.1 (`nx`와 모든 `@nx/*` 동일) |
| Next.js      | 16.3.6                            |
| React        | 19.2.8 (정확히 고정)              |
| TypeScript   | 6.0.3                             |
| Tailwind CSS | 4.3.3                             |
| shadcn       | 4.21.0 (radix, nova preset)       |
| ESLint       | 9.39.5                            |
| Prettier     | 3.9.9                             |
| Vitest       | 4.1.11                            |
| Playwright   | 1.63.0                            |
| zod          | 4.6.5                             |
| pixelmatch   | 7.2.0 · pngjs 7.0.0               |

`nx`와 모든 `@nx/*` 플러그인은 **정확히 같은 버전**이어야 한다. 버전 변경은 `nx migrate`로만 한다.

**React는 root · `apps/web` 모두 `19.2.8`로 정확히 고정한다.** 검사 대상 저장소들(shared-stack · snapdone)이 19.2 라인이라 같은 major · minor를 유지한다. 19.3은 나온 지 얼마 되지 않아 보류했다.

**TypeScript는 6.0.x에 머문다.** `typescript-eslint` 8.70의 peer가 `< 6.1.0`이라 7.x를 쓸 수 없다. **Vitest는 4.x에 머문다.** `@nx/vitest` 23.2.1의 peer가 `^3 || ^4`다. **ESLint는 9.x에 머문다.** Nx flat config가 9 기준이다.

Playwright 버전을 올리면 Chromium build가 바뀌어 **모든 target이 `changed`가 될 수 있다.** 비교가 정확 일치이기 때문이다. 올릴 때는 baseline을 다시 찍는다.

## 무엇이 있고 무엇이 없는가

구현된 것:

- capture — 외부 Storybook URL의 story를 결정적으로 찍는 CLI. 고정 viewport · DPR 1 · animation 비활성 · caret 숨김, `#storybook-root`와 `document.fonts.ready`만 기다림
- compare — pixelmatch 정확 일치, diff PNG, schema로 검증한 `run.json`(임시 파일 → rename)
- summary — `run.json`을 Markdown 표로, `--fail-on`으로 CI 성패
- Review UI — Runs 목록, Run Review(change 목록 · Baseline/Current/Diff 탭 · 좌우 비교), loading · empty · 오류 상태, artifact PNG 제공(데이터 디렉터리 밖 차단)
- reusable workflow — 다른 저장소의 PR에서 base/head Storybook을 build · 비교하고 artifact 업로드 · step summary
- shared-stack Button story로 실제 dogfooding 완료 (2026-09-24)

아직 구현하지 않은 것:

- PR 코멘트 · status check 이름
- baseline 보관 (지금은 PR마다 base를 다시 build)
- hosted Storybook · hosted Review UI
- 영구 저장소, 승인(accept · reject) 이력
- GitHub App · 인증
- 허용치(threshold) 설정 — 비교는 정확 일치뿐
- Storybook이 없는 저장소(snapdone) 검사 — capture가 `#storybook-root`를 기다린다
- 두 번째 기능(예: 패키지 호환성 검사). 첫 기능을 실제로 쓴 뒤에 판단한다

**이 목록은 "예정"이 아니라 "없음"이다.** 위 기능과 관련된 코드는 저장소에 존재하지 않는다.

일부만 구현된 것:

- PR 수동 승인 — GitHub App 하나 · 전용 Check `Review Platform / Manual Approval` · GitHub 로그인 · 전용 PostgreSQL. 위 목록의 status check · 영구 저장소 · GitHub App · 인증 · hosted Review UI 중 승인에 필요한 만큼만 다룬다. Visual 흐름과 분리되어 `run.json`을 고치지 않는다. GitHub App webhook · Check 쓰기 · GitHub 로그인 · 승인 · 재동기화 API까지 구현, 화면 없음, 실제 GitHub · 배포 검증 전 ([architecture.md](../manual-approval/architecture.md))
