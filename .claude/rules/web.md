---
paths:
  - 'apps/web/**'
---

# web (`apps/web`)

Next.js App Router. 소스는 `src/`, alias는 `@/*` → `./src/*`. Review UI다 — Visual은 `run.json`을 읽어 보여 줄 뿐 비교 · 승인 · 저장을 하지 않는다. 예외는 아래 "PR 수동 승인" 하나다.

**Next 16의 번들 문서를 먼저 읽는다.** API · 관례가 학습 데이터와 다를 수 있다. 코드를 쓰기 전에 `apps/web/node_modules/next/dist/docs/`(설치 버전과 같은 문서)에서 해당 안내를 읽는다. Next의 `AGENTS.md` 자동 생성은 `next.config.js`의 `agentRules: false`로 꺼 두었다 — 이 저장소는 하위 `AGENTS.md`를 두지 않는다.

## Data

- **파일을 읽는 코드는 `src/lib/review-data.ts` 하나뿐이다.** 화면 · route가 `fs`를 직접 부르지 않는다
- 모든 run은 `VisualRunSchema`로 검증한 뒤에만 쓴다. 검증 전 JSON을 화면에 넘기지 않는다
- **status를 다시 계산하지 않는다.** `run.status` · `change.status`를 그대로 쓴다. 개수 세기 · 비율 표시 · SHA 줄이기 · 시각 표시만 `src/lib/format.ts`에서 한다
- **null을 0으로 보이지 않는다.** `mismatchPixels` · `mismatchRatio`가 null이면 "Not measured"다. 아주 작은 비율은 `<0.01%`로 표시한다
- run 단위 문제는 예외가 아니라 `RunProblem` 값이다. production에서는 Server Component가 던진 예외의 message가 브라우저에 전달되지 않으므로 값으로 돌려 화면이 이유별(잘못된 JSON · 계약 위반 · 미비교 · 파일시스템)로 그린다. `error.tsx`는 예상하지 못한 실패용이다
- `REVIEW_DATA_DIR`의 상대 경로는 workspace root 기준이다(`pnpm-workspace.yaml`이 있는 곳). `next dev`의 cwd(`apps/web`)를 기준으로 삼지 않는다. 기본 `<root>/.review-data`. 절대 경로는 workspace root를 찾지 않는다 — 배포 번들에는 `pnpm-workspace.yaml`이 없을 수 있다
- 파일을 읽는 page는 `await connection()`으로 prerender를 막는다
- 별도 API 서버를 만들지 않는다. Visual 데이터에 DB · 승인 저장을 붙이지 않는다

## PR 수동 승인 (`/pulls` 화면 · API 구현, 실제 GitHub 검증 전)

GitHub App으로 허용한 저장소의 PR에 전용 Check `Review Platform / Manual Approval`을 쓰는 기능. 설계는 [architecture.md](../../docs/manual-approval/architecture.md). Visual과 서로 import하지 않는다.

- **승인 상태는 PostgreSQL에만.** 파일 · 모듈 메모리 · localStorage에 영구 보관하지 않는다. `run.json`을 고치지 않고 Visual status를 승인 판단에 쓰지 않는다
- **경계** — 연결 pool은 `lib/db/`만 연다(`getSql`, 지연 초기화). SQL 함수는 `Db`를 인자로 받는다. `lib/github/`만 GitHub API를 부른다. 상태 전이 · 표시 계산은 `lib/manual-approval/state.ts` 하나
- **route는 얇게** — 입력 parse · `guardMutation` · lib 함수 하나 · 결과 매핑. 의존은 `approvalRuntime()`(server-only)에서만 얻는다
- **외부 호출은 `Transport = (url, init)`.** `new Request(..., { signal })`로 감싸지 않는다 — 파생 signal은 GC 뒤 timeout이 오지 않는다([기록](../../docs/records/2026-10-10-fetch-timeout-signal.md))
- **가짜 GitHub(`fake-github.ts`) · `test-support.ts`는 테스트에서만 주입한다.** 런타임에 transport를 고르는 env · header · query를 만들지 않는다
- **Check는 이 App 것만 만지고, 이름은 `Review Platform / Manual Approval` 고정.** 다른 App · Actions의 run, PR review · merge API를 부르지 않는다
- **`import 'server-only'`는 env를 읽는 진입 모듈에만**(`lib/db/client.ts` 등). 패키지를 설치하지 않았으므로 vitest · `pnpm db:migrate`가 import하는 모듈에 넣으면 깨진다
- **migration은 `apps/web/db/migrations/NNNN_*.sql` 추가로만.** 적용된 파일을 고치지 않는다. drop · reset 하지 않는다
- **SQL은 tagged template(parameterized).** `unsafe`는 커밋된 migration과 고정 열 목록에만
- **DB와 GitHub은 한 transaction이 아니다.** PR lease · `version` CAS · revision의 desired/sync 상태로 수렴시킨다. 메모리 mutex로 직렬화하지 않는다. 원자적이라고 쓰지 않는다
- **늦은 webhook payload로 HEAD를 덮지 않는다.** lease 뒤 GitHub의 현재 PR을 다시 읽는다
- **Approved 표시는 `approved` + `synced`뿐.** 오류 · 미상을 Approved로 보이지 않는다
- **webhook은 응답 전에 처리를 끝낸다.** fire-and-forget · `after()` 금지. 실패는 DB에 남기고 non-2xx
- **route handler POST는 Origin을 직접 검사한다.** Server Action과 달리 Next가 비교하지 않는다
- **운영자 · 저장소는 numeric ID로 판정한다** — `APPROVER_GITHUB_IDS` · `GITHUB_ALLOWED_REPOSITORY_IDS` · `GITHUB_INSTALLATION_ID`. 매 요청 서버에서
- **secret을 로그 · `last_error` · 응답에 넣지 않는다.** 사용자 GitHub 토큰은 저장하지 않는다
- **화면은 서버에서 운영자를 확인한 뒤에만 PR을 읽는다**(`loadViewer`). 버튼 숨김은 보안 경계가 아니다 — 모든 mutation은 route의 `guardMutation`이 다시 막는다
- **Approved는 `approvalStatus`가 `approved`일 때만.** 화면이 상태를 다시 계산하지 않고 `APPROVAL_STATUS_DISPLAY`(Visual의 `RUN_STATUS_DISPLAY`와 별개)로만 그린다
- **승인은 화면에 보인 HEAD SHA · revision을 그대로 보낸다.** 409면 새 commit 안내 후 `router.refresh()`로 현재 값을 다시 읽는다
- 승인 · 재동기화 · 로그아웃 버튼만 client 컴포넌트다(`approval-actions.tsx` · `pull-request-list-actions.tsx` · `action-feedback.tsx`). 중복 클릭은 ref로 막고, 결과는 항상 DOM에 있는 `role=status` · `role=alert` 영역으로 알린다
- **layout은 세션을 읽지 않는다.** Visual 화면이 DB 없이 동작해야 한다

