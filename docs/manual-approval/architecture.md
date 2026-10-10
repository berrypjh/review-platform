# Manual Approval — Integration Architecture

GitHub App 하나로 세 저장소의 PR에 전용 Check `Review Platform / Manual Approval`을 붙이고, review-platform 운영자가 수동 승인하면 그 Check를 success로 바꾸는 최소 설계. 기존 `apps/web` 하나에 넣고, 승인 상태는 전용 PostgreSQL에만 둠. **DB와 GitHub API를 하나의 transaction으로 묶지 않음** — PR 단위 claim · version CAS · 영속 반영 의도(outbox) · 재조정으로 수렴시킴.

- 상태 — 서버(GitHub 연동 · 로그인 · 승인 · 재동기화 API)와 화면(`/pulls`) 구현. 실제 GitHub · 배포 검증은 아직
- 설정 · 복구 절차 — [setup.md](setup.md)
- 근거 조사 — [audit.md](audit.md)
- 진행 — [progress.md](progress.md)

## 1. 범위

### 하는 것

- **전용 Check** — 이름 `Review Platform / Manual Approval`. 대기는 `status=queued`(conclusion 없음), 승인은 `completed` + `success`, 현재가 아니게 된 미승인 revision(새 HEAD · close · merge)은 `completed` + `cancelled`. Actions 전용 값(`pending` · `waiting` · `requested`)과 neutral · skipped는 쓰지 않음
- **수동 승인** — GitHub 로그인한 단일 운영자(`APPROVER_GITHUB_IDS`)가 현재 head SHA · 현재 generation을 승인
- **summary 고정 문구** — `Manual approval only. No automated checks were run.`
- **복구** — 운영자 재동기화 POST · GitHub Redeliver

### 하지 않는 것

- 코드 검토 · Visual Diff 승인 · 자동 검증 · 알림 · 통계 · auto merge
- 대상 저장소의 코드 · workflow · ruleset 변경
- merge queue(`merge_group`) 지원. 설정을 켜거나 끄지 않음
- 자동 재시도 · 상주 worker · cron · Redis · queue 서비스
- 여러 승인자 · 역할 관리

### 서로 별개인 것

| 항목                    | 누가 정하나                        | 이 설계와의 관계                  |
| ----------------------- | ---------------------------------- | --------------------------------- |
| 공식 PR Review Approval | GitHub PR 리뷰                     | 읽지도 쓰지도 않음                |
| 기존 CI 성공            | 각 저장소 Actions                  | 읽지 않음. 승인 판단에 쓰지 않음  |
| Required Status Check   | 저장소 ruleset(사용자 설정)        | 이 Check를 넣을지는 사용자가 결정 |
| 실제 merge              | 사용자                             | 하지 않음                         |
| 이 Check의 success      | review-platform 운영자의 수동 승인 | 이 설계의 유일한 출력             |

## 2. 결정

