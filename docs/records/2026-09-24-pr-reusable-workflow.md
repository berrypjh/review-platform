# PR 연동을 reusable workflow와 artifact로 구현

`.github/workflows/visual-regression.yml`은 다른 저장소의 PR이 `workflow_call`로 호출함. base와 head의 Storybook을 build · 비교하고 run 디렉터리를 artifact로 올림. PR 코멘트 · status check · baseline 보관은 없음.

## 상황

- PR마다 base · head를 capture · compare해야 함
- 호출 저장소의 `GITHUB_TOKEN`으로는 private 저장소인 review-platform을 checkout할 수 없음

## 판단

- **reusable workflow** — 호출 저장소는 입력 몇 줄만 둠
- **manifest는 호출 저장소가 소유** — head checkout에서 읽음
- **artifact 업로드까지** — 결과는 내려받아 로컬 Review UI로 봄
- **판정은 TS에** — `visual:summary`가 Markdown과 exit code(`--fail-on`)를 냄. YAML에 로직 없음
- **정적 서버는 devDependency** — `pnpm exec http-server`(lockfile 고정)
- **checkout token** — `secrets.review-platform-token || github.token`. 저장소가 public이면 secret 불필요
- **`workflow_dispatch`** — review-platform 자체에서 shared-stack main vs main으로 시험

## 반영

- `.github/workflows/visual-regression.yml` — base 6006 · head 6007에 serve, `visual:capture` ×2, `visual:compare`, artifact `visual-run-<run-id>`(14일), `visual:summary` → step summary
- `tools/visual/summary/` — `renderSummary` · `shouldFail` · CLI. `GITHUB_OUTPUT`에 `status=` 기록
- `package.json` — `visual:summary`, `http-server` 14.1.1
- `docs/integration/pr-integration.md` — 설정 절차

## 검증

- `pnpm tools:check` 통과(summary 테스트 포함)
- workflow의 shell step을 로컬에서 `bash -eo pipefail`로 실행 — compare `passed`, summary `status=passed`
- GitHub Actions 위에서는 실행 기록 없음
