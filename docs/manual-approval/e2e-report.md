# Manual Approval — End-to-End 검증 기록

**결론 — 구현 · 로컬 검증 완료(브라우저 E2E · production build는 미실행), 실제 GitHub 검증 0/3.**
세 저장소 각각 실제 PR에서 아래 루프가 확인되기 전에는 "실제 연동 검증 완료"라고 쓰지 않음.

- 기록 시각 — 2026-10-10T08:31Z(로컬 검증 실행)
- 로컬 revision — `aa774d6`(Initial commit) + **미커밋 변경 34개 항목**. 수동 승인 구현 전체가 아직 커밋 · push되지 않음
- 배포 revision — **없음**. `origin/main`은 `aa774d6`이고 이 커밋에는 수동 승인 코드가 없음. 이 기능이 들어간 배포는 존재할 수 없음
- GitHub App — 아직 생성 · 설치되지 않음([setup.md](setup.md) §2~6 미실행)
- 대상 저장소 main HEAD의 `Review Platform / Manual Approval` Check run — shared-stack `55b22e0` 0개 · it-tech-blog `6783cbd` 0개 · snapdone `0804753` 0개(공개 API, 2026-10-10)
- open PR — 세 저장소 모두 0개(공개 API, 2026-10-10)

## 1. 증거의 종류

| 표시                  | 뜻                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| **local-unit**        | Vitest 단위. DB · 네트워크 없음                                                                         |
| **local-integration** | 실제 PostgreSQL 17(일회용 Docker) + **가짜 GitHub transport**. GitHub 동작은 흉내일 뿐 실제 GitHub 아님 |
| **local-browser**     | Playwright + 테스트 DB + seed 세션. GitHub를 부르는 요청은 브라우저 경계에서 가로챔                     |
| **live**              | 실제 배포 + 실제 GitHub App + 실제 PR. 이 표시만 "실제 연동" 증거                                       |

## 2. 로컬 검증

| #   | 항목                                                 | 명령                                                                                      | 결과                                      | 종류              |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------- |
| 1   | lint · typecheck · unit                              | `pnpm nx run-many -t lint typecheck test -p web web-e2e visual-contracts --skip-nx-cache` | Pass                                      | local-unit        |
| 1   | web 단위                                             | `pnpm nx test web`                                                                        | Pass — 109개                              | local-unit        |
| 4   | Visual contract                                      | `pnpm nx test visual-contracts`                                                           | Pass — 64개                               | local-unit        |
| 4   | Visual review-data loader                            | `pnpm nx test web`의 `review-data.test.ts`                                                | Pass — 17개(절대 `REVIEW_DATA_DIR` 포함)  | local-unit        |
| 2–3 | migration · 동시성 · 인증 · webhook · 승인 · 복구    | `TEST_DATABASE_URL=… pnpm nx test-db web`                                                 | Pass — 84개                               | local-integration |
| 4   | tools · hook                                         | `pnpm tools:check` · `pnpm test:hooks`                                                    | Pass — 49개 · 46개                        | local-unit        |
| 4   | 기존 Visual 브라우저 흐름(`review-flow.spec.ts` 7개) | `pnpm e2e`                                                                                | **Not run** — hook이 브라우저 실행을 막음 | local-browser     |
| 5   | 신규 PR 화면(`manual-approval.spec.ts` 12개)         | `E2E_DATABASE_URL=… pnpm e2e`                                                             | **Not run** — 같은 이유                   | local-browser     |
| 6   | production build                                     | `pnpm nx build web`                                                                       | **Not run** — hook이 막음                 | —                 |

