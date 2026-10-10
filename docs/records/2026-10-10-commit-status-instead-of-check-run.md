# 수동 승인 표시를 Check Run에서 commit status로 변경

수동 승인 결과는 head commit의 commit status(context `Review Platform / Manual Approval`)로 씀. PR 화면의 Details가 Review Platform의 PR 상세로 바로 감.

## 상황

- Check Run의 `details_url`은 PR 화면 Details에서 GitHub Checks 탭을 거침. 사이트 링크는 그 안의 "View more details"
- commit status의 `target_url`은 PR 화면 Details에서 바로 열림
- Check Run 방식에서 snapdone PR #2의 queued → 승인 → success 동작 확인

## 판단

- **commit status 사용** — `POST /repos/{owner}/{repo}/statuses/{sha}`, `target_url` = `PUBLIC_BASE_URL/pulls/<repositoryId>/<number>`
- **상태 대응** — 대기 `pending`, 승인 `success`, 현재가 아니게 된 미승인 commit `error`
- **중복 처리** — 같은 SHA · context는 마지막 status가 보임. 결과를 모르는 반영은 같은 상태를 다시 보냄. external_id 조회 · 중복 run 정리 제거
- **App 권한** — Commit statuses: write. Checks 권한과 `GITHUB_APP_ID` 설정 불필요

## 반영

- `apps/web/src/lib/github/statuses.ts` — `setStatus` · `confirmsIntent`. `checks.ts` 대체
- `apps/web/src/lib/manual-approval/sync.ts` — 기존 run 채택(`adoptExisting`) 제거
- `apps/web/src/lib/github/app-auth.ts` — installation token 권한 `statuses: write`
- `check_run_id` · `checkRunId` · external_id 코드 제거. DB 열 `check_run_id`는 남김(migration은 추가만)
- `GITHUB_APP_ID` 설정 제거
- `docs/manual-approval/architecture.md` · `setup.md` · `.claude/rules/web.md`

## 검증

- `pnpm nx run-many -t lint typecheck test -p web web-e2e` 통과
- `pnpm nx test-db web` 83개 통과(가짜 GitHub의 statuses API)
- 실제 GitHub의 commit status 반영 · ruleset의 source 지정은 미실행
