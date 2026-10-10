# Manual Approval — 설정 · 운영

DB · 배포 · GitHub App 설치부터 첫 승인, required 지정, 장애 복구까지 운영자가 하는 일. 동작은 [architecture.md](architecture.md).

- **대상 저장소에는 파일을 추가하지 않음** — 이벤트는 App webhook으로 오고 Check는 review-platform이 씀
- **secret 값은 기록하지 않음** — 호스팅 환경변수와 로컬 `.env.local`에만

## 대상 저장소

App 설치 범위와 `GITHUB_ALLOWED_REPOSITORY_IDS` **둘 다에 있는 저장소만** 대상. 목록은 이 두 곳에만 둠.

### 추가

1. repository ID 확인 — `curl -s https://api.github.com/repos/<owner>/<name> | jq .id`
2. GitHub → Settings → Applications → Installed GitHub Apps → 이 App → Configure → 저장소 추가
3. `GITHUB_ALLOWED_REPOSITORY_IDS`에 ID 추가 → Redeploy
4. `/pulls` → **Sync PRs**
5. [§8](#8-테스트-pr로-첫-승인) → 원하면 [§9](#9-required-check-지정-선택)

### 제거

1. 그 저장소 ruleset의 required에서 `Review Platform / Manual Approval`을 먼저 뺌
2. `GITHUB_ALLOWED_REPOSITORY_IDS`에서 ID 제거 → Redeploy
3. App Configure에서 저장소 제거

## 1. DB와 배포

- **DB** — 전용 Neon 프로젝트(무료 플랜, [선정 기록](../records/2026-10-10-neon-for-approval-db.md)). 앱용 `DATABASE_URL`은 Connect의 pooled 연결 문자열, migration은 pooling을 끈 direct 연결 문자열
- **Vercel** — production 도메인 하나를 `PUBLIC_BASE_URL`로 고정

| Vercel 설정                                        | 값                         |
| -------------------------------------------------- | -------------------------- |
| Framework Preset                                   | Next.js                    |
| Root Directory                                     | `apps/web`                 |
| Include source files outside of the Root Directory | 켬                         |
| Install · Build · Output Command                   | 기본값                     |
| Node.js Version                                    | 24.x                       |
| `ENABLE_EXPERIMENTAL_COREPACK`                     | `1` (Production · Preview) |

## 2. GitHub App 만들기

`github.com/settings/apps/new`

| 항목                                                   | 값                                               |
| ------------------------------------------------------ | ------------------------------------------------ |
| Homepage URL                                           | `PUBLIC_BASE_URL`                                |
| Callback URL                                           | `PUBLIC_BASE_URL/api/auth/github/callback`       |
| Expire user authorization tokens                       | 켬                                               |
| Request user authorization (OAuth) during installation | 끔                                               |
| Enable Device Flow                                     | 끔                                               |
| Webhook URL                                            | `PUBLIC_BASE_URL/api/github/webhook`             |
| Webhook secret                                         | `openssl rand -hex 32` → `GITHUB_WEBHOOK_SECRET` |
| Where can this GitHub App be installed?                | Only on this account                             |

## 3. 권한과 이벤트

| 구분                   | 값                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Repository permissions | Checks: **Read and write** · Pull requests: **Read-only** · Metadata: **Read-only** |
| Subscribe to events    | **Pull request**                                                                    |

## 4. App 값

| App 설정 페이지              | 환경변수                   |
| ---------------------------- | -------------------------- |
| App ID                       | `GITHUB_APP_ID`            |
| Client ID                    | `GITHUB_APP_CLIENT_ID`     |
| Generate a new client secret | `GITHUB_APP_CLIENT_SECRET` |
| Generate a private key       | `GITHUB_APP_PRIVATE_KEY`   |

운영자 ID — `curl -s https://api.github.com/users/<login> | jq .id` → `APPROVER_GITHUB_IDS`

## 5. 환경변수 · migration

| 이름                            | 값                                      | Production | Preview |
| ------------------------------- | --------------------------------------- | ---------- | ------- |
| `ENABLE_EXPERIMENTAL_COREPACK`  | `1`                                     | ○          | ○       |
| `REVIEW_DATA_DIR`               | 절대 경로(예: `/var/task/.review-data`) | ○          | ○       |
| `PUBLIC_BASE_URL`               | `https://<production 도메인>`           | ○          | —       |
| `DATABASE_URL`                  | pooled 연결 문자열                      | ○          | —       |
| `GITHUB_APP_ID`                 | §4                                      | ○          | —       |
| `GITHUB_APP_CLIENT_ID`          | §4                                      | ○          | —       |
| `GITHUB_APP_CLIENT_SECRET`      | §4                                      | ○          | —       |
| `GITHUB_APP_PRIVATE_KEY`        | PEM 전체(한 줄이면 줄바꿈을 `\n`으로)   | ○          | —       |
| `GITHUB_WEBHOOK_SECRET`         | §2                                      | ○          | —       |
| `GITHUB_INSTALLATION_ID`        | §6                                      | ○          | —       |
| `GITHUB_ALLOWED_REPOSITORY_IDS` | 대상 repository ID, 쉼표 구분           | ○          | —       |
| `APPROVER_GITHUB_IDS`           | §4, 쉼표 구분                           | ○          | —       |

- 하나라도 없거나 잘못되면 `/pulls`는 "Manual approval is not configured", 승인 route는 503 `not-configured`
- Preview에는 승인 값이 없으므로 Preview의 `/pulls`는 not-configured

### migration

배포 전에 direct 연결 문자열로.

```bash
read -rs DATABASE_URL && export DATABASE_URL
pnpm db:migrate
unset DATABASE_URL
```

## 6. App 설치

- App 페이지 → **Install App** → **Only select repositories** → 대상 저장소 선택
- 설치 후 주소 `github.com/settings/installations/<숫자>`의 숫자 → `GITHUB_INSTALLATION_ID` → Redeploy

## 7. 연결 확인

1. App 설정 → Advanced → Recent Deliveries → `ping` → **Redeliver** → 200 `{"result":"ignored"}`
2. 잘못된 서명 → 401:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$PUBLIC_BASE_URL/api/github/webhook" \
     -H 'X-GitHub-Event: ping' -H 'X-GitHub-Delivery: manual-check' \
     -H 'X-Hub-Signature-256: sha256=0000' -d '{}'
   ```

3. `/pulls` → **Sign in with GitHub** → 목록
4. 열려 있던 PR이 있으면 **Sync PRs**
5. 읽기 전용 smoke:

   ```bash
   cd apps/web-e2e && LIVE_SMOKE=1 BASE_URL=$PUBLIC_BASE_URL pnpm exec playwright test live-smoke
   ```

## 8. 테스트 PR로 첫 승인

```bash
cd ~/Documents/project/<repo>
git fetch origin
git worktree add -b test/review-platform-manual-approval ../<repo>-e2e origin/main
cd ../<repo>-e2e
printf '# Review Platform manual approval E2E\n\nTemporary file. Do not merge.\n' > REVIEW_PLATFORM_E2E.md
git add REVIEW_PLATFORM_E2E.md && git commit -m "test: add Review Platform manual approval E2E marker"
git push -u origin test/review-platform-manual-approval
gh pr create --draft --base main --title "[test] Review Platform manual approval E2E — do not merge" --body "Temporary."
```

| 확인                        | 기대                                                                   |
| --------------------------- | ---------------------------------------------------------------------- |
| PR Checks 탭                | `Review Platform / Manual Approval` Queued                             |
| `/pulls` → PR → **Approve** | "Approved. GitHub confirmed the check for head commit …"               |
| PR Checks 탭                | Success, summary `Manual approval only. No automated checks were run.` |
| 두 번째 commit push         | 새 head에 Queued. 이전에 승인한 Check는 Success 유지                   |
| close 뒤                    | 승인 버튼 없음                                                         |

```bash
printf '\nSecond commit.\n' >> REVIEW_PLATFORM_E2E.md
git commit -am "test: change head for Review Platform manual approval E2E" && git push

gh pr close <번호> --delete-branch
cd ../<repo> && git worktree remove ../<repo>-e2e
```

## 9. Required check 지정 (선택)

- Settings → Rules → Rulesets → main ruleset → Require status checks to pass → Add checks → `Review Platform / Manual Approval`
- **source는 이 GitHub App으로** 지정
- 기존 required check는 그대로 두고 추가
- 목록에 이름이 없으면 §8을 먼저
- merge queue를 켜지 않음

## 10. 장애 복구

| 증상                                         | 조치                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| PR에 Check가 안 생김                         | Recent Deliveries의 실패 delivery **Redeliver**, 또는 `/pulls` **Sync PRs** |
| 승인 뒤 not confirmed · Sync unknown · error | PR 상세 **Retry sync**                                                      |
| `/pulls`가 not configured                    | 환경변수 수정 후 Redeploy                                                   |
| 409 `shared-head`                            | 같은 SHA의 다른 open PR을 정리한 뒤 승인                                    |
| PR이 Blocked                                 | App 설치 · 저장소 접근 복구 뒤 **Sync PRs**                                 |
| 다시 로그인 요구                             | 세션 12시간 만료                                                            |

- **App 제거 전** — 이 Check를 required에서 먼저 뺌. 제거 뒤에는 Queued로 남은 PR이 merge되지 않음

### curl

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

# 승인
curl -sS -X POST "$BASE/api/pulls/<repositoryId>/<number>/approve" -H "Origin: $BASE" \
  -b "__Host-rp_session=$SESSION" --data-urlencode "csrf=$CSRF" \
  --data-urlencode "expectedHeadSha=<40자 head SHA>" --data-urlencode "expectedRevision=<revision>"
```

## 11. 로컬 검증

```bash
docker run -d --rm --name review-platform-pg -p 127.0.0.1:54329:5432 \
  -e POSTGRES_USER=review -e POSTGRES_PASSWORD=review -e POSTGRES_DB=review_platform_test postgres:17
docker exec review-platform-pg createdb -U review review_platform_e2e

TEST_DATABASE_URL=postgres://review:review@127.0.0.1:54329/review_platform_test pnpm nx test-db web
pnpm nx build web
E2E_DATABASE_URL=postgres://review:review@127.0.0.1:54329/review_platform_e2e pnpm e2e

docker stop review-platform-pg
```

`E2E_DATABASE_URL`이 없으면 수동 승인 E2E는 skip.
