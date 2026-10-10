# 로컬에서 Storybook 두 build 비교

검사 대상 저장소의 Storybook build 두 개를 `visual:capture` · `visual:compare`로 비교하고 로컬 Review UI에서 확인하는 절차. 예시는 shared-stack과 [`fixtures/visual/targets/shared-stack.json`](../../fixtures/visual/targets/shared-stack.json).

- **검사 대상 저장소는 변경하지 않음** — 별도 checkout에서 build · serve만 하고 review-platform이 HTTP로 읽음

## manifest

| 항목     | 값                                                                          |
| -------- | --------------------------------------------------------------------------- |
| viewport | `1280 x 720`                                                                |
| target   | `components-buttons-button--default` · `components-buttons-button--loading` |

- story id는 build된 `storybook-static/index.json`에서 확인. story title · export 이름이 바뀌면 manifest 갱신

## 준비

review-platform:

```bash
pnpm install
pnpm exec playwright install chromium
```

검사 대상 저장소: baseline · candidate용 clean checkout 두 개. 작업 중인 working tree는 쓰지 않음.

```bash
cd <shared-stack-clone>
git fetch origin
git worktree add ../shared-stack-baseline origin/main
git worktree add ../shared-stack-candidate <candidate-branch-or-sha>
```

- 각 worktree에서 `pnpm install --frozen-lockfile`
- 두 SHA 기록 — `git -C ../shared-stack-baseline rev-parse HEAD` · `git -C ../shared-stack-candidate rev-parse HEAD`
- run id — 비교마다 새 값. `a-z` · `0-9` · `-`, 1~100자, `-`로 시작 · 끝나지 않음

## 1. Baseline

baseline checkout에서:

```bash
cd ../shared-stack-baseline
pnpm build:libs:web
pnpm build-storybook
pnpm exec http-server libs/react-ui/storybook-static -a 127.0.0.1 -p 6006 --silent
```

review-platform에서:

```bash
pnpm visual:capture -- \
  --run-id <run-id> \
  --kind baseline \
  --base-url http://127.0.0.1:6006 \
  --targets fixtures/visual/targets/shared-stack.json
```

결과 — `.review-data/runs/<run-id>/baseline/<story-id>.png`. 끝나면 서버 종료.

## 2. Candidate

candidate checkout에서 같은 build · serve 뒤, 같은 run id로:

```bash
pnpm visual:capture -- \
  --run-id <run-id> \
  --kind current \
  --base-url http://127.0.0.1:6006 \
  --targets fixtures/visual/targets/shared-stack.json
```

## 3. Compare

```bash
pnpm visual:compare -- \
  --run-id <run-id> \
  --repository berrypjh/shared-stack \
  --base-sha <baseline-sha> \
  --head-sha <candidate-sha> \
  --targets fixtures/visual/targets/shared-stack.json
```

결과 — target별 한 줄 출력, changed target의 `diff/<story-id>.png`, `.review-data/runs/<run-id>/run.json`.

## 4. Review

```bash
REVIEW_DATA_DIR="$PWD/.review-data" pnpm dev
```

`http://localhost:3000`에서 run 선택.

| 표시             | 의미                                              |
| ---------------- | ------------------------------------------------- |
| Passed           | 모든 target unchanged                             |
| Review required  | changed target 있음                               |
| Failed           | error target 있음(이미지 누락 · 비교 실패)        |
| Unchanged target | 0 px, Diff 탭 비활성, "No diff generated"         |
| Changed target   | mismatch 픽셀 수 · 비율, Diff 탭에 바뀐 픽셀 표시 |

## 문제 해결

| 메시지                                                   | 원인 · 조치                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `... already exists; use a new --run-id`                 | 그 run에 이미 같은 capture 또는 `run.json`이 있음. 새 run id |
| `failed at stage "navigate": ... ERR_CONNECTION_REFUSED` | `--base-url`에 Storybook이 없음                              |
| `failed at stage "wait-root": ... Timeout`               | build에 story id가 없음. `index.json` 확인 후 manifest 갱신  |
| `run.json`의 `Missing image: baseline/...`               | 해당 story의 baseline capture 없음. run은 Failed             |
| 6006번 포트 사용 중                                      | 다른 서버 종료 또는 다른 포트 사용                           |

## 정리

```bash
git worktree remove ../shared-stack-baseline
git worktree remove ../shared-stack-candidate
rm -rf .review-data/runs/<run-id>
```
