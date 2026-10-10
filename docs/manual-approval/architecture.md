# Manual Approval — Architecture

허용한 저장소의 PR에 GitHub App이 전용 Check `Review Platform / Manual Approval`을 붙이고, 운영자가 `/pulls`에서 승인하면 그 Check를 success로 바꿈. 코드는 `apps/web`, 승인 상태는 전용 PostgreSQL. 설정 · 운영은 [setup.md](setup.md).

## 1. 범위

### 하는 것

- **전용 Check** — 대기 `queued`, 승인 `completed` + `success`, 현재가 아니게 된 미승인 revision(새 HEAD · close · merge)은 `completed` + `cancelled`
- **summary 고정 문구** — `Manual approval only. No automated checks were run.`
- **수동 승인** — `APPROVER_GITHUB_IDS`에 있는 GitHub 사용자가 현재 head SHA · 현재 revision을 승인
- **복구** — 운영자 재동기화(`POST /api/github/reconcile`) · GitHub Redeliver

### 하지 않는 것

- PR Review · 기존 CI 결과 · Visual 결과를 읽지 않음
- merge · auto merge · ruleset 변경을 하지 않음
- `merge_group` 처리 없음
- 자동 재시도 · 상주 worker · cron 없음
- 저장소별 승인자 구분 없음

## 2. 구성

| 항목              | 내용                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Check 쓰기        | GitHub App installation token                                                                                        |
| App 권한          | Checks: write · Pull requests: read · Metadata: read                                                                 |
| 로그인            | 같은 App의 user authorization(web flow) + PKCE S256. `GET /user`의 numeric ID만 쓰고 토큰은 버림                     |
| 운영자 판정       | `APPROVER_GITHUB_IDS`(numeric user ID). 매 요청 확인                                                                 |
| 대상 저장소       | `GITHUB_ALLOWED_REPOSITORY_IDS`(numeric repo ID) + `GITHUB_INSTALLATION_ID` 일치                                     |
| 세션              | opaque token. DB에는 SHA-256 hash만                                                                                  |
| DB                | PostgreSQL, `postgres`(Postgres.js). SQL migration. ORM 없음                                                         |
| GitHub REST       | `X-GitHub-Api-Version: 2026-03-10`. App JWT RS256(`iat` −60초, `exp` +9분, `iss` client ID)                          |
| 외부 호출 timeout | `fetch(url, { signal: AbortSignal.timeout(남은 deadline) })` — [기록](../records/2026-10-10-fetch-timeout-signal.md) |

## 3. 경계

```
apps/web/src
├─ app/pulls/                   승인 화면
├─ app/api/                     route handler
├─ lib/manual-approval/         schema · 상태 전이(state) · 표시(display) · SQL(repository · deliveries) · 흐름(webhook · approve · sync · reconcile)
├─ lib/github/                  App JWT · installation token · REST 호출 · webhook 서명
├─ lib/auth/                    세션 · OAuth
└─ lib/db/                      설정 · 연결 · transaction 시간 제한 · migration

apps/web/db/migrations/         번호 붙은 SQL migration
```

- **Visual ↔ 승인** — 서로 import하지 않음. `run.json`을 고치지 않음
- **DB 연결** — `lib/db/`만 pool을 만듦. SQL 함수는 `Db`를 인자로 받음
- **SQL** — Postgres.js tagged template. `unsafe`는 고정 열 목록에만
- **GitHub 호출** — REST는 `lib/github/`, OAuth(`github.com/login/oauth`)는 `lib/auth/oauth.ts`
- **`import 'server-only'`** — `lib/db/client.ts` · `lib/manual-approval/runtime.ts` · `lib/manual-approval/viewer.ts`
- **승인 schema** — `lib/manual-approval/schema.ts`. type은 `z.infer`

## 4. 흐름

