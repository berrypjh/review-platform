# shared-stack Storybook으로 dogfooding하기

`berrypjh/shared-stack`의 react-ui Storybook build 두 개를 review-platform의 Visual Regression MVP로 비교하고, 결과를 로컬 Review UI에서 확인하는 절차다.

shared-stack은 아무것도 바꾸지 않는다. 별도 checkout에서 Storybook을 build해 serve하기만 하고, review-platform은 그것을 HTTP로 읽는다.

## 무엇을 비교하나

target은 [`fixtures/visual/targets/shared-stack.json`](../../fixtures/visual/targets/shared-stack.json)에 있다.

| Target                                | Story id                             |
| ------------------------------------- | ------------------------------------ |
| `Components/Buttons/Button / Default` | `components-buttons-button--default` |
| `Components/Buttons/Button / Loading` | `components-buttons-button--loading` |

- viewport 1280 x 720, Chromium 하나만 쓴다.
- story id는 shared-stack `7888724e59b35e45880c736f03b4ecf3215f8e78`(`main`, 2026-09-24)을 build한 `storybook-static/index.json`에서 읽었다. Button story의 title이나 export 이름이 바뀌면 `index.json`을 다시 확인해 manifest를 갱신한다.

## 시작 전에

review-platform(이 저장소):

```bash
pnpm install
pnpm exec playwright install chromium   # Playwright 버전이 바뀔 때마다 한 번
```

shared-stack: baseline용과 candidate용으로 **clean checkout이 두 개** 필요하다. 커밋하지 않은 작업이 있는 checkout을 재사용하지 말고, 그것을 깨끗하게 만들려고 reset, stash, `checkout --`을 쓰지도 않는다. 대신 다음 중 하나를 쓴다.

```bash
# 방법 A: 기존 clone에서 git worktree (작업 중인 working tree는 건드리지 않는다)
cd <your-shared-stack-clone>
git fetch origin
git worktree add ../shared-stack-baseline origin/main
git worktree add ../shared-stack-candidate <candidate-branch-or-sha>

# 방법 B: 새로 clone
git clone https://github.com/berrypjh/shared-stack.git shared-stack-baseline
git clone https://github.com/berrypjh/shared-stack.git shared-stack-candidate
git -C shared-stack-candidate checkout <candidate-branch-or-sha>
```

worktree나 clone마다 `pnpm install --frozen-lockfile`을 한 번 실행한다. build는 git-ignored 파일(`dist`, `storybook-static`)만 만들므로 checkout은 깨끗하게 유지된다.

compare 단계에서 쓰므로 두 SHA를 기록해 둔다.

```bash
git -C ../shared-stack-baseline rev-parse HEAD
git -C ../shared-stack-candidate rev-parse HEAD
```

비교할 때마다 새 run id를 정한다. 예: `button-2026-09-24`. `a-z`, `0-9`, `-`만 쓸 수 있다.

## 1. Baseline

baseline checkout에서 (터미널 A):

```bash
cd ../shared-stack-baseline
pnpm build:libs:web
pnpm build-storybook
pnpm exec http-server libs/react-ui/storybook-static -a 127.0.0.1 -p 6006 --silent
```

`http://127.0.0.1:6006`이 응답하면 review-platform에서 (터미널 B):

```bash
pnpm visual:capture -- \
  --run-id <run-id> \
  --kind baseline \
  --base-url http://127.0.0.1:6006 \
  --targets fixtures/visual/targets/shared-stack.json
```

`.review-data/runs/<run-id>/baseline/<story-id>.png`가 생긴다. 터미널 A의 서버를 멈춘다 (Ctrl+C).

## 2. Candidate

candidate checkout에서 같은 포트로 build와 serve를 반복한다.

```bash
cd ../shared-stack-candidate
pnpm build:libs:web
pnpm build-storybook
pnpm exec http-server libs/react-ui/storybook-static -a 127.0.0.1 -p 6006 --silent
```

