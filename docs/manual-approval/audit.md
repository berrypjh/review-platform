# Manual Approval — Step 0 저장소 감사

세 저장소(shared-stack · it-tech-blog · snapdone)의 PR을 review-platform에서 수동 승인하고 전용 GitHub Check에 반영하는 최소 MVP의 실현 가능성 조사. 결론은 **가능하지만 승인 흐름의 구성 요소(GitHub App · webhook · 로그인 · DB · 호스팅)가 네 저장소 어디에도 없음**. 재사용할 수 있는 것은 review-platform의 Next 앱 골격 · zod 계약 방식 · harness뿐임.

- 조사일 — 2026-10-10
- 방식 — 로컬 작업 트리 읽기 + 비인증 GitHub REST API(공개 저장소). `gh` CLI 없음
- 하지 않은 것 — 구현 · 설치 · CI 변경 · Visual 실행 · 대상 저장소 수정 · App 생성 · 배포

## 1. 작업 트리 기준점

| 저장소          | 로컬 경로                             | branch       | HEAD                        | 미커밋 변경                                                           |
| --------------- | ------------------------------------- | ------------ | --------------------------- | --------------------------------------------------------------------- |
| review-platform | `~/Documents/project/review-platform` | `main`       | `aa774d6` (= `origin/main`) | 없음                                                                  |
| shared-stack    | `~/Documents/project/shared-stack`    | `main`       | `1cd182c`                   | 없음                                                                  |
| it-tech-blog    | `~/Documents/project/it-tech-blog`    | `main`       | `6783cbd5`                  | 없음                                                                  |
| snapdone        | `~/Documents/project/snapdone`        | `sentry-api` | `0804753`                   | **있음** — 수정 32개 · untracked 다수(Sentry · EAS Update). 읽기만 함 |

- **remote** — 네 곳 모두 `https://github.com/berrypjh/<name>.git` 확인
- **가시성** — 네 곳 모두 public (`GET /repos/berrypjh/<name>` → `"visibility":"public"`)
- **기존 산출물** — `docs/manual-approval/` 없음. 첫 실행으로 처리
- **snapdone 주의** — `.github/workflows/ci.yml`은 미커밋 diff에 없음. CI 관련 결론은 커밋된 HEAD와 같음

## 2. review-platform

### 현재 코드

- **Nx 프로젝트** — `visual-contracts` · `web-e2e` · `web` 셋 (`nx show projects`)
- **web target** — `build` · `dev` · `start` · `lint` · `test` · `typecheck` · `serve-static` 외 (`nx show project web`). `typecheck`은 `apps/web/package.json`에 직접 정의
- **화면** — `/`(`apps/web/src/app/page.tsx`) · `/runs/[runId]`(`apps/web/src/app/runs/[runId]/page.tsx`) · `/artifacts/[runId]/[...path]`(`route.ts`, PNG GET만)
- **데이터** — `apps/web/src/lib/review-data.ts`가 `REVIEW_DATA_DIR`(기본 `<root>/.review-data`)의 `runs/<id>/run.json`을 `fs`로 읽고 `VisualRunSchema`로 검증
- **status 표시** — `apps/web/src/lib/status-display.ts`. `passed` · `review-required` · `failed`와 change status만. 승인 상태 없음
- **계약** — `libs/visual-contracts/src/lib/visual-run.ts`. `VisualRun`에 `repository` · `baseSha` · `headSha`는 있으나 PR 번호 · 승인 필드 없음
- **UI 부품** — `apps/web/src/components/ui/`에 alert · badge · button · card · separator · skeleton · table · tabs · tooltip. form · input · dialog 없음
- **layout** — `apps/web/src/app/layout.tsx`. 로그인 · 사용자 표시 없음
- **next.config.js** — `agentRules: false` 하나. runtime · output 설정 없음
- **e2e** — `apps/web-e2e/playwright.config.mts`. fixture 데이터로 3200번에 `next dev`. review flow spec 하나
- **workflow** — `.github/workflows/visual-regression.yml`. `workflow_call` · `workflow_dispatch`. artifact 업로드 · step summary만. `checks: write` 없음
- **Actions 실행 기록** — 0건 (`GET /repos/berrypjh/review-platform/actions/runs` → `total_count: 0`). reusable workflow는 GitHub 위에서 한 번도 돌지 않음
- **ruleset** — 없음 (`GET .../rules/branches/main` → `[]`)

### 승인 · 인증 · DB 관련 코드