### 새 PR · push

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant WH as POST /api/github/webhook
    participant DB as PostgreSQL
    participant API as GitHub REST

    GH->>WH: pull_request
    WH->>WH: 크기(2 MiB) · HMAC-SHA256 서명 검사
    WH->>DB: webhook_deliveries 시작 (delivery_id)
    alt done · ignored
        WH-->>GH: 200 duplicate
    end
    WH->>WH: installation ID · repo ID 허용 확인
    WH->>DB: PR claim 획득 (최대 2초 대기)
    WH->>API: GET pulls/{n} (현재 상태 재조회)
    WH->>DB: PR 갱신. open이면서 HEAD 변경 · 재오픈 · 첫 관측이면 새 revision
    WH->>API: 이 App의 기존 check run 조회(external_id) → 없으면 생성
    WH->>DB: sync 결과 기록 (version CAS) · claim 해제 · delivery done
    WH-->>GH: 200 processed
```

### 승인

```mermaid
sequenceDiagram
    actor Op as 운영자
    participant AP as POST /api/pulls/{repoId}/{n}/approve
    participant DB as PostgreSQL
    participant API as GitHub REST

    Op->>AP: form(csrf, expectedHeadSha, expectedRevision)
    AP->>AP: Origin · 세션 · 운영자 · CSRF · 허용 저장소
    AP->>DB: PR claim 획득 (최대 2초, 실패 시 503 busy)
    AP->>API: GET pulls/{n} → DB 반영
    AP->>AP: open · HEAD · revision이 입력과 같은가 (아니면 409)
    AP->>API: GET commits/{sha}/pulls — 같은 SHA의 다른 open PR (있거나 다 못 읽으면 409)
    AP->>DB: decision=approved · desired=success 기록
    AP->>API: Check를 success로
    AP->>DB: sync 결과 기록
    AP->>API: GET pulls/{n} — revision이 그대로인가 (아니면 409 head-changed-after-approval)
    AP-->>Op: 200 approved · 502 not-confirmed
