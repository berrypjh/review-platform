---
paths:
  - 'apps/web-e2e/**'
---

# E2E (`apps/web-e2e`)

Playwright 한 벌, Chromium 하나. Review UI를 **실제 브라우저에서** 확인한다. vitest(앱 안)는 `lib/`의 순수 로직을 보고, 여기서는 dev 서버 · 라우팅 · 키보드 · 이미지 로드처럼 브라우저가 있어야 보이는 것을 본다.

## AI 세션에서는 실행할 수 없다

브라우저 실행과 포트 바인딩이 샌드박스에서 막혀 있어 hook이 거부한다. `pnpm exec playwright test --list`로 목록까지만 확인하고, **실행은 사용자에게 요청한다.** 돌리지 못했으면 "E2E는 실행하지 못했다"고 그대로 보고한다.

## 서버는 Playwright가 띄운다

- `REVIEW_DATA_DIR=<root>/fixtures/visual/review-data`로 **`next dev --port 3200`을 직접** 띄운다. nx를 거치면 fixture env가 닿지 않고 서버가 고아로 남는다 ([기록](../../docs/records/2026-09-24-e2e-starts-next-directly.md))
- `reuseExistingServer: false`. 3000번의 일반 `pnpm dev`를 잘못 보지 않는다
- `BASE_URL`을 주면 이미 떠 있는 서버를 보고, **로컬 서버를 띄우지 않는다**(`webServer` 없음)
- `E2E_DATABASE_URL`을 주면 서버에 승인 설정(테스트 DB · 형식만 맞춘 GitHub App 값)을 붙인다. 없으면 `manual-approval.spec.ts`는 skip으로 보고된다 — 통과가 아니다

## 데이터는 커밋된 fixture다

- 시나리오는 `fixtures/visual/review-data/runs/sample`(review-required, unchanged 1 · changed 1)을 전제한다. spec 상단의 `RUN` 상수가 그 값이다
- 테스트 전용 가짜 run · 가짜 metric을 만들지 않는다. empty · malformed 상태는 `apps/web/src/lib/review-data.test.ts`(loader 단위 테스트)가 검증한다. 다른 상태가 필요하면 fixture를 늘리기 전에 거기서 되는지 본다
- 이 저장소의 UI 자체를 스크린샷 baseline으로 잡지 않는다

## 수동 승인 spec

- **DB는 `apps/web/src/lib/manual-approval/e2e-seed.ts`로만 만든다.** 앱의 repository 함수를 쓰는 테스트 전용 CLI다. 운영 런타임에 테스트 경로를 만들지 않는다
- **세션은 seed가 만든 DB 세션 + `__Host-rp_session` cookie.** 로그인 callback을 우회하는 서버 코드는 없다
- **GitHub를 부르는 요청(승인 · Retry sync · Sync PRs)은 `page.route`로 브라우저 경계에서 가로채고**, 서버가 했을 DB 기록을 seed로 한다. 서버의 GitHub 흐름은 `apps/web`의 DB 통합 테스트가 본다
- **인증 거부(401 · 403)는 실제 서버 route로 확인한다.** guard를 통과해 GitHub까지 가는 요청은 보내지 않는다
- live region은 `region` "Approval" 안에서 찾는다. Next route announcer · 로그아웃 영역과 겹친다

## 배포 서버 smoke (opt-in)

- `live-smoke.spec.ts`는 `LIVE_SMOKE=1 BASE_URL=https://…`일 때만 돈다. 일반 실행 · CI에서는 skip
- **읽기 전용** — PR 생성 · 로그인 시작 · 승인 · 재동기화를 부르지 않는다. 운영 DB에 쓰지 않는 요청만(서명 오류 401 · 세션 없는 승인 401)
- `BASE_URL`을 주면 `review-flow.spec.ts`도 그 서버를 보므로 live에서는 `playwright test live-smoke`만 돌린다

## 두 가지 함정

- **`e2e-ci--*` target을 직접 돌리지 않는다.** spec마다 Playwright를 따로 띄워 같은 포트를 두고 충돌한다. `pnpm e2e`로 돌린다
- **비활성 탭 패널은 DOM에서 빠진다.** 이미지는 `getByRole('tabpanel')` 안에서 찾아 좌우 비교 영역의 같은 alt와 겹치지 않게 한다

`apps/web`의 `pnpm dev`가 떠 있는 상태에서 돌렸을 때 Next가 같은 앱의 `next dev` 두 개를 막는지는 확인하지 않았다.

## 테스트를 쓸 때

- **사용자가 보는 것으로 찾는다** — 역할과 이름(`getByRole('heading', { level: 1, name: 'Run sample' })`, `getByRole('tab', { name: 'Diff' })`). CSS 선택자 · 테스트 전용 id에 기대지 않는다
- 이미지는 alt로 찾고 `complete && naturalWidth > 0`을 poll한다. `toBeVisible`만으로는 로드 실패를 잡지 못한다 — fixture PNG를 숨기면 이 단언만 실패하는 것을 확인했다
- 키보드 경로는 `tabTo`로 목표에 도달하는지만 본다. Tab 횟수를 세지 않는다 — 셸이 바뀌면 깨진다
- 제목 · 문구는 화면에 보이는 영어 그대로 쓴다
- `tsconfig.json`의 `lib`에 `dom`이 있다. `page.evaluate` 안의 DOM 타입 때문이다
