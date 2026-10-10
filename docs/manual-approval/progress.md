# Manual Approval — 진행 기록

PR 수동 승인 · 전용 GitHub Check MVP의 단계별 진행 상황. 조사 결과는 [audit.md](audit.md), 설계는 [architecture.md](architecture.md).

## 단계

| Step | 내용                                  | 상태    | 날짜       |
| ---- | ------------------------------------- | ------- | ---------- |
| 0    | 저장소 감사 · 실현 가능성             | 완료    | 2026-10-10 |
| 1    | Integration Architecture              | 완료    | 2026-10-10 |
| 2    | 도메인 · DB 기반                      | 완료    | 2026-10-10 |
| 3    | GitHub 연동 · 로그인 · 승인 API       | 완료    | 2026-10-10 |
| 4    | Review Platform UI(화면)              | 완료    | 2026-10-10 |
| 5    | 배포 설정 · 대상 저장소 연결 절차     | 완료    | 2026-10-10 |
| 6    | E2E 검증 — 로컬 완료, 실제 GitHub 0/3 | 진행 중 | 2026-10-10 |

## Step 0 — 저장소 감사

- **결론** — 가능. 단 webhook · Check 쓰기 · GitHub 로그인 · 승인 DB · 호스팅이 네 저장소 모두 없음
- **재사용** — review-platform의 Next 골격 · shadcn UI · zod 계약 방식 · status 표시 패턴
- **보존** — snapdone 필수 Check `checks` · `e2e` · `docker`(ruleset 24783824). snapdone `sentry-api` 미커밋 변경은 읽기만 함
- **변경 파일** — `docs/manual-approval/audit.md` · `docs/manual-approval/progress.md`
- **실행하지 않음** — 구현 · 설치 · CI 변경 · Visual 검사 · App 생성 · 배포 · commit

## Step 1 — Integration Architecture

- **결론** — 기존 `apps/web`에 GitHub App 기반 수동 승인을 넣는 설계 확정. DB · GitHub은 lease · CAS · outbox · 재동기화로 수렴, 원자성 주장 없음
- **대조** — Step 0 이후 코드 변경 없음(`aa774d6`, 미커밋은 `docs/manual-approval/`뿐). audit의 Nx 프로젝트 · target · 버전 그대로
- **Next 확인** — 설치된 16.3.6 문서 기준. runtime 기본 `nodejs` · edge deprecated, webhook은 `request.text()`, route handler POST는 Origin 자동 비교 없음, `server-only`는 설치 불필요
- **GitHub 확인** — check run 생성은 App만, webhook 10초 · 자동 재전송 없음 · Redeliver는 같은 delivery ID, App user token은 PKCE S256 · 8시간 만료 · `github_app_authorization` revoked
- **규칙 갱신** — `AGENTS.md` · `.claude/rules/web.md` · `docs/architecture/target-architecture.md`에 승인 예외와 경계 추가. Visual 읽기 전용 원칙 유지. permission · hook 변경 없음
- **변경 파일** — `docs/manual-approval/architecture.md`(신규) · `progress.md` · `AGENTS.md` · `.claude/rules/web.md` · `docs/architecture/target-architecture.md`
- **실행하지 않음** — 구현 · 설치 · 테스트 추가 · App 생성 · 배포 · commit

## Step 2 — Approval Domain & Persistence