```

### 닫힘 · 재오픈

- **closed · merged** — 미승인 revision의 대기 Check는 `cancelled`. 승인된 Check는 그대로
- **reopened** — 같은 SHA여도 새 revision과 새 `queued` Check

## 5. 상태

### 새 revision을 여는 조건

관측한 PR이 open이고, 다음 중 하나일 때만(`needsNewRevision`).

- 저장된 revision이 없음
- 저장된 PR이 open이 아니었음(재오픈)
- head SHA가 바뀜(A → B → A도 새 revision)

### 화면 상태 (`approvalStatus`)

| 조건                               | 상태           | 표시              |
| ---------------------------------- | -------------- | ----------------- |
| PR merged                          | `merged`       | Merged            |
| PR closed                          | `closed`       | Closed            |
| `blocked_reason` 있음              | `blocked`      | Blocked           |
| revision 없음 · decision `pending` | `pending`      | Pending approval  |
| `approved` + sync `synced`         | `approved`     | Approved          |
| `approved` + sync `error`          | `sync-error`   | Sync error        |
| `approved` + sync `unknown`        | `sync-unknown` | Sync unknown      |
| `approved` + sync `pending`        | `syncing`      | Syncing to GitHub |

- 위에서부터 먼저 맞는 조건
- 승인 버튼은 `pending`일 때만
- 이력의 결정 표시 — `Approved` · `Pending` · `Superseded`(desired `cancelled`)

### 승인 거부 사유 (409)

`revision-changed` · `head-changed` · `not-open` · `blocked` · `no-revision` · `shared-head` · `shared-head-unknown` · `head-changed-after-approval`. 저장된 PR이 없으면 404 `not-found`.

## 6. 일관성

DB와 GitHub API는 한 transaction이 아님. 다음으로 수렴.

- **PR claim** — `pull_request_claims`(token · fence · `lease_until`, 30초). 만료된 claim만 다음 처리자가 가져가고 fence +1. claim으로 하는 DB 쓰기는 claim 행을 `FOR UPDATE`로 잠그고 token · fence · 만료를 확인한 뒤에만 commit, 아니면 `ClaimLostError`
- **version CAS** — sync 결과는 시작 시 읽은 revision `version`과 같을 때만 기록
- **outbox** — revision의 `desired_check_state` · `sync_state`. `sync_state <> 'synced'`가 재동기화 대상
- **늦은 payload** — payload는 트리거로만 씀. claim 뒤 GitHub에서 PR을 다시 읽음
- **external_id** — `rp:<repositoryId>:<number>:<generation>`. 조회용 표식. 같은 external_id의 run이 여럿이면 가장 작은 id를 쓰고 나머지 미완료 run은 `cancelled`
- **success 순서** — approved를 DB에 commit한 뒤에만 Check를 success로 바꿈
- **같은 SHA의 다른 open PR** — success로 바꾸기 전에도 다시 확인
- **결과 미상** — timeout · 응답 유실 · 5xx는 sync `unknown`. Approved로 표시하지 않음

## 7. DB

테이블 6개 + `schema_migrations`. 정의는 [`0001`](../../apps/web/db/migrations/0001_manual_approval.sql) · [`0002`](../../apps/web/db/migrations/0002_cancel_obsolete_checks.sql).

### `pull_requests`

| 열                                                       | 제약 · 의미                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `id`                                                     | identity PK                                                                     |
| `repository_id` · `installation_id`                      | `bigint not null`                                                               |
| `number`                                                 | **`UNIQUE (repository_id, number)`**                                            |
| `owner` · `name` · `title` · `author_login` · `html_url` | 표시용 snapshot                                                                 |
| `head_sha`                                               | 40자 소문자 hex                                                                 |
| `state`                                                  | `open` · `closed` · `merged`                                                    |
| `active_revision_id`                                     | 같은 PR의 revision만 가리키는 FK                                                |
| `blocked_reason`                                         | null · `installation-suspended` · `installation-deleted` · `repository-removed` |
| `version`                                                | 갱신마다 +1                                                                     |

### `revisions`

| 열                                               | 제약 · 의미                                                |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `pull_request_id` · `generation`                 | **`UNIQUE (pull_request_id, generation)`**, generation ≥ 1 |
| `head_sha`                                       | 40자 소문자 hex                                            |
| `decision`                                       | `pending` · `approved`                                     |
| `approver_id` · `approver_login` · `decision_at` | approved일 때만 not null                                   |
| `check_run_id`                                   | **`UNIQUE`**, null 허용                                    |
| `desired_check_state`                            | `queued` · `success` · `cancelled`                         |
| `sync_state`                                     | `pending` · `synced` · `error` · `unknown`                 |
| `last_error`                                     | 500자까지                                                  |
| `version`                                        | 의도가 바뀔 때 +1                                          |

- **`revisions_decision_consistent`** — pending이면 `queued` · `cancelled`이고 승인자 없음. approved면 `success`이고 승인자 ID · login · 시각 모두 있음

### `pull_request_claims`

PK `(repository_id, number)`. PR 행이 없어도 claim 가능. `token`(uuid) · `fence` · `lease_until`.

### `webhook_deliveries`

| 열                                                                       | 의미                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `delivery_id`                                                            | PK                                                        |
| `event` · `action` · `repository_id` · `installation_id` · `pull_number` | 식별자. payload 원문은 저장하지 않음                      |
| `status`                                                                 | `processing` · `done` · `ignored` · `failed`              |
| `attempts` · `last_error`                                                | `last_error` 500자까지                                    |
| `received_at` · `started_at` · `finished_at`                             | `processing`이 60초를 넘으면 버려진 시도로 보고 다시 처리 |

### `sessions`

`token_hash`(SHA-256, PK) · `github_user_id` · `login` · `expires_at`(12시간) · `revoked_at`(로그아웃 · authorization 철회).

### `oauth_transactions`

`state`(PK) · `browser_binding_hash`(`__Host-rp_oauth` 값의 SHA-256) · `code_verifier` · `return_to` · `expires_at`(10분). callback에서 한 번만 소비.

## 8. Webhook

| 이벤트 · action                                                  | 처리                                      |
| ---------------------------------------------------------------- | ----------------------------------------- |
| `pull_request` opened · reopened · synchronize · edited · closed | claim → 재조회 → DB 반영 → Check 동기화   |
| `pull_request` 그 외 action                                      | `ignored`                                 |
| `installation` deleted · suspend                                 | 해당 installation의 PR에 `blocked_reason` |
| `installation` unsuspend                                         | `installation-suspended` 차단만 해제      |
| `installation_repositories` removed                              | 해당 저장소 PR에 `repository-removed`     |
| `github_app_authorization` revoked                               | 그 사용자의 세션 모두 철회                |
| 그 외 이벤트 · 다른 installation · 허용 밖 저장소                | `ignored`                                 |

- **응답 전에 처리를 끝냄** — 내부 deadline 8초, `maxDuration` 10초
- **실패** — delivery `failed` 기록 뒤 503. Redeliver(같은 delivery ID)나 재동기화로 복구

| 응답 | 경우                                            |
| ---- | ----------------------------------------------- |
| 200  | `processed` · `ignored` · `duplicate`           |
| 400  | event · delivery 헤더 누락, JSON · payload 오류 |
| 401  | 서명 불일치 · 서명 헤더 누락                    |
| 413  | 2 MiB 초과                                      |
| 503  | `failed` · `in-progress` · `not-configured`     |

## 9. 장애 · 순서 역전

| 상황                                   | 결과                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| 같은 delivery 재수신                   | done · ignored면 200 duplicate. failed · 60초 지난 processing은 재처리         |
| 이전 synchronize가 늦게 도착           | 재조회 결과가 DB와 같으면 변경 없음                                            |
| 승인 직전 push                         | 409 `head-changed` · `revision-changed`                                        |
| 승인 기록 뒤 Check 반영 전 push        | 이전 SHA의 Check만 success. 새 SHA는 queued. 409 `head-changed-after-approval` |
| 동시 승인                              | claim을 못 얻은 쪽은 503 `busy`. 이미 승인된 revision은 첫 결정 유지           |
| Check 생성 · 갱신 결과 미상            | sync `unknown`. 재동기화가 external_id로 찾은 뒤 없을 때만 생성                |
| Check 반영 뒤 DB 기록 실패             | sync `pending`. 재동기화가 같은 반영 반복                                      |
| installation 정지 · 삭제 · 저장소 제거 | `blocked`. 모든 쓰기 거부                                                      |
| `APPROVER_GITHUB_IDS`에서 제거         | 다음 요청부터 운영자 아님                                                      |

## 10. 환경변수

| 이름                            | 용도                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | PostgreSQL                                                                                                  |
| `GITHUB_APP_ID`                 | Check 소유 확인 · `app_id` 필터                                                                             |
| `GITHUB_APP_CLIENT_ID`          | OAuth · App JWT `iss`                                                                                       |
| `GITHUB_APP_CLIENT_SECRET`      | OAuth code 교환                                                                                             |
| `GITHUB_APP_PRIVATE_KEY`        | App JWT 서명(PEM, `\n` 이스케이프 허용)                                                                     |
| `GITHUB_WEBHOOK_SECRET`         | `X-Hub-Signature-256` 검증                                                                                  |
| `GITHUB_INSTALLATION_ID`        | 허용 installation                                                                                           |
| `GITHUB_ALLOWED_REPOSITORY_IDS` | 쉼표 구분 numeric repo ID                                                                                   |
| `APPROVER_GITHUB_IDS`           | 쉼표 구분 numeric user ID                                                                                   |
| `PUBLIC_BASE_URL`               | 경로 없는 origin. https, 단 localhost · 127.0.0.1은 http 허용. `details_url` · OAuth callback · Origin 비교 |
| `TEST_DATABASE_URL`             | DB 통합 테스트 전용                                                                                         |

하나라도 없거나 잘못되면 `ConfigurationError` → 503 `not-configured`.

## 11. API · 화면

모든 응답 `cache-control: no-store`.

| Method · 경로                                     | 인증                          | 입력                                                    | 응답 · `maxDuration`                                                                                      |
| ------------------------------------------------- | ----------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `POST /api/github/webhook`                        | HMAC                          | raw JSON                                                | §8 · 10초                                                                                                 |
| `GET /api/auth/github/start`                      | 없음                          | `?returnTo=` 내부 경로                                  | 302 GitHub authorize. `__Host-rp_oauth` 10분                                                              |
| `GET /api/auth/github/callback`                   | state · binding · PKCE        | `code` · `state`                                        | 303 + `__Host-rp_session` 12시간. 400 `invalid-login` · 403 `not-an-approver` · 15초                      |
| `POST /api/auth/logout`                           | Origin · 세션 · CSRF          | form `csrf`                                             | 200 `logged-out`, 세션 철회 · 쿠키 삭제                                                                   |
| `POST /api/pulls/[repositoryId]/[number]/approve` | Origin · 세션 · 운영자 · CSRF | form `csrf` · `expectedHeadSha` · `expectedRevision`    | 200 `approved` · 502 `not-confirmed` · 409 · 404 · 403 `repository-not-allowed` · 503 `busy` · 400 · 30초 |
| `POST /api/github/reconcile`                      | Origin · 세션 · 운영자 · CSRF | form `csrf` + (`repositoryId` · `number`) 또는 `cursor` | 200 `{result}` 또는 `{processed, notSynced, cursor}` · 60초                                               |

- **guard 순서** — Origin이 `PUBLIC_BASE_URL`과 다르면 403 `bad-origin`, 운영자 세션이 없으면 401 `unauthenticated`, CSRF가 틀리면 403 `bad-csrf`
- **쿠키** — `HttpOnly` · `Secure` · `SameSite=Lax` · `Path=/`
- **CSRF** — `base64url(SHA-256("csrf:" + 세션 token))`. 저장하지 않고 매번 계산해 constant-time 비교
- **공통 오류** — GitHub 오류 502 `github`(종류만), 그 밖 500 `internal`
- **재동기화(전체)** — 반영 안 된 PR과, installation이 접근 가능한 허용 저장소의 open PR을 처리. 접근이 확인된 저장소의 차단을 풂. 시간 예산(50초 중 5초 남기)을 넘기면 `cursor`를 돌려줌
- **재동기화(PR 하나)** — 차단된 PR은 `blocked`로 돌려주고 처리하지 않음

### 화면

| 경로                             | 내용                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/pulls`                         | 허용 저장소 PR 목록(open 먼저, 최근 갱신순) · 승인 상태 · Sync PRs                                       |
| `/pulls/[repositoryId]/[number]` | PR 정보 · head SHA · revision · GitHub check · 승인자 · 승인 시각 · Approve · Retry sync · revision 이력 |