| 결정               | 내용                                                                                       | 근거                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 앱 위치            | 기존 `apps/web`. 별도 API 앱 · 새 Nx library · plugin engine 없음                          | `nx show projects` = `web` · `web-e2e` · `visual-contracts`                                                                                                                                                                                                                                 |
| Check 쓰기 주체    | GitHub App installation token                                                              | [Checks API](https://docs.github.com/en/rest/checks/runs) — check run 생성은 GitHub App만 가능                                                                                                                                                                                              |
| App 권한           | Checks: write · Pull requests: read · Metadata: read                                       | Contents · PR write · Actions · Administration 불필요. 소스 checkout 없음                                                                                                                                                                                                                   |
| 로그인             | 같은 App의 user authorization(web flow) + PKCE S256                                        | [App user token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) — PKCE는 S256만, 토큰 8시간 만료                                                                                                    |
| 운영자 판정        | `APPROVER_GITHUB_IDS`의 numeric user ID. 매 요청 서버에서 검사                             | username은 바뀔 수 있음                                                                                                                                                                                                                                                                     |
| 대상 저장소        | `GITHUB_ALLOWED_REPOSITORY_IDS`의 numeric repo ID + `GITHUB_INSTALLATION_ID` 일치          | 이름 변경 · 이전에 흔들리지 않음                                                                                                                                                                                                                                                            |
| 호스팅             | Vercel Next Node runtime                                                                   | review-platform 기존 호스팅 없음([audit §2](audit.md#2-review-platform)). Next 16.3 runtime 기본값 `nodejs`, edge deprecated(`next/dist/docs/.../runtime.md`)                                                                                                                               |
| DB                 | review-platform 전용 managed PostgreSQL. 기본 후보 Neon                                    | 서버리스 인스턴스 간 공유 · SQL transaction 필요. snapdone DB · 인증 · 세션 테이블 공유 금지                                                                                                                                                                                                |
| DB driver          | `postgres`(Postgres.js) 3.4.9 하나. SQL migration. ORM 없음                                | 기존 driver 없음. Node · Next 내장 PG 클라이언트 없음. 의존성 0개                                                                                                                                                                                                                           |
| Visual 데이터      | `run.json` · `.review-data` 그대로. 승인과 섞지 않음                                       | [visual-contracts.md](../architecture/visual-contracts.md)                                                                                                                                                                                                                                  |
| 사용자 GitHub 토큰 | 보관하지 않음. callback에서 `GET /user` 한 번만 쓰고 버림                                  | 저장할 secret을 줄임. 세션은 review-platform 자체 opaque token                                                                                                                                                                                                                              |
| GitHub REST        | `X-GitHub-Api-Version: 2026-03-10`(최신 지원 버전). App JWT `iss`는 client ID(GitHub 권장) | [API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions) · [JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app). 2026-03-10 breaking change 중 사용하는 필드에 닿는 것 없음 |
| 외부 호출 timeout  | `fetch(url, { signal: AbortSignal.timeout(남은 deadline) })`                               | `new Request(..., { signal })`의 파생 signal은 GC 뒤 발화하지 않음 — [기록](../records/2026-10-10-fetch-timeout-signal.md)                                                                                                                                                                  |
| 승인 요청          | `POST` form(`csrf` · `expectedHeadSha` · `expectedRevision`) → JSON + status code          | Step 3은 API만. 화면(Step 5)이 form으로 호출. `'use client'`를 늘리지 않음                                                                                                                                                                                                                  |

## 3. 경계

```
apps/web/src
├─ app/                         기존 /, /runs, /artifacts 보존
│  ├─ pulls/                    신규 화면
│  └─ api/                      신규 route handler
├─ lib/review-data.ts           Visual — fs 읽기 전용 (변경 없음)
├─ lib/manual-approval/         schema · 순수 상태 전이(state) · PR/revision/claim SQL(repository) · delivery SQL(deliveries)
├─ lib/github/                  App JWT · installation token · REST 호출 · webhook 서명
├─ lib/auth/                    세션 · OAuth transaction SQL(store). 운영자 판정 · OAuth는 Step 4
└─ lib/db/                      설정 · 연결(client) · transaction 시간 제한 · migration

apps/web/db/migrations/         번호 붙은 SQL migration
```

- **Visual ↔ 승인** — 서로 import하지 않음. `run.json`을 고치지 않고, Visual status를 승인 판단에 쓰지 않음
- **DB 접근** — 연결 pool은 `lib/db/`만 만듦. SQL 함수(`repository` · `deliveries` · `store`)는 `Db`를 인자로 받아 실행. 화면 · route는 이 함수만 거침
- **SQL** — 전부 Postgres.js tagged template(parameterized). `unsafe`는 커밋된 migration 파일과 고정 열 목록에만
- **GitHub 호출** — `lib/github/`만 `api.github.com` · `github.com`을 부름
- **server-only** — env를 읽고 연결을 여는 진입 모듈(`lib/db/client.ts`, Step 3 · 4의 GitHub · 세션 진입 모듈)에 `import 'server-only'`. Next 16.3이 내부 처리 · 타입 제공(`next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`). 패키지를 설치하지 않으므로 vitest · Node CLI는 이 import를 풀 수 없음 — 테스트 · migration CLI가 쓰는 모듈(`config` · `migrate` · `repository` 등)에는 두지 않음. lint는 이 import를 잡지 않음(Step 2 확인)
- **영구 상태** — 승인 · 세션 · delivery는 DB에만. 파일 · 모듈 메모리 · localStorage에 영구 보관하지 않음
- **승인 schema 위치** — `apps/web/src/lib/manual-approval/`. artifact 계약이 아니므로 `libs/visual-contracts`에 넣지 않음. type은 `z.infer`로만 얻음

## 4. 이벤트 흐름

### 새 PR · push

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant WH as POST /api/github/webhook
    participant DB as PostgreSQL
    participant API as GitHub REST (installation token)

    GH->>WH: pull_request.opened / synchronize / reopened
    WH->>WH: raw body HMAC-SHA256 검증 (timingSafeEqual)
    WH->>DB: INSERT webhook_deliveries ON CONFLICT (delivery_id)
    alt 이미 done · ignored
        WH-->>GH: 200 duplicate
    end
    WH->>WH: repo ID 허용 · installation ID 일치 확인
    WH->>DB: PR claim 획득 (pull_request_claims upsert, 만료된 claim만 가져옴 · fence+1)
    WH->>API: GET /repos/{o}/{r}/pulls/{n} (현재 상태 재조회)
    WH->>DB: tx: PR 갱신, head·base 변경 또는 reopen이면 새 revision(generation+1, pending, desired=queued, sync=pending)
    WH->>API: 기존 check run 조회(app_id · check_name · external_id) 후 없으면 생성 status=queued
    WH->>DB: tx: check_run_id 기록, sync=synced (version CAS), claim 해제, delivery done
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
    AP->>AP: Origin 검사 · 세션 · APPROVER_GITHUB_IDS
    AP->>DB: PR claim 획득
    AP->>API: GET pulls/{n} — open이고 head == expectedHeadSha?
    AP->>API: GET commits/{sha}/pulls 전 페이지 — 같은 SHA의 다른 open PR 없음?
    AP->>DB: tx: active revision이 expectedRevision이고 pending인가 확인 → decision=approved, desired=success, sync=pending, version+1
    AP->>API: PATCH check-runs/{id} completed · success · summary
    AP->>DB: tx: sync=synced (실패 시 error, 결과 미상이면 unknown), claim 해제
    AP->>API: GET pulls/{n} — HEAD가 그대로인가(아니면 409 head-changed-after-approval)
    AP-->>Op: 200 approved · 502 not-confirmed · 409 conflict
```

### 닫힘 · 재오픈

- **closed · merged** — PR state 갱신, 승인 버튼 비활성. 미승인 active revision의 대기 Check는 `cancelled`, 승인된 Check는 그대로(이력 보존)
- **reopened** — 같은 SHA여도 새 generation. 새 check run을 `queued`로 생성. 같은 이름의 최신 run이 표시되므로 이전 success가 가려짐

## 5. 상태 전이

### PR

| 현재   | 이벤트(재조회 결과)     | 다음   | revision                  |
| ------ | ----------------------- | ------ | ------------------------- |
| 없음   | open                    | open   | generation 1 생성         |
| open   | head SHA 변경           | open   | 새 generation             |
| open   | 제목 · 본문만 변경      | open   | 유지                      |
| open   | closed (merge 안 됨)    | closed | 유지(승인 불가)           |
| open   | merged                  | merged | 유지(승인 불가)           |
| closed | reopened                | open   | 새 generation             |
| 아무   | 재조회 결과가 DB와 같음 | 그대로 | 유지 (늦은 · 중복 이벤트) |

### Revision (decision × sync)

| decision | desired | sync    | 화면 표시                        | 다음 동작                          |
| -------- | ------- | ------- | -------------------------------- | ---------------------------------- |
| pending  | queued  | pending | Pending approval · Sync pending  | webhook · 재동기화가 Check 생성    |
| pending  | queued  | synced  | Pending approval                 | 승인 가능                          |
| pending  | queued  | error   | Pending approval · Sync failed   | 재동기화. 승인 불가(Check id 없음) |
| pending  | queued  | unknown | Pending approval · Sync unknown  | 재동기화가 external_id로 조회      |
| approved | success | pending | Approval recorded · Sync pending | PATCH 재시도                       |
| approved | success | synced  | **Approved**                     | 없음                               |
| approved | success | error   | Approval recorded · Sync failed  | 재동기화                           |
| approved | success | unknown | Approval recorded · Sync unknown | 재동기화가 check run을 읽어 확정   |

- **Approved 표시는 `approved` + `synced`뿐** — 오류 · 미상은 Approved로 보이지 않음
- **비활성 revision** — PR의 `active_revision_id`가 아니면 이력으로만 보임. 승인 · 재사용 불가

## 6. 불변식과 구현 수단

| #   | 불변식                                                         | 수단                                                                                                                                              |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 현재 HEAD · 현재 generation 승인만 유효                        | approve tx가 `active_revision_id` · generation · head_sha · `decision='pending'`을 조건으로 UPDATE. 0행이면 409                                   |
| 2   | HEAD 변경 · 재오픈은 새 승인 단위. 과거 기록 유지, 재사용 금지 | 새 revision INSERT. 이전 행은 그대로. `UNIQUE (pull_request_id, generation)`                                                                      |
| 3   | 승인 입력은 GitHub 재조회 결과와 일치                          | claim 획득 뒤 `GET pulls/{n}`. `state=open` · `head.sha == expectedHeadSha` 불일치면 409                                                          |
| 4   | 승인 의사와 GitHub 반영 구분                                   | `decision`과 `sync_state` 분리. 의사를 먼저 commit, 반영은 그 뒤                                                                                  |
| 5   | DB · GitHub은 단일 transaction 아님                            | PR claim(`pull_request_claims`: token · fence · `lease_until`) · `version` CAS · revision의 desired/sync를 outbox로 · 재동기화. 메모리 mutex 없음 |
| 6   | 중복 방지                                                      | `webhook_deliveries.delivery_id` UNIQUE + 도메인 UNIQUE(아래 §7)                                                                                  |
| 7   | external_id는 멱등 키가 아님                                   | 생성 결과 미상이면 `GET commits/{sha}/check-runs?check_name=…&app_id=…&filter=all`에서 external_id로 찾은 뒤에만 재생성                           |
| 8   | 늦은 payload로 HEAD를 덮지 않음                                | payload는 트리거로만 씀. claim 뒤 GitHub 현재 PR을 재조회해 그 값으로 갱신                                                                        |
| 9   | 같은 SHA를 공유하는 open PR이 둘 이상이면 성공 공유 금지       | approve 전에 `GET commits/{sha}/pulls` 전 페이지 확인. 같은 저장소 open PR이 2개 이상이거나 페이지를 다 못 읽으면 승인 거부                       |
| 10  | merge queue 범위 밖                                            | `merge_group` 이벤트 구독 안 함. 설정 변경 없음                                                                                                   |

- **external_id 형식** — `rp:<repositoryId>:<number>:<generation>`
- **claim** — 만료 시각이 지난 claim만 다음 처리자가 가져가며 `fence`가 1 늘어남. claim으로 하는 DB 쓰기는 `fenced` transaction 안에서 claim 행을 `FOR UPDATE`로 잠그고 token · fence · 만료를 확인한 뒤에만 commit — 만료된 claim의 늦은 쓰기는 `ClaimLostError`
- **fencing의 한계** — GitHub API 호출에는 fence가 닿지 않음. 만료된 처리자가 늦게 보낸 Check 쓰기는 GitHub에 반영될 수 있음. 그 결과는 DB에 기록되지 않고(`stale` · `ClaimLostError`), 재동기화가 DB 의도대로 다시 씀
- **sync 결과 CAS** — 반영 결과는 시작 시 읽은 revision `version`과 같을 때만 기록. 그사이 승인으로 의도가 바뀌었으면 `stale`
- **GitHub success ⇒ DB approved** — PATCH는 approved가 commit된 뒤에만 보냄. 역방향(DB approved, GitHub 미반영)은 sync 상태로 드러나고 재동기화로 수렴

## 7. DB

테이블 6개 + `schema_migrations`. 실제 정의는 [`0001_manual_approval.sql`](../../apps/web/db/migrations/0001_manual_approval.sql). 시각은 전부 `timestamptz`, GitHub ID는 `bigint`(앱은 안전 정수 범위를 검사해 number로 읽음).

### `pull_requests`

| 열                                    | 제약 · 의미                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`                                  | `bigint generated always as identity` PK                                                 |
| `repository_id` · `installation_id`   | `bigint not null`                                                                        |
| `owner` · `name`                      | 표시용 snapshot                                                                          |
| `number`                              | `int not null`. **`UNIQUE (repository_id, number)`**                                     |
| `title` · `author_login` · `html_url` | 표시용 snapshot                                                                          |
| `head_sha`                            | CHECK `~ '^[0-9a-f]{40}$'`                                                               |
| `state`                               | CHECK `in ('open','closed','merged')`                                                    |
| `active_revision_id`                  | FK `(active_revision_id, id)` → `revisions (id, pull_request_id)` — 같은 PR의 revision만 |
| `blocked_reason`                      | null 또는 `installation-suspended` · `installation-deleted` · `repository-removed`       |
| `version`                             | `int not null`. 갱신마다 +1, CAS 조건                                                    |
| `created_at` · `updated_at`           |                                                                                          |

### `revisions`

| 열                               | 제약 · 의미                                       |
| -------------------------------- | ------------------------------------------------- |
| `id`                             | PK                                                |
| `pull_request_id`                | FK. **`UNIQUE (pull_request_id, generation)`**    |
| `head_sha` · `generation`        | generation ≥ 1                                    |
| `decision`                       | CHECK `in ('pending','approved')`                 |
| `approver_id` · `approver_login` | approved일 때만 not null                          |
| `decision_at`                    | approved일 때만 not null                          |
| `check_run_id`                   | `bigint`. **`UNIQUE`** (null 허용)                |
| `desired_check_state`            | CHECK `in ('queued','success')`                   |
| `sync_state`                     | CHECK `in ('pending','synced','error','unknown')` |
| `last_error` · `last_synced_at`  | 비밀 값 · 토큰을 넣지 않음. 500자까지             |
| `version`                        | 승인 등 의도가 바뀔 때 +1. sync 결과의 CAS 조건   |
| `created_at`                     |                                                   |

- **결합 CHECK** — `revisions_decision_consistent`: pending이면 queued · 승인자 없음, approved면 success · 승인자 ID · login · 시각 모두 있음

### `pull_request_claims`

| 열                         | 제약 · 의미                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| `repository_id` · `number` | PK. PR 행이 없어도(첫 webhook) claim 가능하도록 `pull_requests`와 분리 |
| `token`                    | `uuid`. 획득마다 새 값                                                 |
| `fence`                    | 획득마다 +1. 늦은 이전 소유자를 가려냄                                 |
| `lease_until`              | 만료 시각. 지나면 다른 처리자가 가져감                                 |

- **outbox 조회** — `sync_state <> 'synced'`인 active revision이 재동기화 대상. partial index

### `webhook_deliveries`

| 열                                                  | 제약 · 의미                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `delivery_id`                                       | `text` PK — **UNIQUE**                                                                              |
| `event` · `action`                                  |                                                                                                     |
| `repository_id` · `installation_id` · `pull_number` | 최소 식별자. payload 원문은 저장하지 않음                                                           |
| `status`                                            | CHECK `in ('processing','done','ignored','failed')`                                                 |
| `attempts` · `last_error`                           | Redeliver는 **같은 delivery ID**로 옴 → `failed` · 만료된 `processing`이면 다시 처리                |
| `received_at` · `started_at` · `finished_at`        | `started_at`이 오래된 `processing`은 버려진 시도로 보고 다시 처리. 결과 기록은 `attempts` 일치 조건 |

### `sessions`

| 열                          | 제약 · 의미                                           |
| --------------------------- | ----------------------------------------------------- |
| `token_hash`                | `bytea` PK. SHA-256(opaque 32 bytes). 원문 저장 안 함 |
| `github_user_id` · `login`  | login은 snapshot                                      |
| `created_at` · `expires_at` | 절대 만료 12시간                                      |
| `revoked_at`                | 로그아웃 · authorization 철회 시 기록                 |

### `oauth_transactions`

| 열                     | 제약 · 의미                                              |
| ---------------------- | -------------------------------------------------------- |
| `state`                | `text` PK. 일회성                                        |
| `browser_binding_hash` | `__Host-rp_oauth` 쿠키 값의 SHA-256                      |
| `code_verifier`        | PKCE verifier                                            |
| `return_to`            | 로그인 뒤 돌아갈 내부 경로                               |
| `expires_at`           | 10분. callback에서 `DELETE … RETURNING`으로 한 번만 소비 |

## 8. Webhook

### 처리하는 이벤트

| 이벤트 · action                                                  | 처리                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pull_request` opened · reopened · synchronize · edited · closed | claim → 재조회 → §5 전이 → Check 동기화                                                                  |
| `pull_request` 그 외 action                                      | `ignored` 기록 후 200 (labeled · assigned · review_requested · ready_for_review · converted_to_draft 등) |
| `installation` deleted · suspend                                 | 해당 installation PR 전부 `blocked_reason` 설정                                                          |
| `installation` unsuspend                                         | `blocked_reason` 해제. 이후 재동기화                                                                     |
| `installation_repositories` removed                              | 해당 저장소 PR `repository-removed`                                                                      |
| `github_app_authorization` revoked                               | 그 사용자의 세션 전부 `revoked_at`                                                                       |
| `check_run` · `check_suite` · 그 외                              | `ignored` 기록 후 200                                                                                    |

- **draft PR** — 일반 open과 같게 처리
- **fork PR** — base 저장소의 webhook으로 받음. head 저장소를 checkout하지 않으므로 추가 위험 없음

### 시간 제한과 실패

- **GitHub 제한** — 10초 안에 2xx가 아니면 실패로 기록. **자동 재전송 없음**([webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks))
- **내부 deadline** — 수신 시점부터 8초. 모든 GitHub `fetch`에 남은 시간으로 `AbortSignal.timeout`
- **await** — 처리를 응답 전에 끝냄. 200/202 뒤 처리자 없는 작업(fire-and-forget) 없음. `after()`도 쓰지 않음
- **실패** — delivery `failed` · revision `sync_state` 기록 뒤 503. 운영자 재동기화 또는 GitHub Redeliver로 복구
- **claim 대기** — 최대 2초. 못 얻으면 delivery `failed` 기록 후 503. 운영자 화면에 남길 표시가 필요한지는 Step 3에서 결정
- **SLA 없음** — 장애 뒤 자동 복구를 보장하지 않는 MVP. 운영자가 `/pulls`에서 sync 상태를 보고 재동기화함

## 9. 장애 · 중복 · 순서 역전 복구

| 상황                                   | 결과                                                                                      | 복구                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 서명 불일치 · 헤더 누락                | 401. 아무것도 저장 안 함                                                                  | 없음                                            |
| 같은 delivery 재수신(done · ignored)   | 200 duplicate                                                                             | 없음                                            |
| Redeliver(이전 failed)                 | 같은 ID로 다시 처리                                                                       | 자동                                            |
| 처리 중 인스턴스 종료                  | delivery `processing`, claim 만료 대기                                                    | Redeliver · 재동기화                            |
| 이전 synchronize가 늦게 도착           | 재조회 head가 DB와 같으면 변경 없음                                                       | 불필요                                          |
| 승인 직전 push                         | 재조회 head ≠ expected → 409 `head-changed`                                               | 새 generation 승인                              |
| 승인 commit 뒤 PATCH 전 push           | 이전 SHA의 Check만 success. 새 SHA는 자기 webhook으로 queued                              | 불필요(의도대로)                                |
| 동시 승인 두 번                        | claim 하나만 진행. 뒤 요청은 decision이 이미 approved → 첫 결정을 유지하고 sync만 이어 감 | 불필요                                          |
| Check 생성 timeout(결과 미상)          | `sync_state=unknown`                                                                      | 재동기화가 external_id로 조회 후 없을 때만 생성 |
| Check PATCH timeout                    | `unknown`. Approved로 표시 안 함                                                          | 재동기화가 check run을 읽고 다시 PATCH          |
| PATCH 성공 뒤 DB 기록 실패             | sync `pending`. GitHub은 success, DB decision은 이미 approved                             | 재동기화가 같은 PATCH 반복(멱등)                |
| 같은 SHA의 open PR 둘 이상             | 승인 거부 409 `shared-head`                                                               | PR 정리 후 재시도                               |
| `commits/{sha}/pulls` 페이지 일부 실패 | 승인 거부 409 `shared-head-unknown`                                                       | 재시도                                          |
| PR이 승인 도중 닫힘                    | 재조회 state ≠ open → 409 `not-open`                                                      | 없음                                            |
| installation 정지 · 삭제 · 저장소 제거 | token 발급 · 재조회 실패로 모든 쓰기 차단. 이벤트로 `blocked_reason` 기록                 | unsuspend 후 재동기화                           |
| 사용자 authorization 철회              | 세션 무효                                                                                 | 재로그인                                        |
| `APPROVER_GITHUB_IDS`에서 제거         | 다음 요청부터 403                                                                         | 없음                                            |

## 10. 환경변수

값은 저장소 · 문서 · 로그 어디에도 적지 않음.

| 이름                            | 용도                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | review-platform 전용 PostgreSQL. Neon pooler면 `prepare: false` 필요 여부 Step 2에서 확인                         |
| `GITHUB_APP_ID`                 | App JWT `iss`                                                                                                     |
| `GITHUB_APP_PRIVATE_KEY`        | App JWT RS256 서명. PEM                                                                                           |
| `GITHUB_APP_CLIENT_ID`          | OAuth web flow                                                                                                    |
| `GITHUB_APP_CLIENT_SECRET`      | OAuth code 교환                                                                                                   |
| `GITHUB_WEBHOOK_SECRET`         | `X-Hub-Signature-256` 검증                                                                                        |
| `GITHUB_INSTALLATION_ID`        | 허용 installation (berrypjh 계정 하나)                                                                            |
| `GITHUB_ALLOWED_REPOSITORY_IDS` | 쉼표 구분 numeric repo ID 3개                                                                                     |
| `APPROVER_GITHUB_IDS`           | 쉼표 구분 numeric user ID                                                                                         |
| `PUBLIC_BASE_URL`               | `https://host`(경로 없음, http는 localhost만). Check `details_url` · OAuth `redirect_uri` · POST Origin 비교 기준 |
| `REVIEW_DATA_DIR`               | 기존 Visual 데이터 위치(변경 없음)                                                                                |
| `TEST_DATABASE_URL`             | DB 통합 테스트 전용. 운영 DB를 가리키지 않음                                                                      |

## 11. API 계약

모든 신규 route는 Node runtime(기본값). 응답에 `cache-control: no-store`.

| Method · 경로                                     | 인증                            | 입력                                                                                 | 응답                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/github/webhook`                        | HMAC                            | raw JSON(최대 2 MiB). `X-GitHub-Event` · `X-GitHub-Delivery` · `X-Hub-Signature-256` | 200 `processed` · `ignored` · `duplicate` / 400 형식 / 401 서명 / 413 크기 / 503 `failed` · `in-progress` / 503 `not-configured`                                                                                                                                                     |
| `GET /api/auth/github/start`                      | 없음                            | `?returnTo=` 내부 경로만                                                             | 302 GitHub authorize(PKCE S256 · state). `__Host-rp_oauth` binding 쿠키 10분                                                                                                                                                                                                         |
| `GET /api/auth/github/callback`                   | state 1회 + 쿠키 binding + PKCE | `code` · `state`                                                                     | 303 `PUBLIC_BASE_URL` + returnTo, `__Host-rp_session` 12시간. 400 `invalid-login` · 403 `not-an-approver`(세션 생성 안 함)                                                                                                                                                           |
| `POST /api/auth/logout`                           | 세션 · Origin · CSRF            | form `csrf`                                                                          | 200, 서버 세션 철회 · 쿠키 삭제. 401 · 403                                                                                                                                                                                                                                           |
| `POST /api/pulls/[repositoryId]/[number]/approve` | 세션 · 운영자 · Origin · CSRF   | form `csrf` · `expectedHeadSha` · `expectedRevision`                                 | 200 `approved`(DB 기록 + GitHub success + HEAD 유지 확인) · 502 `not-confirmed` · 409 `conflict`(`revision-changed` · `head-changed` · `not-open` · `blocked` · `shared-head` · `shared-head-unknown` · `head-changed-after-approval`) · 404 · 403 · 401 · 503 `busy` · 502 `github` |
| `POST /api/github/reconcile`                      | 세션 · 운영자 · Origin · CSRF   | form `csrf` + (`repositoryId` · `number`) 또는 `cursor`                              | 200 `{result}`(PR 하나) 또는 `{processed, notSynced, cursor}`. cursor가 null이 될 때까지 반복                                                                                                                                                                                        |

- **Origin 검사** — route handler POST는 Server Action과 달리 Next가 Origin을 자동 비교하지 않음(`next/dist/docs/01-app/02-guides/data-security.md`). `Origin`이 `PUBLIC_BASE_URL`과 정확히 같지 않으면 403
- **세션 쿠키** — `__Host-rp_session`: `HttpOnly` · `Secure` · `SameSite=Lax` · `Path=/`
- **CSRF** — `base64url(SHA-256("csrf:" + 세션 token))`. 세션 token 원문이 있어야 계산되므로 저장하지 않음. 화면이 form에 넣고 route가 다시 계산해 constant-time 비교
- **GET으로 바꾸지 않음** — 승인 · 재동기화 · 로그아웃은 POST만
- **입력 검증** — 모든 입력 zod. repositoryId · number는 양의 정수, SHA는 40자 소문자 hex

### 화면

| 경로                             | 내용                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/pulls`                         | 서버가 운영자를 확인한 뒤에만 PR을 읽음. 비로그인 · 운영자 아님 → "Sign in required" + "Sign in with GitHub". 운영자 → 허용 저장소의 PR(open 먼저) · head · 승인 상태 · GitHub 링크, Sync PRs(재동기화 cursor 반복), 빈 상태 · 설정 없음 · DB 오류 |
| `/pulls/[repositoryId]/[number]` | 저장소 · 상태(Open · Closed · Merged) · 작성자 · full head SHA · revision · GitHub check · 승인자 · 승인 시각, 상태 안내, Approve(보인 HEAD · revision 전송) · Retry sync, revision 이력(이전 승인은 이력으로만)                                   |

- `StatusBadge`(아이콘 + 텍스트) · `Table` · `Card` · `Alert` · `Button` 재사용
- 승인 상태 표시는 `approvalStatus` 하나만 계산하고 `APPROVAL_STATUS_DISPLAY`로 그림. Visual의 `status-display.ts`와 분리
- **표시 상태** — Pending approval · Syncing to GitHub(반영 대기) · Sync unknown(응답 유실 · timeout) · Sync error · Approved(DB 기록 + GitHub 확인) · Closed · Merged · Blocked
- **client 경계** — 승인 · Retry sync · Sync PRs · Sign out 버튼만. 같은 origin `fetch` POST(form) → JSON. 중복 클릭은 ref로 막고 서버 claim · 멱등성과 함께 씀
- **캐시** — 세션 cookie를 읽는 dynamic 렌더링(`connection()`), API는 `no-store`. layout은 세션을 읽지 않음
- **브라우저로 가는 값** — CSRF token(세션 cookie 없이는 무용)뿐. GitHub credential · private key · DB URL · 세션 token 원문은 보내지 않음(세션 cookie는 HttpOnly)

## 12. 보안 경계

- **secret** — env에만. private key · client secret · webhook secret · DB URL을 로그 · `last_error` · 응답에 넣지 않음
- **사용자 토큰 미보관** — 세션은 opaque token의 hash만 DB에
- **installation token** — 요청 안에서만 사용. DB · 파일에 저장 안 함
- **최소 권한** — Checks write · Pull requests read · Metadata read. Contents 권한 없음
- **허용 목록 이중 확인** — repo ID · installation ID. 목록 밖 이벤트는 `ignored`
- **매 요청 운영자 확인** — 세션이 있어도 `APPROVER_GITHUB_IDS`를 다시 봄
- **harness 유지** — `.claude/settings.json` deny(`.env` 읽기 등) · `guard-bash.mjs` 변경 없음

## 13. 의존성

| 패키지        | 버전               | 필요성                                                      | 상태                                                          | 수정 파일                                  |
| ------------- | ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| `postgres`    | 3.4.9(정확히 고정) | PostgreSQL 접속. 내장 · Next에 대안 없음                    | **설치함**(Step 2, 사용자 승인)                               | `apps/web/package.json` · `pnpm-lock.yaml` |
| `zod`         | `^4.6.5`           | `apps/web`에서 직접 import. pnpm은 선언 안 된 패키지를 막음 | **선언함**(Step 2, 사용자 승인). lockfile에 있던 4.6.5 그대로 | `apps/web/package.json` · `pnpm-lock.yaml` |
| `server-only` | —                  | Next 16.3이 내부 처리 · 타입 제공                           | 설치 안 함                                                    | —                                          |

- **내장으로 처리** — HMAC · JWT RS256 · PKCE · 무작위 token(`node:crypto`), GitHub 호출(`fetch`), 쿠키(`next/headers`)
- **쓰지 않음** — Octokit · Auth.js · ORM · Redis · queue

## 14. 단계별 파일 계획

| Step | 내용                                  | 파일                                                                                                                                                                                                                                                                                                           | 검증                                                                           |
| ---- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 2    | 도메인 · DB 기반 — **완료**           | `lib/manual-approval/{schema,state,repository,deliveries}.ts`, `lib/auth/store.ts`, `lib/db/{config,client,transaction,migrate,migrate-cli,test-database}.ts`, `db/migrations/0001_manual_approval.sql`, `vitest.db.config.mts`, `*.test.ts` · `*.db-test.ts`                                                  | 순수 전이 vitest. 실제 PostgreSQL 17 통합 테스트(`nx test-db web`)             |
| 3    | GitHub 연동 · 로그인 · API — **완료** | `lib/github/{http,app-auth,api,pulls,checks,webhook,fake-github}.ts`, `lib/auth/{oauth,session}.ts`, `lib/manual-approval/{config,sync,approve,webhook,reconcile,runtime,route-input,test-support}.ts`, `db/migrations/0002_cancel_obsolete_checks.sql`, route 6개                                             | 단위 107 · DB 통합 83(가짜 GitHub transport). 실제 GitHub 미실행               |
| 4    | (Step 3에 포함)                       | —                                                                                                                                                                                                                                                                                                              | —                                                                              |
| 5    | 화면 — **완료**(사용자 Step 4)        | `app/pulls/{page,loading}.tsx`, `app/pulls/[repositoryId]/[number]/{page,loading}.tsx`, `components/review/{pull-requests-table,revision-history,approval-gate,external-link,approval-actions,pull-request-list-actions,action-feedback}.tsx`, `lib/manual-approval/{display,viewer,e2e-seed}.ts`, layout 링크 | lint · typecheck · test · DB 통합. E2E 12개는 작성 · 목록 확인만 — 사용자 실행 |
| 6    | 배포 · App 설치 · 시나리오            | 문서만(`docs/manual-approval/`). Vercel · Neon · App 생성은 사용자                                                                                                                                                                                                                                             | 새 PR → 대기 → 로그인 → 승인 → success → push 재승인 → close                   |

- 기존 `/` · `/runs/[runId]` · `/artifacts/...` · e2e는 각 Step에서 깨지지 않아야 함

## 15. 확인하지 못한 것

- **Vercel의 pnpm 11.25 · Node 24 지원** — 배포 전에 Vercel 문서 · 실제 build로 확인
- **Vercel 함수 시간 제한** — webhook은 8초 내부 deadline이라 무관. 재동기화 `maxDuration`은 플랜 확인 후 결정
- **Neon pooler와 Postgres.js** — `prepare: false` · URL query 제거 · `SET LOCAL` 시간 제한으로 맞춤. 실제 Neon 접속은 Step 6에서 확인
- **Checks API로 `queued` 생성** — 공식 guide는 App이 `queued` · `in_progress` · `completed`를 쓸 수 있다고 함. 가짜 GitHub로만 확인, 실제 호출은 setup.md §7~8
- **`commits/{sha}/pulls`의 fork PR 포함 범위** — 실제 응답으로 확인 필요. 결과를 base 저장소 ID · state · head SHA로 다시 거름

## 16. 로컬 DB

review-platform 전용 PostgreSQL. snapdone 등 다른 서비스의 DB를 쓰지 않음.

```bash
# 일회용 PostgreSQL 17 (127.0.0.1에만 열림)
docker run -d --rm --name review-platform-pg -p 127.0.0.1:54329:5432 \
  -e POSTGRES_USER=review -e POSTGRES_PASSWORD=review -e POSTGRES_DB=review_platform_test postgres:17
docker exec review-platform-pg createdb -U review review_platform_dev

# migration — 이미 적용한 파일은 건너뜀. 기존 테이블을 지우지 않음
DATABASE_URL=postgres://review:review@127.0.0.1:54329/review_platform_dev pnpm db:migrate

# 통합 테스트 — 테스트 파일마다 schema를 새로 만들고 끝나면 지움. cache 없음
TEST_DATABASE_URL=postgres://review:review@127.0.0.1:54329/review_platform_test pnpm nx test-db web

docker stop review-platform-pg
```

- **TLS** — `localhost` · `127.0.0.1` · `[::1]`만 평문. 그 밖은 `verify-full`. URL의 `sslmode` 등 query는 무시
- **`TEST_DATABASE_URL` 없음** — 통합 테스트는 건너뛰지 않고 실패
- **`DATABASE_URL` 없음** — 승인 경로 · migration은 `ConfigurationError`. Visual 화면은 영향 없음
- **복구** — migration은 전체가 transaction 하나. 실패하면 아무것도 적용되지 않으므로 원인을 고친 뒤 다시 실행