## artifact route

`/artifacts/[runId]/[...path]`는 PNG만 제공한다. 다음 중 하나라도 어긋나면 404다.

- run id가 `SafeIdSchema`, 경로가 `ArtifactPathSchema`를 통과
- `realpath` 뒤 실제 위치가 데이터 디렉터리 안 (symlink 탈출 차단)
- 파일이 PNG signature로 시작

`cache-control: no-store` · `x-content-type-options: nosniff`.

## Component

- **Server Component가 기본이다.** `'use client'`는 `error.tsx`와 위 승인 상호작용 컴포넌트 셋뿐이다. 탭은 shadcn `Tabs`(radix)가 client 경계를 스스로 가진다
- 파일 이름은 **kebab-case**, export는 PascalCase
- `src/components/ui/`는 shadcn 생성 파일이다. **직접 수정하지 않는다.** 추가는 `pnpm dlx shadcn@4.21.0 add <name> -c apps/web`
- 이 앱의 화면 조각은 `src/components/review/`에 둔다. 공용 design system wrapper를 만들지 않는다
- 선택 상태는 URL로 표현한다 — `/runs/<id>?change=<change-id>`. change 목록 항목은 버튼이 아니라 링크다
- change가 바뀌면 `Tabs`에 `key={change.id}`를 줘 선택 탭을 초기화한다

| 작업                        | 수정 파일                                                    |
| --------------------------- | ------------------------------------------------------------ |
| run 읽기 · 정렬 · 문제 분류 | `lib/review-data.ts` + `lib/review-data.test.ts`             |
| 새 status 표시              | `lib/status-display.ts` (계약의 status가 먼저 바뀌어야 한다) |
| 숫자 · 시각 표시 형식       | `lib/format.ts` + `lib/format.test.ts`                       |
| 화면 조각 추가              | `components/review/<name>.tsx`                               |

## 접근성

- `html lang="en"`, skip link, `header` · `main` · `nav` landmark, heading은 h1 → h2 → h3
- **status는 `StatusBadge`(아이콘 + 텍스트)로만.** 색만으로 구분하지 않는다
- focus 표시는 `src/lib/styles.ts`의 `focusRing` 하나. 새 링크 · 버튼에 붙인다
- 이미지 alt는 목적을 적는다. 새 탭 링크에는 `sr-only`로 "(opens in a new tab)"
- unchanged · error에서 Diff 탭은 `disabled`이고 이유를 텍스트로 적는다

## Styling

Tailwind v4 + shadcn(radix, nova preset, `components.json`). 색 · radius는 shadcn이 `global.css`에 둔 CSS 변수를 쓴다. 로컬에 raw 색을 두지 않는다.

- 화면 폭은 `max-w-screen-2xl`. 스크린샷 비교가 넓게 보여야 한다
- artifact 이미지는 `[image-rendering:pixelated]`로 그린다. 픽셀 단위 diff를 정확히 보기 위해서다. 축소하면 글자가 거칠어 보이는 것은 알려진 제약이고, 원본은 "Open full size"로 본다
- dark mode 토글은 없다. shadcn이 넣은 변수만 있다

## 함정

- **`typecheck` target은 `package.json`에 직접 있다.** `@nx/js/typescript` plugin이 `next.config.*`가 있는 프로젝트를 건너뛴다
- **`tsconfig.spec.json`은 `composite: false`.** 이게 없으면 spec 파일이 어디서도 타입 검사되지 않는다
- **없는 run은 HTTP 200이다.** `loading.tsx` 때문에 응답이 먼저 streaming되어 status를 바꿀 수 없다(Next 문서의 동작). 화면은 "Run not found"이고 `noindex`가 붙는다
- **Geist 폰트는 `next/font/google`.** build에 네트워크가 필요하다

## 검증

```bash
pnpm nx lint web
pnpm nx typecheck web      # tsconfig.json + tsconfig.spec.json
pnpm nx test web           # lib/ 단위 테스트
TEST_DATABASE_URL=… pnpm nx test-db web   # 실제 PostgreSQL 통합 테스트 (docs/manual-approval/architecture.md#14-로컬-db)
pnpm nx build web          # AI 세션에서는 hook이 막는다 — 사용자에게 요청
```

화면 자체는 `apps/web-e2e`가 본다. 명령의 배경은 [quality-gates.md](../../docs/engineering/quality-gates.md).