같은 run id로 `current`를 찍는다.

```bash
pnpm visual:capture -- \
  --run-id <run-id> \
  --kind current \
  --base-url http://127.0.0.1:6006 \
  --targets fixtures/visual/targets/shared-stack.json
```

끝나면 서버를 멈춘다.

## 3. Compare

```bash
pnpm visual:compare -- \
  --run-id <run-id> \
  --repository berrypjh/shared-stack \
  --base-sha <baseline-sha> \
  --head-sha <candidate-sha> \
  --targets fixtures/visual/targets/shared-stack.json
```

target마다 한 줄씩 결과를 출력하고, changed target에는 `diff/<story-id>.png`를, 그리고 `.review-data/runs/<run-id>/run.json`을 쓴다.

## 4. Review

```bash
REVIEW_DATA_DIR="$PWD/.review-data" pnpm dev
```

<http://localhost:3000>을 열어 run을 고르고 다음을 확인한다.

- **Run status**: 아무것도 바뀌지 않았으면 `Passed`, story가 바뀌었으면 `Review required`, capture나 비교가 빠졌으면 `Failed`.
- **Unchanged** story: 0 px이고 Diff 탭이 비활성이며 "No diff generated"가 보인다.
- **Changed** story: mismatch 픽셀 수와 비율이 보이고, Diff 탭에 바뀐 픽셀이 빨갛게 표시된다. Baseline·Current 탭과 좌우 비교 영역에 두 스크린샷이 보인다.
- 각 변경이 **의도한 것인지**. 도구는 차이를 보고할 뿐이고, 그 변경이 예상된 것인지는 사람이 판단한다.

### 실제 결과 예시

2026-09-24에 `button.scss`의 loading spinner radius만 바꾼 candidate(`7888724` 위의 로컬 전용 commit, push하지 않음)로 처음부터 끝까지 확인했다.

```
unchanged components-buttons-button--default  0 px (0)
changed   components-buttons-button--loading  490 px (0.0005316840277777777)
run review-required
```

같은 build를 두 번 찍어 비교하면 animation이 있는 spinner를 포함해 두 story 모두 0 px으로 `run passed`였다.

## 문제 해결

| 메시지                                                   | 원인과 대처                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `... already exists; use a new --run-id`                 | 그 run에 이미 이 capture나 `run.json`이 있다. 새 run id를 쓴다.                         |
| `failed at stage "navigate": ... ERR_CONNECTION_REFUSED` | `--base-url`에 Storybook이 떠 있지 않다.                                                |
| `failed at stage "wait-root": ... Timeout`               | 그 build에 story id가 없다. `storybook-static/index.json`을 확인해 manifest를 갱신한다. |
| `run.json`의 `Missing image: baseline/...`               | 그 story의 baseline capture가 없다. run은 `Failed`다.                                   |
| 6006번 포트 사용 중                                      | 다른 서버(예: `pnpm storybook`)를 멈추거나, 두 명령 모두 다른 포트를 쓴다.              |

worktree를 다 썼으면 `git worktree remove ../shared-stack-baseline` (candidate도 같게). run을 버리려면 `.review-data/runs/<run-id>`를 지운다.

## Chromatic과 비교

shared-stack의 Chromatic workflow(`.github/workflows/chromatic.yml`)는 그대로 둔다. 이 MVP는 그중 일부만 다룬다.

로컬 용도로 대체하는 것:

- Storybook story를 Chromium으로 찍어 baseline과 픽셀 단위로 비교하기.
- run의 baseline, current, diff 이미지를 확인하기.

아직 대체하지 않는 것:

- CI: run은 한 머신에서 손으로 시작한다.
- PR status check.
- hosted Storybook.
- 영구 저장소: run은 로컬 `.review-data` 디렉터리에만 있다.
- 사람의 승인 이력: accept/reject가 없고, review 결과로 baseline을 갱신하지 않는다.