- E2E는 `playwright test --list`로 23개(Visual 7 · 수동 승인 12 · live smoke 4) 수집만 확인
- 마지막 Playwright 실행 기록은 2026-09-25(`passed`) — 이 기능 이전. 새 코드로는 브라우저 · build가 한 번도 돌지 않음
- 사용자 실행 명령 — [setup.md §13](setup.md#13-로컬-검증-명령)

## 3. 실패 · 복구 시나리오

모두 **local-integration**(실제 PostgreSQL + 가짜 GitHub) 또는 local-unit. 운영 환경에서 장애를 만들지 않음. live 열은 운영에서 안전하게 할 수 있는 것만 둠.

| 시나리오                                 | 로컬 근거(파일 › 테스트)                                                                                                                                                                                                        | 로컬 | live                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------- |
| 같은 delivery Redeliver → 중복 없음      | `webhook.db-test` › treats a processed delivery as a no-op · `deliveries.db-test` › processes a new delivery and treats a finished one as a no-op                                                                               | Pass | Not run — §5 L-R1 계획                  |
| 실패 delivery Redeliver → 복구           | `webhook.db-test` › leaves a failed delivery and a non-2xx when GitHub fails, then recovers on redelivery · `deliveries.db-test` › reprocesses a failed delivery…                                                               | Pass | 운영에서 실패를 만들지 않음             |
| 버려진 처리 → 회수, 늦은 결과 무시       | `deliveries.db-test` › takes over an abandoned delivery and ignores the late result of the old attempt                                                                                                                          | Pass | —                                       |
| 오래된 이벤트 재전송 → HEAD 유지         | `webhook.db-test` › reads the current head from GitHub instead of a late payload · `repository.db-test` › opens a new generation for A -> B -> A…                                                                               | Pass | Not run — §5 L-R2 계획                  |
| double-click · 병렬 승인 → 결정 하나     | `repository.db-test` › serializes two concurrent approvals on the database row lock · `approve.db-test` › keeps the first decision… · `manual-approval.spec` › a double click sends one approval request(local-browser, 미실행) | Pass | —                                       |
| GitHub 쓰기 실패 → Error/Unknown → 수렴  | `approve.db-test` › does not report approved after a PATCH timeout, and reconcile converges to one success · retries a failed approval without creating a second decision                                                       | Pass | 운영에서 실패를 만들지 않음             |
| API 성공 뒤 DB 실패 · 응답 유실 → 재조회 | `approve.db-test` › does not report approved when GitHub succeeds but the DB result is lost · `webhook.db-test` › adopts the check created by a lost POST response… · keeps the lowest duplicate run as canonical…              | Pass | 운영에서 실패를 만들지 않음             |
| stale SHA 승인 거부                      | `approve.db-test` › rejects a stale head with a conflict and syncs the latest revision · does not carry an approval to a head pushed during the approval                                                                        | Pass | Not run — §5 루프 12단계                |
| closed PR 승인 거부                      | `approve.db-test` › refuses a closed PR and a repository outside the allowlist                                                                                                                                                  | Pass | Not run — §5 루프 15단계                |
| 미로그인 · 다른 user ID · CSRF · Origin  | `oauth.db-test` › guardMutation 거부 8개(Origin 없음 · 다른 host · http · cookie 없음 · CSRF 없음 · 다른 세션 CSRF · 만료 · 운영자 목록 제외) · does not create a session for a GitHub user outside APPROVER_GITHUB_IDS         | Pass | Not run — `live-smoke.spec` 미승인 401  |
| 다른 저장소 · 다른 installation          | `approve.db-test` › refuses a closed PR and a repository outside the allowlist · `webhook.db-test` › ignores repositories outside the allowlist and foreign installations                                                       | Pass | —                                       |
| 웹훅 서명 변조                           | `webhook.test` › verifyWebhookSignature · `webhook.db-test` › rejects a tampered body without storing anything                                                                                                                  | Pass | Not run — `live-smoke.spec`             |
| OAuth replay · binding · PKCE · 만료     | `oauth.db-test` › rejects a replayed state · …another browser… · …different PKCE challenge · rejects an expired state                                                                                                           | Pass | —                                       |
| 같은 SHA의 복수 open PR(MVP 한계)        | `approve.db-test` › refuses a head shared by another open PR · refuses when it cannot read every page…                                                                                                                          | Pass | Not run — §5 L-R3(선택)                 |
| merge queue(MVP 범위 밖)                 | `webhook.test` › ignores ping and unrelated events — `merge_group`을 `ignored`로 기록                                                                                                                                           | Pass | 설정하지 않음 — merge queue를 켜지 않음 |

## 4. 실제 GitHub 검증표

| 저장소       | 단계(§5 루프) | 결과        | PR URL | HEAD SHA | Check run ID · URL | App | UI  | DB  | 시각 | 배포 revision |
| ------------ | ------------- | ----------- | ------ | -------- | ------------------ | --- | --- | --- | ---- | ------------- |
| shared-stack | 1–15          | **Not run** | —      | —        | —                  | —   | —   | —   | —    | —             |
| it-tech-blog | 핵심 루프     | **Not run** | —      | —        | —                  | —   | —   | —   | —    | —             |
| snapdone     | 핵심 루프     | **Not run** | —      | —        | —                  | —   | —   | —   | —    | —             |

- **Not run 이유** — 배포 · GitHub App · 설치가 없음. 수동 승인 코드도 아직 커밋 · push되지 않아 배포할 revision이 없음
- 한 저장소의 결과를 다른 저장소에 대입하지 않음. 다른 CI 성공 · 공식 PR Review · required 설정 · merge는 이 표의 성공이 아님

## 5. 실행 계획(사용자 승인 뒤)

### 선행 조건

1. 이 작업의 커밋 · push(현재 미커밋) — 배포할 revision을 만듦
2. [setup.md](setup.md) §1~7 — 전용 DB · Vercel production 배포 · GitHub App 생성 · 세 저장소 설치 · ping 200
3. 배포 revision 기록 — Vercel 배포 상세의 commit SHA가 1의 커밋과 같은지
4. live smoke(읽기 전용, PR · DB 쓰기 없음):

   ```bash
   cd apps/web-e2e && LIVE_SMOKE=1 BASE_URL=https://<PUBLIC_BASE_URL> pnpm exec playwright test live-smoke
   ```

### 테스트 PR (저장소마다 하나, draft, merge하지 않음)

- **변경** — 저장소 root에 임시 문서 `REVIEW_PLATFORM_E2E.md` 하나. 두 번째 commit은 같은 파일에 한 줄 추가(새 head SHA)
- **작업 트리를 건드리지 않음** — `git worktree`로 별도 디렉터리에서. snapdone의 `sentry-api` 미커밋 변경을 지키기 위함
- **경로 선택** — shared-stack `chromatic.yml`은 `libs/react-ui/**`에만 반응하므로 root 문서는 Chromatic을 돌리지 않음. `pr-check.yml`과 snapdone `ci.yml`은 모든 PR에서 돎(정상 — 기존 check가 그대로인지 보는 대상)
- **merge · 자동 merge 하지 않음**, 검증 뒤 close · branch 삭제

```bash
# <repo> = shared-stack | it-tech-blog | snapdone
cd ~/Documents/project/<repo>
git fetch origin
git worktree add -b test/review-platform-manual-approval ../<repo>-e2e origin/main
cd ../<repo>-e2e
printf '# Review Platform manual approval E2E\n\nTemporary file for a test pull request. Do not merge.\n' > REVIEW_PLATFORM_E2E.md
git add REVIEW_PLATFORM_E2E.md && git commit -m "test: add Review Platform manual approval E2E marker"
git push -u origin test/review-platform-manual-approval
# PR — GitHub 웹에서 draft로 만들거나(gh가 있으면 아래)
gh pr create --draft --base main --title "[test] Review Platform manual approval E2E — do not merge" \
  --body "Temporary PR to verify the Review Platform / Manual Approval check. Do not merge."

# 13단계용 두 번째 commit
printf '\nSecond commit for the new-head check.\n' >> REVIEW_PLATFORM_E2E.md
git commit -am "test: change head for Review Platform manual approval E2E" && git push

# 정리(검증 뒤)
gh pr close <number> --delete-branch   # 또는 웹에서 Close + branch 삭제
cd ../<repo> && git worktree remove ../<repo>-e2e
```

- 세 저장소의 `AGENTS.md`는 명시적 요청 없는 commit · push를 막음 — 위 명령은 사용자가 실행하거나, 저장소 · 범위를 정해 실행을 맡김

### 루프와 기록 방법(shared-stack 1–15, 나머지는 핵심 루프)

증거는 공개 API로 읽음(세 저장소 public, 토큰 불필요).

```bash
R=berrypjh/<repo>; N=<PR 번호>
curl -s https://api.github.com/repos/$R/pulls/$N | jq '{html_url, number, head: .head.sha, repository_id: .base.repo.id}'
SHA=<head sha>
curl -s "https://api.github.com/repos/$R/commits/$SHA/check-runs?filter=all&per_page=100" \
  | jq '[.check_runs[] | {id, name, status, conclusion, app: .app.slug, app_id: .app.id, details_url, html_url}]'
```

| #   | 단계                                        | 기대                                                                                               | 기록                     |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------ |
| 1–2 | PR 생성 · 읽기                              | URL · 번호 · `base.repo.id`(shared-stack `1217703464`) · head SHA                                  | PR URL · SHA             |
| 3   | `/pulls` · 상세                             | 같은 번호 · 같은 full SHA · Pending approval                                                       | UI                       |
| 4   | Check                                       | `Review Platform / Manual Approval`, `status: queued`, `conclusion: null`, `app_id` = 이 App       | Check run ID · URL · App |
| 5   | `details_url`                               | `PUBLIC_BASE_URL/pulls/<repositoryId>/<number>` — 클릭 시 상세                                     | URL                      |
| 6   | 로그인                                      | GitHub → callback → `/pulls`, "Signed in as @<login>"                                              | UI                       |
| 7–8 | 승인                                        | "Approved. GitHub confirmed…", Check `completed` · `success` · summary 고정 문구                   | Check · UI · DB          |
| 9   | 새로고침 · Redeploy 뒤                      | Approved 유지, 승인자 · 시각 같음                                                                  | UI · DB                  |
| 10  | 두 번째 commit push                         | —                                                                                                  | 새 SHA                   |
| 11  | 새 revision                                 | Pending approval, 새 SHA Check queued, 이전 SHA Check는 success 그대로                             | Check · UI               |
| 12  | 이전 화면(push 전에 열어 둔 탭)에서 Approve | 409 → "A new commit was pushed…", 새 SHA로 다시 그림                                               | UI                       |
| 13  | 새 SHA 승인                                 | 새 Check success                                                                                   | Check                    |
| 14  | 다른 check                                  | 승인 전후 check 목록 비교 — Actions · Chromatic 등의 status · conclusion이 버튼 때문에 바뀌지 않음 | before · after JSON      |
| 15  | close                                       | Closed, Approve 버튼 없음, 미승인 대기 Check는 cancelled                                           | UI · Check               |

- **snapdone 추가** — 승인 전후 `GET /repos/berrypjh/snapdone/rules/branches/main`의 required `checks` · `e2e` · `docker`가 그대로인지
- **DB 기록(선택)** — 운영 DB를 읽을 수 있으면 아래만 기록(세션 · 토큰 열은 읽지 않음)

  ```sql
  SELECT r.generation, r.head_sha, r.decision, r.approver_login, r.decision_at, r.check_run_id, r.sync_state
  FROM revisions r JOIN pull_requests p ON p.id = r.pull_request_id
  WHERE p.repository_id = <id> AND p.number = <n> ORDER BY r.generation;
  ```

### live 복구 확인(운영에서 안전한 것만)

- **L-R1 같은 delivery Redeliver** — App → Advanced → Recent Deliveries → 해당 PR의 `opened` → Redeliver → 응답 200 `{"result":"duplicate"}`, Check run 수 · revision 수 그대로
- **L-R2 오래된 이벤트** — 두 번째 commit 뒤 첫 번째 `synchronize`(또는 `opened`)를 Redeliver → 이미 처리된 delivery라 `duplicate`. 상세의 head · 승인 상태가 과거로 돌아가지 않음
- **L-R3 같은 SHA의 두 PR(선택)** — 같은 commit을 가리키는 branch 하나 더 + draft PR → 둘 중 하나 Approve → 409 "Another open pull request has the same head commit". 추가 PR이 필요하므로 별도 승인 뒤에만

## 6. 남은 제약

- **실제 GitHub 0/3** — 위 계획을 실행해야 바뀜
- **브라우저 E2E · production build 미실행** — 사용자 터미널 필요
- **classic branch protection** — 비인증 401로 확인 불가
- **shared-stack 로컬 작업 트리** — `1cd182c`로 원격 main `55b22e0`보다 뒤처짐. 대상 저장소는 읽기만 하므로 갱신하지 않음. 테스트 PR은 `origin/main`에서 만듦
- **MVP 한계** — 같은 SHA의 복수 open PR은 승인 거부, merge queue 미지원, 자동 재시도 없음(Redeliver · Retry sync)

## 7. 향후 검증 제안(구현하지 않음)

- 배포 직후 live smoke를 사람이 실행하는 대신 배포 hook에서 돌리는 방안
- 테스트 전용 GitHub App · 저장소로 실제 PR 루프를 자동화하는 opt-in workflow — 운영 App · 저장소와 분리할 때만
- route handler를 실제 Next 서버로 띄워 가짜 GitHub HTTP 서버와 붙이는 통합 테스트 — 런타임에 테스트 전용 설정이 들어가지 않는 방법을 먼저 정한 뒤