- 서버가 운영자를 확인한 뒤에만 DB를 읽음. 아니면 "Sign in required"
- 승인 · Retry sync · Sync PRs · Sign out만 client 컴포넌트
- layout은 세션을 읽지 않음

## 12. 보안

- **secret** — env에만. 로그 · `last_error` · 응답에 넣지 않음
- **installation token** — 요청 안에서만 사용, 저장하지 않음
- **사용자 GitHub 토큰** — 저장하지 않음
- **허용 목록** — installation ID · repo ID를 매 이벤트 · 요청 확인
- **브라우저로 가는 값** — CSRF token뿐

## 13. 의존성

- **`postgres` 3.4.9** — PostgreSQL 접속
- **`zod` ^4.6.5** — 입력 · 응답 검증
- **`node:crypto`** — HMAC · JWT RS256 · PKCE · 무작위 token
- **`fetch`** — GitHub 호출

## 14. 로컬 DB

```bash
docker run -d --rm --name review-platform-pg -p 127.0.0.1:54329:5432 \
  -e POSTGRES_USER=review -e POSTGRES_PASSWORD=review -e POSTGRES_DB=review_platform_test postgres:17
docker exec review-platform-pg createdb -U review review_platform_dev

DATABASE_URL=postgres://review:review@127.0.0.1:54329/review_platform_dev pnpm db:migrate
TEST_DATABASE_URL=postgres://review:review@127.0.0.1:54329/review_platform_test pnpm nx test-db web

docker stop review-platform-pg
```

- **migration** — 적용한 파일은 `schema_migrations`로 건너뜀. advisory lock으로 직렬화. 전체가 transaction 하나
- **TLS** — `localhost` · `127.0.0.1` · `[::1]`만 평문, 그 밖은 `verify-full`. URL의 `sslmode` 등 query는 무시
- **transaction 시간 제한** — `statement_timeout` 5초 · `idle_in_transaction_session_timeout` 10초(`SET LOCAL`)
- **prepared statement 미사용** — transaction pooler와 호환
- **`TEST_DATABASE_URL` 없음** — 통합 테스트는 실패
