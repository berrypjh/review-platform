# Manual Approval — 배포 · 연결 · 복구 절차

전용 DB와 배포 주소 확보부터 GitHub App 설치, 첫 승인, 선택적 required 지정, 장애 복구까지 사용자가 하는 일. 설계는 [architecture.md](architecture.md), 진행은 [progress.md](progress.md).

- **자동 복구 없음** — GitHub은 실패한 webhook을 다시 보내지 않고, 이 앱에도 재시도 worker · cron이 없음. 장애 뒤에는 [§10 복구](#10-장애-복구와-app-제거)를 사람이 실행
- **값은 기록하지 않음** — secret · private key · DB URL은 호스팅 환경변수와 로컬 `.env.local`에만. 이 문서 · 저장소 · 로그에 쓰지 않음
- **이 문서의 어떤 단계도 아직 실행되지 않음** — DB · 배포 · App 생성 · 설치 · required 지정은 모두 사용자 작업([progress.md](progress.md))

## 0. 대상 저장소 쪽 변경: 없음

승인 연동은 **GitHub App을 세 저장소에 설치하는 것만으로** 동작함. 대상 저장소에 넣을 파일이 없음.

| 대상 저장소                | 새 workflow | 패키지 · import | App private key secret | 기존 CI · Visual · Chromatic |
| -------------------------- | ----------- | --------------- | ---------------------- | ---------------------------- |
| shared-stack(`1217703464`) | 없음        | 없음            | 없음                   | 그대로                       |
| it-tech-blog(`1193614508`) | 없음        | 없음            | 없음                   | 그대로(`.github/` 자체 없음) |
| snapdone(`1335530823`)     | 없음        | 없음            | 없음                   | 그대로                       |

- **이유** — PR 이벤트는 App webhook으로 오고, Check는 App installation token으로 review-platform 서버가 씀. 대상 저장소의 Actions가 관여하지 않음
- **review-platform(`1385325506`) 자신은 대상이 아님** — 허용 목록 · 설치 대상에 넣지 않음
- **기존 Visual reusable workflow · manifest** — 이 연동과 무관. 그대로 둠
- 괄호 안 숫자는 공개 API(`GET /repos/berrypjh/<name>`)로 2026-10-10에 확인한 repository ID

## 1. 전용 DB와 고정 배포 주소

- **DB** — review-platform 전용 managed PostgreSQL(기본 후보 Neon). snapdone의 Cloud SQL · 세션 테이블을 쓰지 않음
  - 앱용 연결 문자열(Neon이면 pooled) → `DATABASE_URL`. 앱은 prepared statement를 쓰지 않아 transaction pooler와 맞음
  - migration용으로는 direct(unpooled) 연결 문자열을 따로 보관
  - TLS는 앱이 `verify-full`로 강제. URL의 `sslmode` · `channel_binding` 같은 query는 무시됨
- **Vercel 프로젝트** — 이 저장소를 import, 아래 설정으로 생성. **production 도메인 하나를 고정**(커스텀 도메인 또는 프로젝트의 production `*.vercel.app` 도메인) → `PUBLIC_BASE_URL`
  - 배포마다 바뀌는 deployment URL(`<project>-<hash>.vercel.app`)은 쓰지 않음 — Standard Protection이 막고, 주소도 바뀜

### Vercel 프로젝트 설정

| 항목                                               | 값                                  | 근거                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework Preset                                   | Next.js                             | `apps/web`이 Next 16.3.6 앱                                                                                                                                                       |
| Root Directory                                     | `apps/web`                          | [Vercel monorepos](https://vercel.com/docs/monorepos) — 앱 디렉터리를 지정                                                                                                        |
| Include source files outside of the Root Directory | 켬(2020-08-27 이후 프로젝트 기본값) | `apps/web`이 `libs/visual-contracts`(`workspace:*`)를 씀 — [Monorepos FAQ](https://vercel.com/docs/monorepos/monorepo-faq)                                                        |
| Install Command                                    | 기본값(override 끔)                 | 저장소 root의 `pnpm-lock.yaml`로 pnpm workspace 설치                                                                                                                              |
| Build Command                                      | 기본값(override 끔) → `next build`  | `apps/web/package.json`에 `build` script 없음. Nx는 배포 build에 필요 없음                                                                                                        |
| Output Directory                                   | 기본값                              | Next.js preset이 정함                                                                                                                                                             |
| Node.js Version                                    | 24.x                                | root `engines.node: ">=24"` → Vercel이 최신 24.x 선택([Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions))                                       |
| 환경변수 `ENABLE_EXPERIMENTAL_COREPACK`            | `1` (Production · Preview 모두)     | Vercel 지원 표는 pnpm 6~10. root `packageManager: pnpm@11.25.0`을 Corepack으로 고정 — [Configuring a build · Corepack](https://vercel.com/docs/builds/configure-a-build#corepack) |
| Deployment Protection                              | Standard Protection(기본)           | production 도메인은 보호하지 않음 → GitHub webhook · OAuth callback이 막히지 않음. Preview는 Vercel 로그인 뒤에 있음                                                              |

- **저장소에 hosting 설정 파일을 두지 않음** — 위 값은 모두 대시보드 설정 · 기본값. `vercel.json` 불필요
- **file tracing** — Next 16.3은 `outputFileTracingRoot`가 없으면 lockfile 위치로 저장소 root를 찾아 tracing root로 씀(설치된 `next/dist/server/config.js`의 `findRootDirAndLockFiles`). root `.pnpm` store의 `postgres`가 함수 번들에 포함됨. `next.config.js` 수정 불필요
- **Visual 화면** — 배포 번들에는 `.review-data` · Visual artifact가 없음. 서버리스 배포에서 Visual run을 보여 준다고 보지 않음. `REVIEW_DATA_DIR`를 절대 경로(예: `/var/task/.review-data`, 존재하지 않아도 됨)로 두면 `/`는 빈 목록을 보임 — 상대 경로는 `pnpm-workspace.yaml`을 찾는데 번들에 없을 수 있음
- **승인 데이터는 DB에만** — `/tmp` · `.review-data` · 로컬 SQLite를 영구 저장소로 쓰지 않음

## 2. GitHub App 만들기

`github.com/settings/apps/new` (berrypjh 계정 소유).

| 항목                                                   | 값                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| GitHub App name                                        | 자유. Check 이름과는 무관(`Review Platform / Manual Approval`은 코드 고정) |
| Homepage URL                                           | `PUBLIC_BASE_URL`                                                          |
| Callback URL                                           | `PUBLIC_BASE_URL` + `/api/auth/github/callback` — 정확히 이 값 하나        |
| Expire user authorization tokens                       | 켬(기본값)                                                                 |
| Request user authorization (OAuth) during installation | 끔                                                                         |
| Enable Device Flow                                     | 끔                                                                         |
| Webhook · Active                                       | 켬                                                                         |
| Webhook URL                                            | `PUBLIC_BASE_URL` + `/api/github/webhook`                                  |
| Webhook secret                                         | 무작위 긴 값(예: `openssl rand -hex 32`) → `GITHUB_WEBHOOK_SECRET`         |
| Where can this GitHub App be installed?                | Only on this account                                                       |

- **별도 OAuth App을 만들지 않음** — 로그인도 같은 App의 user authorization
- App을 만들 때 GitHub이 보내는 `ping`은 아직 서버가 준비 전이면 실패함. §7에서 Redeliver로 다시 보냄

## 3. 권한과 webhook 구독

| 구분                   | 값                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Repository permissions | **Checks: Read and write** · **Pull requests: Read-only** · **Metadata: Read-only**(필수). 그 밖은 No access |
| Subscribe to events    | **Pull request**만                                                                                           |
| 자동 전달(구독 불필요) | `installation` · `installation_repositories` · `github_app_authorization`                                    |

- **요청하지 않는 권한** — Contents · Pull requests write · Actions · Administration. 소스 checkout · PR 리뷰 · merge를 하지 않음
- **다른 이벤트** — 구독하지 않음. 와도 서버가 `ignored`로 기록만 함(`check_run` · `check_suite` · `merge_group` 포함)

## 4. Private key와 ID

App 설정 페이지에서:

- **App ID**(숫자) → `GITHUB_APP_ID` — Check 소유 확인 · `app_id` 필터
- **Client ID**(`Iv…`) → `GITHUB_APP_CLIENT_ID` — OAuth · App JWT `iss`. App ID와 다른 값
- **Generate a new client secret** → `GITHUB_APP_CLIENT_SECRET`
- **Generate a private key**(PEM 다운로드) → `GITHUB_APP_PRIVATE_KEY`. 파일은 환경변수에 넣은 뒤 안전하게 보관 · 삭제. 저장소에 두지 않음
- **운영자 numeric ID** → `APPROVER_GITHUB_IDS` — `curl -s https://api.github.com/users/<login> | jq .id`. berrypjh는 `89543695`(공개 API로 확인). 쉼표로 여러 명 가능

## 5. 환경변수 · migration · 배포

### 환경변수

| 이름                            | 값                                            | Production | Preview |
| ------------------------------- | --------------------------------------------- | ---------- | ------- |
| `ENABLE_EXPERIMENTAL_COREPACK`  | `1`                                           | ○          | ○       |
| `REVIEW_DATA_DIR`               | 절대 경로(예: `/var/task/.review-data`)       | ○          | ○       |
| `PUBLIC_BASE_URL`               | `https://<고정 production 도메인>`(경로 없음) | ○          | —       |
| `DATABASE_URL`                  | 전용 DB의 앱용 연결 문자열                    | ○ Secret   | —       |
| `GITHUB_APP_ID`                 | §4                                            | ○          | —       |
| `GITHUB_APP_CLIENT_ID`          | §4                                            | ○          | —       |
| `GITHUB_APP_CLIENT_SECRET`      | §4                                            | ○ Secret   | —       |
| `GITHUB_APP_PRIVATE_KEY`        | §4 PEM 전체(한 줄이면 줄바꿈을 `\n`으로)      | ○ Secret   | —       |
| `GITHUB_WEBHOOK_SECRET`         | §2                                            | ○ Secret   | —       |
| `GITHUB_INSTALLATION_ID`        | §6에서 확인 후 추가                           | ○          | —       |
| `GITHUB_ALLOWED_REPOSITORY_IDS` | `1217703464,1193614508,1335530823`            | ○          | —       |
| `APPROVER_GITHUB_IDS`           | §4                                            | ○          | —       |

- **이름** — 코드의 이름은 `GITHUB_ALLOWED_REPOSITORY_IDS`(요청서의 `ALLOWED_REPOSITORY_IDS`에 해당). `GITHUB_INSTALLATION_ID`도 필요 — webhook의 installation ID를 이 값과 비교하고 token을 이 installation에서만 받음
- **추가 세션 · 암호화 키 없음** — 세션은 DB에 hash만 둔 opaque token, CSRF token은 세션 token에서 유도. 서명 · 암호화용 별도 secret이 필요 없음
- **Preview 분리** — 승인 관련 값은 **Production에만**. Preview에는 넣지 않음 → Preview의 `/pulls` · 승인 API는 `not-configured`(503)로 닫힘. production App secret · DB에 닿지 않음
  - Preview에서도 승인을 시험하려면 **별도 GitHub App + 별도 DB**를 만들어 Preview 환경에만 넣음(같은 App · DB 재사용 금지)
- **하나라도 없거나 잘못되면** — 승인 route는 503 `not-configured`, 화면은 "Manual approval is not configured". 일부 설정으로 동작하지 않음(fail closed)
- **다른 토큰으로 대신하지 않음** — PAT · `GITHUB_TOKEN` fallback 없음
- 환경변수 변경은 **다음 배포부터** 적용됨(Vercel). 바꾼 뒤 Redeploy

로컬 `apps/web/.env.example`(placeholder만, 커밋 가능 — `.gitignore`가 `!.env.example` 허용)은 AI 세션의 permission 설정이 쓰기를 막아 만들지 못함. 필요하면 아래 내용으로 사용자가 만듦.

```dotenv
# PR 수동 승인 설정. 실제 값은 .env.local(커밋 안 함)이나 호스팅 환경변수에만 둔다.
# Visual 화면(/, /runs)은 이 값 없이 동작한다. 설정 절차: docs/manual-approval/setup.md
DATABASE_URL=postgres://USER:PASSWORD@HOST/DBNAME
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
# PEM 전체. 한 줄로 넣을 때는 줄바꿈을 \n으로 적는다.
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_INSTALLATION_ID=
GITHUB_ALLOWED_REPOSITORY_IDS=
APPROVER_GITHUB_IDS=
PUBLIC_BASE_URL=http://localhost:3000
# DB 통합 테스트(nx test-db web) 전용
TEST_DATABASE_URL=postgres://review:review@127.0.0.1:54329/review_platform_test
```

### migration (사용자가 직접, 배포 전)

```bash
# direct(unpooled) 연결 문자열로. 셸 기록에 남지 않게 입력
read -rs DATABASE_URL && export DATABASE_URL
pnpm db:migrate        # "Applied 0001…, 0002…" → 다시 실행하면 "Database is up to date."
unset DATABASE_URL
```

- **build · 요청 중에 자동 적용하지 않음** — 앱 코드에 migration 호출이 없음. 새 migration이 생기면 배포 전에 같은 명령
- 실패하면 전체가 rollback됨. 원인을 고친 뒤 다시 실행

### 배포

- main에 push하면 Vercel이 production 배포(Git 연동 기본 동작). 이 저장소에 배포 pipeline을 새로 만들지 않음
- 첫 배포 뒤 확인 — `/`는 빈 Visual 목록, `/pulls`는 아직 `GITHUB_INSTALLATION_ID`가 없어 "not configured"(정상)

## 6. App 설치 (selected repositories 세 개)

- App 페이지 → **Install App** → berrypjh → **Only select repositories** → shared-stack · it-tech-blog · snapdone
- review-platform은 선택하지 않음
- 설치 뒤 주소 `github.com/settings/installations/<숫자>`의 숫자 → `GITHUB_INSTALLATION_ID` 추가 → **Redeploy**
- **범위 확인** — Installed GitHub Apps → Configure에서 저장소가 정확히 세 개인지. 앱은 허용 목록 밖 저장소의 이벤트를 `ignored`로 버리고, token도 허용 저장소로만 받음

## 7. Webhook ping과 bootstrap

1. App 설정 → **Advanced → Recent Deliveries** → 처음 `ping` → **Redeliver** → 응답 200 `{"result":"ignored"}`
2. 잘못된 서명 거부 확인:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$PUBLIC_BASE_URL/api/github/webhook" \
     -H 'X-GitHub-Event: ping' -H 'X-GitHub-Delivery: manual-check' \
     -H 'X-Hub-Signature-256: sha256=0000' -d '{}'
   # 401
   ```

3. `PUBLIC_BASE_URL/pulls` → **Sign in with GitHub** → 운영자 계정으로 승인 → 목록
4. 이미 열려 있던 PR이 있으면 **Sync PRs**(cursor가 끝날 때까지 이어 부름). 각 PR head에 `Review Platform / Manual Approval`이 **Queued**로 생김
5. **재시작 지속** — Vercel에서 Redeploy한 뒤 `/pulls`를 다시 열어 같은 목록 · 상태가 보이는지(데이터는 DB에 있음)

## 8. 첫 승인을 성공시킨 뒤에만 required 선택

1. 대상 저장소 하나에서 시험 PR을 엶(사용자 작업) → Checks 탭에 Queued 확인
2. `/pulls`에서 그 PR → **Approve** → "Approved. GitHub confirmed the check …"
3. GitHub PR Checks 탭에서 `Review Platform / Manual Approval`이 **Success**, summary에 `Manual approval only. No automated checks were run.` 확인
4. push → 새 head에 Queued, 이전 head의 대기 Check는 Cancelled(승인된 Check는 그대로) · close → 승인 불가 확인
5. 여기까지 된 저장소에서만, 원할 때 §9로 required 지정. **지정은 선택**이며 이 기능의 완료 조건이 아님

## 9. Required check 지정 (선택 · 사용자 결정)

| 저장소       | 현재 main ruleset(공개 API, 2026-10-10)                                                                                                      | classic branch protection |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| snapdone     | ruleset 24783824 — deletion · non_fast_forward · pull_request · **required: `checks` · `e2e` · `docker`**(GitHub Actions, integration 15368) | 확인 불가(비인증 401)     |
| shared-stack | ruleset 15386561 — deletion · non_fast_forward · pull_request. **required status check 항목 없음**                                           | 확인 불가(비인증 401)     |
| it-tech-blog | 적용된 rule 없음                                                                                                                             | 확인 불가(비인증 401)     |

- **추가만 함** — 기존 required check · bypass 목록 · 다른 rule을 바꾸지 않음. snapdone의 `checks` · `e2e` · `docker`는 그대로 두고 Manual Approval은 **추가 조건**
- **정확한 이름** — `Review Platform / Manual Approval`
- **source 지정** — Settings → Rules → Rulesets → main ruleset → Require status checks to pass → Add checks에서 이 이름을 고르고 **source를 이 GitHub App으로**("any source" 아님). 다른 App · Actions가 같은 이름을 써도 통과하지 않게 함
- 목록에 이름이 안 보이면 최근에 이 Check가 실행된 적이 없는 것 — §8을 먼저
- classic branch protection은 권한이 없어 확인하지 못함. 설정 화면에서 둘 다 있는지 직접 확인
- merge queue는 지원하지 않음(`merge_group` 미처리). required로 둔 저장소에서 merge queue를 켜지 않음

## 10. 장애 복구와 App 제거

### webhook 실패

- **증상** — Recent Deliveries에 실패(503 · timeout), 또는 PR Check가 안 생김
- **GitHub Redeliver** — 실패한 delivery의 "Redeliver". 같은 delivery ID로 오며, 앱은 `failed` · 버려진 `processing` delivery만 다시 처리(끝난 delivery는 no-op)
- **화면** — `/pulls`의 **Sync PRs**(반영 안 된 PR + open PR 전체) 또는 PR 상세의 **Retry sync**(그 PR만)

### 승인이 "not confirmed" · Sync unknown · Sync error

- 승인 의사는 DB에 기록됨. GitHub 반영만 확인하지 못한 상태(timeout · 5xx · 응답 유실)
- PR 상세의 **Retry sync**. 승인 이력 · 시각은 새로 생기지 않음
- 재시도는 이 App · Check 이름 · SHA · external_id로 기존 Check를 먼저 찾아 채택. 중복이 있으면 가장 작은 id만 남기고 이 App의 나머지 미완료 run을 Cancelled

### 설치 · 권한 변경과 App 제거

- installation 정지 · 삭제, 저장소 제거 → 해당 PR을 `blocked`로, 모든 쓰기 거부(fail closed). 다른 토큰으로 대신하지 않음
- 다시 설치 · 정지 해제 뒤 **Sync PRs**가 installation token으로 접근을 다시 확인하고 차단을 풂
- 운영자가 App authorization을 철회하면 그 사용자의 세션이 모두 철회됨 → 다시 로그인
- **App을 제거하기 전에** — 이 Check를 required로 지정한 ruleset에서 먼저 뺌. 제거 뒤에는 Check를 갱신할 주체가 없어 Queued로 남은 PR이 merge되지 않음
- 제거 뒤에도 commit에 이미 남은 Check run(Success · Cancelled · Queued)은 GitHub에 그대로 있음

### 화면 없이 할 때(curl)

```bash
BASE=https://<PUBLIC_BASE_URL>
SESSION='<__Host-rp_session 쿠키 값>'
CSRF=$(printf 'csrf:%s' "$SESSION" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')

# PR 하나 재동기화
curl -sS -X POST "$BASE/api/github/reconcile" -H "Origin: $BASE" -b "__Host-rp_session=$SESSION" \
  --data-urlencode "csrf=$CSRF" -d repositoryId=<id> -d number=<n>

# 전체 재동기화(cursor가 null이 될 때까지 반복)
curl -sS -X POST "$BASE/api/github/reconcile" -H "Origin: $BASE" -b "__Host-rp_session=$SESSION" \
  --data-urlencode "csrf=$CSRF" [-d cursor=<이전 응답의 cursor>]

# 승인 — 화면이 보던 HEAD SHA와 revision을 함께 보낸다
curl -sS -X POST "$BASE/api/pulls/<repositoryId>/<number>/approve" -H "Origin: $BASE" \
  -b "__Host-rp_session=$SESSION" --data-urlencode "csrf=$CSRF" \
  --data-urlencode "expectedHeadSha=<40자 head SHA>" --data-urlencode "expectedRevision=<revision>"
```

## 11. 배포 확인 목록

| 항목                      | 방법                              | 기대                                                 |
| ------------------------- | --------------------------------- | ---------------------------------------------------- |
| build                     | Vercel 첫 배포 로그               | pnpm 11.25(Corepack) · Node 24 · `next build` 성공   |
| Visual 보존               | `GET /`                           | 200, 빈 Visual 목록(배포에는 run이 없음)             |
| HTTPS · 로그인 · callback | `/pulls` → Sign in with GitHub    | GitHub → `/api/auth/github/callback` → `/pulls` 목록 |
| 운영자 아님               | 다른 GitHub 계정으로 로그인       | 403 `not-an-approver`, 세션 없음                     |
| webhook ping              | Recent Deliveries → Redeliver     | 200 `ignored`                                        |
| 잘못된 서명               | §7의 curl                         | 401                                                  |
| installation 범위         | Installed GitHub Apps → Configure | 세 저장소만                                          |
| DB 연결 · 재시작 지속     | Redeploy 뒤 `/pulls`              | 같은 목록 · 상태                                     |
| Preview 격리              | Preview 배포의 `/pulls`           | "Manual approval is not configured"                  |
| 첫 승인                   | §8                                | GitHub Checks 탭 Success                             |
| 기존 CI · Visual          | 대상 저장소의 다음 PR             | 기존 check 이름 · 결과 그대로 + Manual Approval 추가 |

## 12. 알아둘 점

- **공식 PR Review · CI · merge와 무관** — 이 Check는 수동 승인 기록일 뿐. 승인은 기존 필수 Check를 대신하지 않음
- **같은 SHA의 open PR이 둘 이상** — 승인 거부(409 `shared-head`). Check는 commit 단위라 한쪽 승인이 다른 쪽에 이월되기 때문
- **bootstrap은 open PR만** — DB에 open으로 남았지만 GitHub에서 이미 닫힌 PR은 그 PR의 Retry sync로 맞춤
- **함수 시간** — webhook `maxDuration` 10초(내부 8초), 승인 30초, 재동기화 60초. 플랜 상한이 더 짧으면 조정 필요

## 13. 로컬 검증 명령

AI 세션에서는 hook이 build · E2E를 막으므로 사용자 터미널에서 실행.

```bash
# 테스트 PostgreSQL (일회용)
docker run -d --rm --name review-platform-pg -p 127.0.0.1:54329:5432 \
  -e POSTGRES_USER=review -e POSTGRES_PASSWORD=review -e POSTGRES_DB=review_platform_test postgres:17
docker exec review-platform-pg createdb -U review review_platform_e2e

# 서버 통합 테스트(가짜 GitHub transport)
TEST_DATABASE_URL=postgres://review:review@127.0.0.1:54329/review_platform_test pnpm nx test-db web

# production build (route · server-only 포함)
pnpm nx build web

# E2E — 기존 Visual 7개 + 수동 승인 12개. E2E_DATABASE_URL이 없으면 수동 승인 12개는 skip으로 보고됨
E2E_DATABASE_URL=postgres://review:review@127.0.0.1:54329/review_platform_e2e pnpm e2e

docker stop review-platform-pg
```

- **E2E의 GitHub** — 서버에는 형식만 맞춘 GitHub App 값이 붙고, GitHub를 부르는 브라우저 요청(승인 · Retry sync)은 spec이 가로챔. 실제 GitHub 동작은 §7~8
- **배포 서버를 볼 때** — `BASE_URL=https://… pnpm e2e`. 로컬 서버를 띄우지 않고, 수동 승인 spec은 skip(배포 DB에 테스트 데이터를 넣지 않음)