없음. [target-architecture.md](../architecture/target-architecture.md#무엇이-있고-무엇이-없는가)가 "영구 저장소, 승인 이력", "GitHub App · 인증", "PR 코멘트 · status check 이름"을 **없음**으로 명시하고, 코드도 그와 일치함.

### 버전 (실설치 기준, [target-architecture.md](../architecture/target-architecture.md#버전-정책))

- **Node** — 24.20.0 (`.nvmrc`), `engines.node >=24` (`package.json`)
- **pnpm** — 11.25.0 (`packageManager`)
- **Next** — `~16.3.6` · React 19.2.8 · Nx 23.2.1 · zod 4.6.5

### 이번 요구로 바뀌어야 할 서술 (이번 단계에서는 위치만 기록)

"web은 승인 · 저장하지 않는다"는 규칙이 아래에 있음. 명시적 요구에 따른 확장이므로 구현 Step에서 함께 고침.

- **`AGENTS.md`** — Repository Overview 표의 `web` 역할 "비교 · 승인 · 저장을 하지 않는다"
- **`.claude/rules/web.md`** — 첫 문단 "승인 · 저장을 하지 않는다", Data 절 "별도 API 서버 · DB · 승인 저장을 만들지 않는다", "파일을 읽는 코드는 `review-data.ts` 하나뿐"
- **`docs/architecture/target-architecture.md`** — "무엇이 있고 무엇이 없는가"의 영구 저장소 · 승인 · GitHub App · 인증 · status check 항목, "흐름"의 "명령 endpoint가 없다"
- **`docs/integration/pr-integration.md`** — "하지 않는다: … status check 이름 붙이기, … Review UI 호스팅, 승인 기록"
- **`apps/web/src/app/layout.tsx`** — metadata description "Local review UI"

### 이미 낡은 서술

- **review-platform private 전제** — `docs/integration/pr-integration.md` §1과 `visual-regression.yml`의 `review-platform-token` 설명이 private을 전제로 함. 실제는 public. PAT 없이 `github.token`으로 checkout 가능해야 하나 Actions에서 실행하지 않았으므로 미검증

## 3. shared-stack

- **CI** — `.github/workflows/pr-check.yml`("PR Quality Check", `pull_request` → main, opened · synchronize · reopened). job 이름 = check 이름: `Derive NX base/head SHAs` · `Format Check (Prettier)` · `Lint (affected)` · `Typecheck (affected)` · `Unit Tests (affected)` · `Bundle Size (size-limit)` · `Accessibility (Storybook + axe)` · `Consumer Eval (deterministic)` · `Build (affected)`
- **기타 workflow** — `chromatic.yml`(`Run Chromatic`, secret `CHROMATIC_PROJECT_TOKEN`) · `release.yml`(`contents: write` · `packages: write`, secret `RELEASE_TOKEN`) · `consumer-eval-heldout.yml`(dispatch)
- **실제 Check 기록** — PR #14 head `a329449` check-run 10건 모두 `github-actions` app, success ([PR #14](https://github.com/berrypjh/shared-stack/pull/14))
- **ruleset** — id 15386561: deletion · non_fast_forward · pull_request(승인 0명). **required status check 없음** (`GET /repos/berrypjh/shared-stack/rules/branches/main`)
- **review-platform 호출** — 없음. `rg -i 'review-platform'` 0건. `checks: write` · statuses API도 0건
- **Storybook** — `@berrypjh/react-ui` · `@berrypjh/devhub-ui`에 `storybook` · `build-storybook` 등(`@nx/storybook/plugin` 추론, `nx.json:111`). 출력 `{projectRoot}/storybook-static`. Storybook 10.6.0
- **호스팅** — `apps/demo-web/vercel.json` · `apps/devhub/vercel.json`(Vite SPA, `dist`). Storybook 호스팅은 Chromatic뿐. 배포 URL은 문서 · 설정 어디에도 없음
- **버전** — `packageManager` · `engines` · `.nvmrc` 없음. CI는 `vars.NODE_VERSION` · `vars.PNPM_VERSION`(값 확인 불가). Next 미사용
- **승인 · 인증 · DB · webhook** — 없음 (`rg -l -i 'webhook|github app|octokit|oauth|next-auth|authjs|prisma|drizzle|supabase|postgres|sqlite|approval|approve'` 0건)
- **변경 정책** — `AGENTS.md` Git Safety: workflow 파일 수정은 명시적 요청 시에만

## 4. it-tech-blog

- **CI** — `.github/` 디렉터리 자체가 없음. workflow · check 없음
- **PR** — 0건 (`GET /repos/berrypjh/it-tech-blog/pulls?state=all` → `[]`)
- **ruleset** — 없음 (`.../rules/branches/main` → `[]`)
- **Storybook** — `apps/storybook`(`@it-tech-blog/storybook`, `project.json`의 `nx:run-commands`). `build-storybook` → `apps/storybook/storybook-static`. story 출처 `packages/ui/src/**` · `apps/react-deep-dive-zone/src/**` (`apps/storybook/.storybook/main.ts`)
- **Next** — `apps/main-web/next.config.js` multi-zone(`ACCESSIBILITY_DOMAIN` · `REACT_DEEP_DIVE_DOMAIN` · `LLM_SYSTEM_DOMAIN` · `ENABLED_ZONES`). next 16.1.7 설치
- **버전** — `packageManager` · `engines` · `.nvmrc` 없음. Nx 22.6.5
- **호스팅** — `vercel.json` · Docker 없음. `nx-ignore` devDependency만 있어 Vercel 대시보드 연결 가능성 있음 — 확인 불가
- **패키지 레지스트리** — `.npmrc`가 `@berrypjh`를 GitHub Packages로 지정. CI 설치에 토큰 필요
- **승인 · 인증 · DB · webhook** — 없음 (octokit · webhook · oauth · prisma · postgres · approv 검색 0건)
- **변경 정책** — `AGENTS.md` Git Safety: CI · workflow 수정은 자동화 작업일 때만

## 5. snapdone

- **CI** — `.github/workflows/ci.yml`("CI", `pull_request` main · `push` main). job `checks` · `e2e` · `docker` · `deploy`(main push 전용, `needs: [checks, e2e, docker]`)
- **필수 Check** — ruleset id 24783824의 `required_status_checks`: `checks` · `e2e` · `docker`, 모두 `integration_id: 15368`(GitHub Actions), strict 아님. **참고 snapshot과 일치 — 보존 대상** (`GET /repos/berrypjh/snapdone/rules/branches/main`)
- **실제 Check 기록** — PR #1 head `75e82a8` → `checks` · `e2e` · `docker` success, `deploy` skipped ([PR #1](https://github.com/berrypjh/snapdone/pull/1))
- **permissions** — `contents: read` · `actions: read` · `packages: read`, deploy만 `id-token: write`. secret은 `GITHUB_TOKEN`, vars `GCP_PROJECT_ID` · `GCP_WIF_PROVIDER` · `GCP_DEPLOY_SA`
- **인증** — `apps/api/internal/auth/` 존재(oauth.go · session.go · grant.go · handoff.go · crypto.go · store.go). **Google OAuth(PKCE) + DB opaque 세션**. GitHub 로그인 없음
- **DB** — PostgreSQL. `apps/api/internal/database/database.go`(pgx v5). migration `apps/api/internal/database/migrations/0001_auth.sql` ~ `0009_*.sql`(`go:embed`), Cloud Run Job `api-migrate`(`apps/api/migrate-job.yaml`)
- **배포** — GCP Cloud Run `api` · `web`(asia-northeast3), Cloud SQL PG17, Secret Manager (`docs/development/deployment.md`, `tools/scripts/deploy.sh`, `apps/*/Dockerfile`)
- **Storybook** — 없음. Visual 검사 대상 아님 ([pr-integration.md](../integration/pr-integration.md)와 일치)
- **버전** — Node 24.14.0(`.nvmrc`) · pnpm 10.30.3 · Nx 23.1.1 · Next ~16.1.6 · Go 1.26.6
- **PR 승인 · webhook · Checks API** — 없음 (`rg -i 'checks api|check[-_ ]run|github app|webhook|octokit|pull_request_review|approv'`, 무관한 indirect 의존 · 문자열만)

## 6. 구성 요소별 상태

| 구성 요소                         | 상태          | 근거                                                                                     |
| --------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| Next App Router 골격 · shadcn UI  | 재사용 가능   | `apps/web/src/app/*`, `components/ui/*`                                                  |
| zod 계약 · `z.infer` 방식         | 재사용 가능   | `libs/visual-contracts` — 승인 계약은 별도 schema로 추가                                 |
| status 표시 패턴(아이콘 + 텍스트) | 재사용 가능   | `lib/status-display.ts`, `components/review/status-badge.tsx`                            |
| Visual run 표시 · artifact route  | 재사용 가능   | 승인과 독립. 단, hosted 환경에는 `run.json`이 없음 (아래 경계)                           |
| PR 이벤트 수신(webhook)           | 신규 필요     | 네 저장소 모두 없음                                                                      |
| 전용 Check 생성 · 갱신            | 신규 필요     | 어느 workflow에도 `checks: write` · Checks API 호출 없음                                 |
| GitHub App                        | 신규 필요     | 코드 없음. 생성 · 설치 여부는 확인 불가                                                  |
| GitHub 로그인 · 세션              | 신규 필요     | review-platform 없음. snapdone은 Google OAuth라 재사용 불가(다른 저장소 · 다른 provider) |
| 승인 DB · migration               | 신규 필요     | review-platform 없음                                                                     |
| 호스팅(review-platform)           | 신규 필요     | 배포 설정 없음. `nx build web`도 AI 세션에서 실행 불가                                   |
| snapdone 필수 Check 3종           | 구현됨 · 보존 | ruleset 24783824                                                                         |
| Secrets · App 설치 · Vercel 연결  | 확인 불가     | 코드로 확정할 수 없음. 비인증 API로는 조회 불가                                          |

## 7. 시나리오 평가

| 단계            | 현재 코드로 충족 | 필요한 것                                                                               |
| --------------- | ---------------- | --------------------------------------------------------------------------------------- |
| 새 PR 감지      | 아니오           | App webhook `pull_request.opened` 수신 · 서명 검증                                      |
| 대기 Check 생성 | 아니오           | App installation token으로 `POST /repos/{o}/{r}/check-runs`(head SHA, `in_progress` 등) |
| GitHub 로그인   | 아니오           | GitHub App user authorization(OAuth) + 세션 쿠키                                        |
| 수동 승인       | 아니오           | 승인 화면 · server action · 승인 권한 판정(누가 승인할 수 있나는 Step 1 결정)           |
| DB 보존         | 아니오           | `(repo, pr, head_sha)` 단위 승인 레코드                                                 |
| Check Success   | 아니오           | `PATCH /check-runs/{id}` → `completed` · `success`                                      |
| 새 SHA 재승인   | 아니오           | `pull_request.synchronize` → 새 head SHA에 새 대기 Check. 이전 승인은 SHA가 달라 무효   |
| Closed 비활성화 | 아니오           | `pull_request.closed` → PR 비활성 표시, 승인 버튼 차단                                  |

shared-stack의 `pr-check.yml`은 `closed`를 받지 않음. 기존 workflow로는 6 · 7 · 8단계를 대신할 수 없음.

## 8. 최소 구성안

```
GitHub (3 repo, App 설치)
  └─ webhook: pull_request (opened · reopened · synchronize · closed)
        ↓
review-platform web (Next, Node runtime)
  ├─ POST /api/github/webhook   서명 검증 → PR · SHA 기록 → 대기 Check 생성
  ├─ /login · /auth/callback    GitHub 사용자 인증 → 세션
  ├─ /approvals                 열린 PR 목록 · 승인 버튼
  └─ server action approve      DB 기록 → Check success
        ↓
managed PostgreSQL              pull_requests · approvals (head_sha 단위)
```

- **Check 쓰기 주체는 GitHub App** — Checks API 쓰기는 App 토큰만 가능. Actions `GITHUB_TOKEN`은 workflow 실행 중에만 유효해 사람이 나중에 승인하는 흐름에 맞지 않음
- **Check 이름은 고유하게** — 기존 `checks` · `e2e` · `docker` · `Run Chromatic` 등과 겹치지 않는 이름(예: `review-platform/approval`)
- **대상 저장소 workflow 변경 없음** — App webhook으로 충분. 세 저장소의 Git Safety 정책과도 맞음
- **required 지정은 사용자 설정** — 새 Check를 ruleset에 넣을지는 별도 결정. snapdone의 기존 3종은 그대로 둠

### Visual 결과(fs)와 승인 DB의 경계

- **Visual** — 지금처럼 `REVIEW_DATA_DIR`의 `run.json`을 읽기만 함. 계약 · `deriveRunStatus` 변경 없음
- **승인** — 새 DB. `run.json`을 고치지 않고, Visual status를 승인 판단에 쓰지 않음(도구는 판단하지 않는다는 원칙 유지)
- **연결 키** — `repository` + `headSha`. `VisualRun`에 이미 있음. PR 번호는 run id `pr-<번호>` 관례뿐이라 계약 필드가 아님
- **hosted 제약** — Vercel 배포본에는 `.review-data`가 없음. MVP에서 승인 화면은 Visual 증거 없이 PR 링크 · Actions artifact 링크만 보여 주는 것이 최소. Visual run의 원격 보관은 범위 밖

### 호스팅 후보

| 후보                                             | 장점                                                              | 걸리는 점                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Vercel Node runtime + managed PG                 | Next 16 기본 대상. shared-stack이 이미 Vercel 설정을 씀           | pnpm 11.25 · Node 24 지원 여부 Step 1에서 Vercel 문서로 확인 필요. 계정 · 프로젝트 연결 확인 불가 |
| GCP Cloud Run + Cloud SQL (snapdone과 같은 방식) | 실제로 운영 중인 유일한 호스팅. Dockerfile · deploy 스크립트 선례 | snapdone 프로젝트 · DB를 공유하면 경계가 무너짐. 별도 프로젝트면 설정량이 Vercel보다 큼           |

- **기본 권고** — Vercel + 별도 managed PostgreSQL. snapdone 인프라와 공유하지 않음
- **버전 호환** — Next `~16.3.6`, Node `>=24`, pnpm 11.25.0. Vercel 쪽 지원은 문서 확인 전까지 확인 불가

## 9. 새 의존성

AGENTS.md 순서(기존 → 표준 → platform SDK → 신규)로 본 결과.

| 필요                                 | 기존 · 표준 · SDK로 되는가                                 | 신규 후보                                                                    |
| ------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| webhook 서명 검증                    | 됨 — `node:crypto` HMAC-SHA256 + `timingSafeEqual`         | 없음                                                                         |
| App JWT(RS256)                       | 됨 — `node:crypto` `createSign`                            | 없음 (`@octokit/app`은 편의일 뿐)                                            |
| installation token · Checks API 호출 | 됨 — `fetch`                                               | 없음 (`@octokit/rest`는 편의일 뿐)                                           |
| GitHub OAuth · 세션                  | 됨 — `fetch` + `next/headers` cookies + `node:crypto` 서명 | 선택: Auth.js(검토만, 기본은 미도입)                                         |
| 입력 검증                            | 됨 — 기존 `zod`                                            | 없음                                                                         |
| **PostgreSQL 접속**                  | **안 됨** — Node · Next에 PG 클라이언트 없음               | `postgres`(porsager) 또는 `pg`. 호스팅이 Neon이면 `@neondatabase/serverless` |
| migration                            | SQL 파일 + 작은 스크립트로 가능                            | 없음 (ORM 미도입)                                                            |

- **불가피한 신규 의존은 PG 드라이버 하나** — 선택은 호스팅 결정 뒤 Step 1에서 사용자 승인 후 설치
- **`@berrypjh/*` 추가 없음** — [기록](../records/2026-09-24-no-berrypjh-dependency.md) 유지

## 10. 장애물과 사용자 설정 항목

### 구현을 막는 항목

- **GitHub App 없음** — 이름 · 권한(Checks: write, Pull requests: read, Metadata: read) · webhook URL · 세 저장소 설치. App 생성은 사용자 작업
- **배포 URL 없음** — webhook · OAuth callback이 공개 URL을 요구. 로컬 개발은 터널 필요
- **DB 없음** — managed PostgreSQL 인스턴스 · 접속 문자열
- **승인 권한 기준 미정** — 누가 승인할 수 있는가(저장소 write 권한자? 지정 사용자?) 결정 필요
- **AI 세션 제약** — dev 서버 · `nx build web` · e2e는 hook이 거부. 화면 · 빌드 검증은 사용자 터미널

### 사용자 설정 항목 (코드로 확정 불가)

- **GitHub App** — 생성, private key · webhook secret · client id/secret 발급, 세 저장소 설치
- **Secrets** — 호스팅 환경변수(App id · private key · webhook secret · OAuth client · DB URL · 세션 키). 값은 어디에도 기록하지 않음
- **호스팅** — Vercel 프로젝트 생성 · 연결, managed PG 생성
- **ruleset** — 새 Check를 required로 넣을지 여부. snapdone 기존 3종 유지
- **낡은 문서 정리 여부** — review-platform이 public이 되었으므로 PAT 안내 제거 시점

## 11. 확인하지 못한 것

- **Secrets 실제 등록 여부** — 비인증 API로 조회 불가
- **GitHub App 설치 여부** — 조회 불가. 코드 흔적 없음
- **Vercel 프로젝트 연결** — 세 저장소 · review-platform 모두 확인 불가
- **shared-stack `vars.NODE_VERSION` · `vars.PNPM_VERSION` 값** — 조회 불가
- **ruleset 전체 설정** — branch rules 공개 endpoint로 본 결과만. bypass actor 등은 관리자 권한 필요
- **reusable workflow의 GitHub 실행** — Actions 기록 0건. 동작 미검증