- **결론** — 승인 저장 계층을 실제 PostgreSQL 17에서 검증. GitHub adapter가 쓸 계약(`ObservedPullRequest` · `SyncIntent` · `Claim` · `recordSyncResult`) 준비
- **대조** — 시작 시 코드는 `aa774d6`과 같음. Step 0~1 문서 변경(미커밋)은 보존
- **DB 모델** — `pull_requests` · `revisions` · `pull_request_claims` · `webhook_deliveries` · `sessions` · `oauth_transactions`. claim을 `pull_requests`에서 분리 — PR 행이 생기기 전(첫 webhook)에도 잡아야 함
- **설계 변경** — base branch 변경은 새 generation 조건에서 제외(요구는 새 HEAD · 재오픈뿐). `needs_refresh` 열은 Step 3에서 필요할 때 추가
- **불변식 위치** — generation 판정 · 승인 판정 · 표시 상태는 `state.ts` 순수 함수. unique · 결합 CHECK · 같은 PR revision FK는 SQL. 직렬화는 claim + `FOR UPDATE` + version CAS
- **재사용** — Vitest · Nx target · zod `strictObject` · `discriminatedUnion` 관례. Visual(`review-data.ts` · `visual-contracts`)은 건드리지 않음
- **Postgres.js 설정 근거** — `sslmode=require`는 인증서 미검증(`node_modules/postgres/src/connection.js:283`), 옵션이 URL query보다 우선(`src/index.js` `parseOptions`), 모르는 query는 startup parameter로 전달
- **실패 확인(mutation)** — sync CAS 조건을 지우면 `discards a late result…` 실패. claim 만료 조건을 지우면 처음엔 통과 → `refuses writes from an expired claim…` 추가 후 실패 확인
- **막힌 것** — web 앱의 env 예시 파일 쓰기는 permission 설정이 거부. env 이름 · 예시는 [architecture.md §10 · §16](architecture.md#16-로컬-db)에 둠. `.gitignore`에 `.env*` · `!.env.example` 추가

### 변경 파일

- 신규 — `apps/web/db/migrations/0001_manual_approval.sql`, `apps/web/vitest.db.config.mts`, `apps/web/src/lib/manual-approval/{schema,state,repository,deliveries}.ts`, `apps/web/src/lib/auth/store.ts`, `apps/web/src/lib/db/{config,client,transaction,migrate,migrate-cli,test-database}.ts`, 테스트 `state.test.ts` · `config.test.ts` · `*.db-test.ts` 4개
- 수정 — `apps/web/package.json`(`postgres` 3.4.9 · `zod` ^4.6.5 · `test-db` target), `pnpm-lock.yaml`(+12줄), `package.json`(`db:migrate`), `apps/web/tsconfig.json` · `tsconfig.spec.json`(`*.db-test.ts`), `.gitignore`, `.claude/rules/web.md`, `AGENTS.md`, `docs/architecture/target-architecture.md`, `docs/manual-approval/{architecture,progress}.md`

### 검증

| 명령                                                                              | 결과                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------- |
| `pnpm nx run-many -t lint typecheck test -p web visual-contracts --skip-nx-cache` | 통과                                      |
| `pnpm nx test web`                                                                | 57개 통과(기존 review-data · format 포함) |
| `TEST_DATABASE_URL=… pnpm nx test-db web` (PostgreSQL 17.11, Docker)              | 35개 통과                                 |
| `pnpm tools:check`                                                                | 49개 통과                                 |
| `pnpm test:hooks`                                                                 | 46개 통과                                 |
| `pnpm db:migrate` ×2 (`sslmode=require&channel_binding=require`를 붙인 URL)       | 1회차 적용, 2회차 up to date              |
| `TEST_DATABASE_URL` 없이 `nx test-db web`                                         | 건너뛰지 않고 실패                        |
| `DATABASE_URL` 없이 `pnpm db:migrate`                                             | `ConfigurationError`, 값 미노출           |

- **통합 테스트 범위** — migration 신규 · 재실행 · 동시 실행 · 실패 rollback · 기존 데이터 보존, PR · generation unique, 결합 CHECK, 같은 이벤트 반복, 저장소 이름 변경, A → B → A, close · reopen 이력, stale 승인 거부, 첫 결정 보존, 동시 승인, 연결 재생성 뒤 승인 유지, 동시 claim, claim 만료 · 회수 · fencing, claim 상실 시 rollback, stale sync 결과 거부, error · unknown은 approved 아님, DB 불가 시 예외, delivery 중복 · 재전송 · 버려진 시도 회수, 세션 철회 · 만료, OAuth state 1회 소비

### 실행하지 않은 것

- **`nx build web` · e2e** — hook이 막음. Visual 화면 import 경로에 DB 모듈이 없음은 검색으로만 확인(`apps/web/src/app` · `components`에서 `lib/(db|manual-approval|auth)` 0건). 사용자 터미널에서 `pnpm nx build web` · `pnpm e2e` 실행 필요
- **실제 Neon 접속** — TLS `verify-full` · pooler 호환은 Step 6
- **`import 'server-only'`의 Next build 동작** — typecheck만 통과. build는 위 실행에 포함

## Step 3 — GitHub Integration & GitHub Login

- **결론** — webhook → PR 등록 · 대기 Check → GitHub 로그인 → 승인 → 같은 HEAD Check success 흐름을 서버에 구현. 실제 테스트 PostgreSQL + 가짜 GitHub transport로 정상 · 장애 · 복구를 검증. **실제 GitHub · 배포에서는 실행하지 않음**
- **대조** — Step 2 산출물(migration 0001 · repository · 테스트 35개)이 실제로 있고 통과함을 먼저 확인
- **근거 문서** — REST `2026-03-10`(최신 지원 버전, breaking change 26건 중 사용 필드 해당 없음), App JWT(RS256 · `iat` −60초 · `exp` ≤10분 · `iss` client ID 권장), installation token(`repository_ids` · `permissions`로 범위 제한 · 1시간), Checks(App은 `queued` · `in_progress` · `completed`만), webhook(10초 · 자동 재전송 없음 · Redeliver는 같은 ID), App user token(PKCE S256). Next 16.3 번들 문서(route handler · `request.text` · Origin 비교 범위 · `server-only`)
- **DB 변경** — `0002_cancel_obsolete_checks.sql`: 미승인 revision의 `cancelled` 의도 추가. 0001은 고치지 않음, 기존 행 보존
- **발견 · 수정** — `fetch(new Request(url, { signal }))`는 GC 뒤 timeout이 오지 않음을 재현으로 증명 → `Transport = (url, init)`로 변경([기록](../records/2026-10-10-fetch-timeout-signal.md))
- **발견 · 수정** — Step 2 코드 · 테스트에 non-null assertion lint 경고가 있었음(Step 2 보고에서 놓침). 이번에 0건으로 정리
- **설계 차이** — 승인 API는 303 대신 JSON + status code(요구의 409를 그대로 돌려주기 위해). 화면은 Step 5. 로그인 · 세션(원래 Step 4)도 이번에 함께 구현

### 변경 파일

- 신규 — `apps/web/db/migrations/0002_cancel_obsolete_checks.sql`, `apps/web/src/lib/github/{http,app-auth,api,pulls,checks,webhook,fake-github}.ts`, `apps/web/src/lib/auth/{oauth,session}.ts`, `apps/web/src/lib/manual-approval/{config,sync,approve,webhook,reconcile,runtime,route-input,test-support}.ts`, route 6개(`app/api/github/{webhook,reconcile}` · `app/api/auth/github/{start,callback}` · `app/api/auth/logout` · `app/api/pulls/[repositoryId]/[number]/approve`), 단위 테스트 `http` · `webhook` · `app-auth` · `config` · `session`, DB 테스트 `webhook` · `approve` · `oauth`, `docs/manual-approval/setup.md`, `docs/records/2026-10-10-fetch-timeout-signal.md`
- 수정 — `manual-approval/{schema,state,repository}.ts`(cancelled 의도 · revision 단위 sync · 차단), Step 2 테스트(migration 목록 · `present()`), `db/test-database.ts`(`present`), `.claude/rules/web.md`, `AGENTS.md`, `docs/architecture/target-architecture.md`, `docs/manual-approval/{architecture,progress}.md`
- 만들지 못함 — web 앱의 env 예시 파일(permission 설정이 두 번 모두 쓰기 거부). 내용은 [setup.md §5](setup.md#5-환경변수--migration--배포)

### 서버 인증 경계

- **webhook** — raw body 2 MiB 상한(chunked 포함) → `X-Hub-Signature-256` constant-time 비교 → JSON parse → zod. sender를 승인자로 쓰지 않고 payload head SHA를 쓰지 않음
- **mutation** — POST만. Origin이 `PUBLIC_BASE_URL`과 정확히 같고, 운영자 세션(만료 · 철회 · `APPROVER_GITHUB_IDS` 매 요청 확인), 세션에 묶인 CSRF token
- **로그인** — 일회성 state(DB `DELETE … RETURNING`) · 쿠키 binding hash · PKCE S256 · 고정 callback · 10분 만료. `GET /user` numeric ID만 신뢰, 사용자 토큰 미보관
- **GitHub 쓰기** — 허용 repo ID + installation ID 일치 + 저장소 하나로 좁힌 installation token. 이 App의 이 이름 Check만. PAT fallback 없음

### 검증

| 명령                                                                              | 결과                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------ |
| `pnpm nx run-many -t lint typecheck test -p web visual-contracts --skip-nx-cache` | 통과. lint 경고 0                          |
| `pnpm nx test web`                                                                | 107개 통과(기존 review-data · format 포함) |
| `TEST_DATABASE_URL=… pnpm nx test-db web` (PostgreSQL 17.11)                      | 83개 통과(Step 2의 37개 포함)              |
| `pnpm tools:check` · `pnpm test:hooks`                                            | 49개 · 46개 통과                           |
| setup.md의 CSRF one-liner vs `csrfTokenFor`                                       | 같은 값                                    |

- **단위** — 서명 변조 · 다른 secret · sha1 · 잘림, fork payload(base 저장소 · head SHA 미사용), 무시 action · ping, 오류 분류(429 · 403 rate limit · 401 · 404 · 422 · 5xx · timeout · network), token이 메시지에 없음, deadline 지난 뒤 호출 안 함, JWT claim · 서명, 설정 누락 · 잘못된 값 fail closed(값 미노출), 쿠키 속성, CSRF, returnTo
- **DB + 가짜 GitHub(webhook)** — 새 PR → queued Check 1개(이름 · external_id · details_url · summary), 변조 401 · 저장 없음, 처리된 delivery no-op, 미허용 저장소 · 다른 installation 무시, 늦은 payload가 HEAD를 되돌리지 않음, fork PR은 base 저장소에 기록, push → 이전 cancelled · 새 queued, close → cancelled, 다른 App Check 미변경, 502 → failed delivery + 503 → Redeliver 수렴, POST 응답 유실 → 재시도가 기존 run 채택(중복 없음), 중복 run → 가장 작은 id 채택 · 나머지 cancelled, timeout이 webhook 예산 안(1.5초 deadline, 5초 안 503) · unknown 기록, installation suspend · unsuspend · 저장소 제거 · authorization 철회
- **DB + 가짜 GitHub(승인)** — 현재 HEAD만 success, stale → 409 + 최신 revision 동기화, 같은 revision 재승인 → 첫 결정 보존 · success 1개, 승인 중 push → 옛 SHA만 success · 새 SHA queued · 409, 같은 SHA의 다른 open PR → 409, 페이지 다 못 읽음 → 409, closed → 409, 미허용 저장소 403, installation token 거부 → fail closed, PATCH timeout → Approved 아님 → 재동기화 수렴, GitHub 성공 뒤 DB 기록 실패(claim 만료) → Approved 아님 → 재동기화 수렴, 실패 뒤 재시도 → 결정 시각 · 행 중복 없음, bootstrap · continuation cursor
- **로그인** — 고정 callback · S256, 운영자 세션 생성, state replay · 다른 브라우저 binding · 다른 PKCE · 만료 state 거부, 비운영자 세션 미생성, guard의 Origin(없음 · 다른 host · http) · 쿠키 없음 · CSRF 없음 · 다른 세션 CSRF · 만료 · 운영자 목록 제외
- **mutation 확인** — step 6 재조회 제거, shared-head 거부 제거, OAuth binding 비교 제거, CSRF 비교 제거 → 각각 해당 테스트 실패 확인 후 원복

### 실행하지 않은 것

- **실제 GitHub** — App 미생성 · 미설치, 배포 URL 없음. live webhook · Check · OAuth는 한 번도 호출하지 않음. 가짜 transport 통과를 실제 GitHub 성공으로 보지 않음
- **route handler 자체** — 런타임 의존(`server-only` · env · 실제 fetch)을 테스트에서 바꾸는 경로를 만들지 않았으므로 단위 테스트 없음. typecheck만. `pnpm nx build web` · `pnpm e2e`는 hook이 막아 실행하지 못함 — 사용자 터미널에서 필요
- **Vercel 런타임에서의 timeout · `maxDuration`** — 미확인

## Step 4 — Review Platform UI

설계 문서 §14의 "Step 5 화면"에 해당. 단계 표의 4 · 5를 이번에 마침.

- **결론** — `/pulls` 목록 · `/pulls/[repositoryId]/[number]` 상세 · 승인 · Retry sync · Sync PRs · 로그인 안내 · 로그아웃을 기존 Review UI 안에 추가. 서버 통합 테스트까지 실행, **E2E · build는 hook 때문에 실행하지 못함**
- **대조** — Step 2 · 3 구현과 테스트(단위 107 · DB 83)가 그대로 통과함을 먼저 확인. 테스트 컨테이너가 꺼져 있던 실패(`ECONNREFUSED`)는 코드가 아니라 환경 — 재기동 후 통과
- **표시 모델** — `approvalStatus`에 `sync-unknown` 추가(응답 유실 · timeout을 "반영 중"과 구분). `APPROVAL_STATUS_DISPLAY` · 상태 안내 · 결정 표시를 `lib/manual-approval/display.ts`에. Visual status · `deriveRunStatus` 변경 없음
- **데이터** — `listPullRequests`(허용 저장소만, open 먼저). 화면은 `loadViewer`가 운영자를 확인한 뒤에만 DB를 읽음
- **client 경계** — 승인 · Retry sync · Sync PRs · Sign out만. `'use client'` 규칙을 rule에 반영
- **E2E 설계** — 테스트 DB는 앱 repository 함수를 쓰는 seed CLI(`e2e-seed.ts`)로만 준비. web-e2e는 `composite` tsconfig라 web 소스를 import하지 않고 `node`로 실행. GitHub를 부르는 요청은 브라우저 경계에서 가로채고, 인증 거부는 실제 route로 확인
- **Playwright 설정** — `BASE_URL`이면 `webServer`를 만들지 않음(기존에는 항상 로컬 서버를 띄웠음). `E2E_DATABASE_URL`이 있을 때만 승인 설정을 서버에 붙임
- **재사용** — `DefinitionList` · `StatusBadge` · `ShortSha` · `formatTimestamp` · `focusRing` · shadcn `Table` · `Alert` · `Button` · `Skeleton` · `Separator`. `components/ui` 수정 없음. `tabTo`는 두 spec이 같이 쓰도록 `support/keyboard.ts`로 옮김(동작 동일)

### 상태 처리

| 상태                      | 화면                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| loading                   | `loading.tsx` skeleton(`role=status`)                                                                 |
| 설정 없음                 | "Manual approval is not configured" — 어떤 값이 없는지는 서버 로그에만                                |
| 비로그인 · 운영자 아님    | "Sign in required" + "Sign in with GitHub"(returnTo). PR 데이터를 읽지 않음                           |
| DB 오류                   | "Could not load …" — 승인으로 보이는 것 없음                                                          |
| empty                     | "No pull requests yet." + Sync PRs                                                                    |
| pending                   | Pending approval + `Approve <short SHA>`                                                              |
| submitting                | 버튼 disabled · `aria-busy` · "Approving…", ref로 중복 요청 차단                                      |
| approved                  | 서버가 DB 기록 + GitHub 확인을 본 경우만 Approved. 승인자 · 시각                                      |
| syncing · unknown · error | 각각 사실대로 안내 + Retry sync. Approved로 보이지 않음                                               |
| 409 새 commit             | "A new commit was pushed … approve again" → 새 head · 새 revision으로 다시 그림, 이전 승인은 이력에만 |
| closed · merged           | 버튼 없음, "Approval is disabled", 이력 유지                                                          |

### 변경 파일

- 신규 — `apps/web/src/app/pulls/{page,loading}.tsx`, `apps/web/src/app/pulls/[repositoryId]/[number]/{page,loading}.tsx`, `apps/web/src/components/review/{pull-requests-table,revision-history,approval-gate,external-link,approval-actions,pull-request-list-actions,action-feedback}.tsx`, `apps/web/src/lib/manual-approval/{display,viewer,e2e-seed}.ts`, `apps/web-e2e/src/manual-approval.spec.ts`, `apps/web-e2e/src/support/{approval,keyboard}.ts`
- 수정 — `apps/web/src/app/layout.tsx`(nav 링크 2개 · description), `lib/manual-approval/{state,repository,runtime}.ts`, 테스트(`sync-unknown` · `listPullRequests`), `apps/web-e2e/playwright.config.mts`, `apps/web-e2e/src/review-flow.spec.ts`(`tabTo` import만), `.claude/rules/{web,e2e}.md`, `docs/manual-approval/{architecture,setup,progress}.md`

### 검증

| 명령                                                                                      | 결과                        |
| ----------------------------------------------------------------------------------------- | --------------------------- |
| `pnpm nx run-many -t lint typecheck test -p web web-e2e visual-contracts --skip-nx-cache` | 통과, lint 경고 0           |
| `pnpm nx test web`                                                                        | 107개 통과                  |
| `TEST_DATABASE_URL=… pnpm nx test-db web`                                                 | 84개 통과                   |
| `pnpm tools:check` · `pnpm test:hooks`                                                    | 49개 · 46개 통과            |
| seed CLI 각 동작(reset · observe · approve · session)을 e2e DB에 실행                     | 기대한 행 · 상태 확인       |
| `pnpm exec playwright test --list`                                                        | 19개(기존 7 + 승인 12) 수집 |

- **Visual 보존 근거** — `app/page.tsx` · `app/runs` · `app/artifacts` · `lib/review-data.ts` · `lib/status-display.ts` · `libs/visual-contracts`에 diff 없음. 이 파일들과 layout이 승인 코드를 import하지 않음. layout은 링크만 추가하고 세션을 읽지 않음
- **경계 확인** — `'use client'` 파일 중 DB · 세션 · 설정 · `server-only` 모듈을 import하는 것 0개

### 실행하지 않은 것

- **E2E 19개** — hook이 막음. 사용자 터미널에서 [setup.md §13](setup.md#13-로컬-검증-명령)의 명령 필요. 특히 `__Host-` Secure cookie를 `http://localhost`에 넣는 동작(Chromium은 localhost를 보안 문맥으로 취급)은 실행해 봐야 확인됨
- **`pnpm nx build web`** — hook이 막음. 새 page · route · client 경계 포함
- **실제 GitHub · 배포** — App · 배포 URL 없음. 화면의 승인 · 재동기화 성공은 브라우저 경계 가로채기로만 확인했고, 실제 GitHub 반영은 확인하지 않음

## Step 5 — Hosting & Target Repository Integration

- **결론** — 배포 설정과 세 저장소 연결 절차를 [setup.md](setup.md)에 완성. **대상 저장소 변경 0개**(App 설치만으로 연결). review-platform 코드 변경은 배포 번들에서 Visual 화면이 깨지는 결함 하나만 수정. **배포 · App 생성 · 설치 · required 지정은 하지 않음**
- **다시 확인한 사실(2026-10-10)** — shared-stack · it-tech-blog HEAD · 변경 0 그대로, snapdone은 `sentry-api`에 사용자 미커밋 48개(읽기만). it-tech-blog는 `.github/` 없음 — workflow가 없다는 사실 외의 의미는 두지 않음
- **ruleset(공개 API)** — snapdone 24783824: required `checks` · `e2e` · `docker`(GitHub Actions) 유지. shared-stack 15386561: required status check 없음. it-tech-blog: rule 없음. classic branch protection은 비인증 401 → **확인 불가**(미설정이라는 뜻이 아님)
- **확인 불가** — App 설치 여부(App 없음), Vercel 프로젝트 · 계정, Secrets 등록 여부

### 배포 설정 근거

- **Vercel** — Node 24.x 기본(`engines >=24` → 24.x), pnpm은 지원 표가 6~10 → root `packageManager: pnpm@11.25.0`을 `ENABLE_EXPERIMENTAL_COREPACK=1`로 고정. Root Directory `apps/web` + "Include source files outside of the Root Directory"(기본 켬)로 `libs/visual-contracts` 접근. Build는 기본 `next build`(`apps/web`에 build script 없음)
- **Deployment Protection** — Standard Protection은 production 도메인을 보호하지 않음 → webhook · OAuth callback 통과. Preview는 보호됨. `PUBLIC_BASE_URL`은 고정 production 도메인
- **Preview 격리** — 승인 env를 Production에만 → Preview의 승인 경로는 `not-configured`로 닫힘(`approvalContext`가 설정을 먼저 읽고 DB 연결 전에 실패)
- **file tracing** — 설치된 Next 16.3 `config.js`는 `outputFileTracingRoot`가 없으면 lockfile 위치로 저장소 root를 찾음 → `next.config.js` 수정 불필요. 번들된 문서의 "기본값은 앱 디렉터리" 문장은 설치 코드와 다름
- **hosting 설정 파일 없음** — 필요한 값이 모두 대시보드 설정 · 기본값. `vercel.json` · 배포 pipeline을 만들지 않음
- **env 이름** — 코드는 `GITHUB_ALLOWED_REPOSITORY_IDS`(요청서의 `ALLOWED_REPOSITORY_IDS`)와 `GITHUB_INSTALLATION_ID`를 씀. 세션 · 암호화용 추가 키는 없음(opaque 세션 hash · CSRF 유도)
- **migration** — 사용자가 direct 연결로 `pnpm db:migrate`. build · 요청 중 자동 적용 없음

### 발견 · 수정

- **결함** — `reviewDataDir()`이 `REVIEW_DATA_DIR`가 절대 경로여도 `pnpm-workspace.yaml`을 먼저 찾고, 없으면 던짐. 배포 번들처럼 그 파일이 없는 곳에서 `/`가 오류
- **증명** — cwd를 workspace 밖 임시 디렉터리로 바꾸고 절대 경로를 준 테스트가 `No pnpm-workspace.yaml found`로 실패함을 먼저 확인
- **수정** — 절대 경로면 workspace root를 찾지 않음(상대 경로 동작은 그대로). 테스트 2개 추가(상대 · 절대). Vercel에서 실제 cwd에 그 파일이 없는지는 첫 배포에서 확인

### 변경 파일

- review-platform — `apps/web/src/lib/review-data.ts`(절대 경로 처리), `apps/web/src/lib/review-data.test.ts`(테스트 2개), `.claude/rules/web.md`(`REVIEW_DATA_DIR` 설명), `docs/manual-approval/{setup,progress,architecture}.md`
- shared-stack · it-tech-blog · snapdone — **0개**. 승인 연동에 workflow · package · secret · source import가 필요 없음. 형식적 파일을 만들지 않음
- 만들지 못함 — `apps/web/.env.example`(permission 설정이 쓰기 거부). placeholder 내용은 setup.md §5

### 검증

| 명령 · 확인                                                                               | 결과                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `pnpm nx run-many -t lint typecheck test -p web web-e2e visual-contracts --skip-nx-cache` | 통과                                       |
| `pnpm nx test web`                                                                        | 109개 통과(`reviewDataDir` 2개 추가)       |
| `TEST_DATABASE_URL=… pnpm nx test-db web`                                                 | 84개 통과                                  |
| `pnpm tools:check` · `pnpm test:hooks`                                                    | 49개 · 46개 통과                           |
| 대상 저장소 HEAD · 작업 트리                                                              | 조사 시작과 같음(변경 없음)                |
| review-platform `.github/` diff                                                           | 0줄 — 기존 Visual reusable workflow 그대로 |

### 실행하지 않은 것

- **배포 build(Vercel) · `pnpm nx build web`** — 배포는 사용자 결정, 로컬 build는 hook이 막음
- **실제 DB 연결 · 재시작 지속 · HTTPS · 로그인 · callback · webhook ping · 잘못된 서명 401 · installation 범위 · Preview 격리** — 배포 · App이 없어 실행 불가. 방법과 기대 결과는 [setup.md §11](setup.md#11-배포-확인-목록)
- **E2E** — hook이 막음(Step 4와 같음)

## Step 6 — End-to-End Verification

**구현 · 로컬 검증 완료(브라우저 E2E · production build는 미실행), 실제 GitHub 검증 0/3.** 상세 · 계획 · 기록 양식은 [e2e-report.md](e2e-report.md).

- **이전 "완료"를 다시 확인** — `origin/main`은 `aa774d6`, 수동 승인 구현 전체(34개 항목)가 **미커밋**. 이 기능이 들어간 배포 revision은 존재할 수 없음. `apps/web/.next`는 2026-09-25, 마지막 Playwright 실행도 2026-09-25 — 새 코드로 build · 브라우저 E2E가 돈 적 없음
- **GitHub 현재 상태(공개 API)** — 세 저장소 open PR 0개, main HEAD에 `Review Platform / Manual Approval` Check run 0개. GitHub App 없음
- **로컬(이 세션)** — lint · typecheck(3개 프로젝트), web 단위 109 · visual-contracts 64 · DB 통합 84(실제 PostgreSQL 17 + 가짜 GitHub) · tools 49 · hook 46 통과. 실패 · 복구 시나리오를 테스트 이름으로 대응([e2e-report.md §3](e2e-report.md#3-실패--복구-시나리오))
- **추가** — `webhook.test.ts`에 `merge_group` 무시 단언(MVP 한계 노출 확인), `apps/web-e2e/src/live-smoke.spec.ts`(opt-in 읽기 전용 배포 smoke 4개 — PR · DB 쓰기 없음), `.claude/rules/e2e.md`에 사용법
- **실행하지 않음 · 하지 않음** — 브라우저 E2E · production build(hook), 커밋 · push · 배포, App 생성 · 설치, 테스트 PR 생성 · 승인 · close, required 지정. 기존 업무 PR은 승인하지 않음

### 변경 파일

- 신규 — `docs/manual-approval/e2e-report.md`, `apps/web-e2e/src/live-smoke.spec.ts`
- 수정 — `apps/web/src/lib/github/webhook.test.ts`, `.claude/rules/e2e.md`, `docs/manual-approval/progress.md`
- 기존 Visual — `app/page.tsx` · `app/runs` · `app/artifacts` · `lib/status-display.ts` · `libs/visual-contracts` diff 없음. `lib/review-data.ts`는 Step 5의 절대 경로 수정뿐

## 실제 검증 진입 조건

1. **사용자 터미널** — `pnpm nx build web` · `E2E_DATABASE_URL=… pnpm e2e` 결과
2. **커밋 · push** — 이 작업을 배포 가능한 revision으로(`/berry-commit:commit-scope`, 사용자 승인)
3. **배포 · App** — [setup.md](setup.md) §1~7, 배포 revision 기록, `LIVE_SMOKE=1` smoke
4. **테스트 PR 승인 범위** — 저장소별 draft 테스트 PR 생성 · 두 번째 commit · 승인 클릭 · close · branch 삭제를 누가 할지([e2e-report.md §5](e2e-report.md#5-실행-계획사용자-승인-뒤))
5. **required 지정 여부** — 첫 승인 성공 뒤 저장소별로 사용자 결정([setup.md](setup.md) §9)
