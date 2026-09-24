# PR 연동 1단계를 reusable workflow와 artifact로 구현

다른 저장소의 PR이 `workflow_call`로 호출하는 `.github/workflows/visual-regression.yml`. base와 head의 Storybook을 build · 비교하고 run 디렉터리를 artifact로 올림. PR 코멘트 · status check · baseline 보관은 아직 없음.

## 상황

- MVP는 로컬에서 손으로 도는 상태. PR마다 base/head worktree를 만들어 capture · compare해야 함
- review-platform은 private. 호출 저장소의 `GITHUB_TOKEN`으로는 review-platform을 checkout할 수 없음
- 결과를 PR에 보고하려면 GitHub 연동이 필요하지만, 저장소 · 호스팅 없이도 되는 범위가 있음

## 판단

- **reusable workflow** — 세 저장소에 같은 job을 복사하지 않음. 호출 쪽은 입력 몇 줄
- **manifest는 호출 저장소가 소유** — story 이름을 바꾸는 PR이 manifest도 같은 PR에서 고침. `head` checkout에서 읽음
- **artifact 업로드까지만** — 리뷰어가 내려받아 로컬 Review UI로 봄. 저장소 · 호스팅 · GitHub App 없음
- **판정은 TS에** — `visual:summary`가 Markdown과 exit code(`--fail-on`)를 냄. YAML에 로직을 두지 않음
- **정적 서버는 devDependency** — `npx --yes http-server`가 `command not found`로 실패함을 확인. lockfile에 고정된 `pnpm exec http-server`
- **private 대응** — checkout token은 `secrets.review-platform-token || github.token`. public이 되면 caller의 `secrets:` 줄만 삭제
- **`workflow_dispatch` 병행** — review-platform 자체에서 shared-stack main vs main으로 시험. 호출 저장소를 건드리기 전에 확인

## 반영

- `.github/workflows/visual-regression.yml` — 16 step. base 6006 · head 6007에 serve, `pnpm visual:capture` ×2, `visual:compare`, artifact `visual-run-<run-id>`(14일), `visual:summary` → step summary
- `tools/visual/summary/` — `renderSummary` · `shouldFail` · CLI. `GITHUB_OUTPUT`에 `status=` 기록
- `package.json` — `visual:summary`, `http-server` 14.1.1
- `docs/integration/pr-integration.md` — 설정 절차 · 호출 스니펫

## 검증

- `tools:check` 49개 통과(summary 테스트 포함). YAML 파싱 정상
- workflow의 shell step을 로컬에서 `bash -eo pipefail`로 그대로 실행 — serve → 대기 → capture → `kill %1` → compare `passed` → summary `status=passed`. 포트 잔류 없음
- GitHub Actions 위에서는 실행하지 못함 — 저장소가 아직 push된 적이 없음. Actions access 설정 · PAT · dispatch 시험은 사용자 몫
