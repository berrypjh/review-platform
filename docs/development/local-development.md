# Local Development

## Requirements

| 도구 | 버전    | 고정 위치                         |
| ---- | ------- | --------------------------------- |
| Node | 24.20.0 | `.nvmrc`                          |
| pnpm | 11.25.0 | `package.json`의 `packageManager` |

## Install

```bash
nvm use
pnpm install
pnpm exec playwright install chromium
```

- **build script 허용 목록** — `pnpm-workspace.yaml`의 `allowBuilds`(`@swc/core` · `esbuild` · `nx` · `sharp` · `unrs-resolver`). 목록 밖 패키지의 script는 `ERR_PNPM_IGNORED_BUILDS`
- **Chromium** — Playwright 버전에 묶임. `@playwright/test`를 올리면 `playwright install chromium`을 다시 실행

## 실행

### Review UI

```bash
pnpm dev                                              # http://localhost:3000, .review-data
REVIEW_DATA_DIR=fixtures/visual/review-data pnpm dev  # 커밋된 fixture run
```

- **`REVIEW_DATA_DIR`** — 상대 경로는 workspace root(`pnpm-workspace.yaml`이 있는 곳) 기준. 절대 경로는 그대로. 기본 `<root>/.review-data`
- **읽기 시점** — 요청마다 `<data-dir>/runs/*/run.json`을 읽음
- **읽지 못한 run** — 이유별 표시: 잘못된 JSON · 계약 위반 · `run.json` 없음(미비교) · 파일시스템 오류

### 비교

```bash
pnpm visual:capture -- --run-id <id> --kind baseline --base-url http://127.0.0.1:6006 --targets <manifest>
pnpm visual:capture -- --run-id <id> --kind current  --base-url http://127.0.0.1:6006 --targets <manifest>
pnpm visual:compare -- --run-id <id> --repository <owner/name> --base-sha <sha> --head-sha <sha> --targets <manifest>
pnpm visual:summary -- --run-id <id> [--fail-on failed|review-required]
```

- **공통 옵션** — `--data-dir`(기본 `.review-data`) · `--help`
- **run id** — `a-z` · `0-9` · `-`, 1~100자. 디렉터리 이름
- **덮어쓰기 거부** — 같은 run의 같은 `--kind` capture, `run.json`이 이미 있는 run의 compare
- **summary** — Markdown을 stdout으로. run status가 `--fail-on`(기본 `failed`) 이상이면 exit 1

### 산출물

```
<data-dir>/runs/<run-id>/
  baseline/<target-id>.png   capture --kind baseline
  current/<target-id>.png    capture --kind current
  diff/<target-id>.png       compare — changed target에만
  run.json                   compare — VisualRun
```

`run.json`의 경로는 run 디렉터리 기준 상대 경로. `.review-data`는 git ignore 대상.

### capture

- target마다 새 browser context — manifest의 viewport, DPR 1, light, reduced motion, `en-US`, UTC
- `#storybook-root` 표시와 `document.fonts.ready`까지 대기. 고정 sleep 없음
- animation 비활성화, caret 숨김, `fullPage: false`
- 순차 실행. 첫 실패에서 `Target "<id>" failed at stage "<navigate|wait-root|wait-fonts|screenshot>"`로 중단

### compare

- pixelmatch `threshold: 0`, `includeAA: true`. 허용치 설정 없음
- 이미지가 없거나 크기가 다르면 target `error`. mismatch 값은 null, diff 없음
- PNG로 읽을 수 없는 파일은 명령 전체 실패
- exit code는 `run.json` 작성 여부. run status가 `failed`여도 0

## fixture

| 위치                                        | 용도                                                         |
| ------------------------------------------- | ------------------------------------------------------------ |
| `fixtures/visual/targets/sample.json`       | 예시 manifest. 1280x800, `button--primary` · `card--default` |
| `fixtures/visual/targets/shared-stack.json` | shared-stack Button Default · Loading. 1280x720              |
| `fixtures/visual/review-data/`              | Review UI · e2e가 읽는 run `sample`(review-required)         |

`review-data/runs/sample`의 `diff/`와 `run.json`을 지운 뒤 다시 만들기:

```bash
pnpm visual:compare -- --run-id sample --repository berrypjh/shared-stack \
  --base-sha 7888724e59b35e45880c736f03b4ecf3215f8e78 --head-sha 951cadd \
  --targets fixtures/visual/review-data/sample-targets.json --data-dir fixtures/visual/review-data
```

`createdAt`만 바뀜.

## 트러블슈팅

| 증상                                                          | 원인 · 대처                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `... already exists; use a new --run-id`                      | 그 run에 같은 kind의 capture가 있음                                                            |
| `... already exists; this run was compared`                   | 그 run에 `run.json`이 있음                                                                     |
| `failed at stage "navigate": ... ERR_CONNECTION_REFUSED`      | `--base-url`에 Storybook이 없음                                                                |
| `failed at stage "wait-root": ... Timeout 30000ms`            | build에 그 story id가 없음. `storybook-static/index.json`으로 manifest 수정                    |
| `Executable doesn't exist at .../chromium_headless_shell-...` | `pnpm exec playwright install chromium`                                                        |
| Runs 화면 "Invalid run.json"                                  | 계약 위반. alert 상세에 필드 표시                                                              |
| Runs 화면 "Not compared yet"                                  | capture만 하고 compare하지 않은 run                                                            |
| e2e가 끝나지 않음                                             | 3200번 포트에 이전 서버. `lsof -nP -iTCP:3200`로 찾아 종료                                     |
| `nx build web`이 `Module not found: ./lib/primitives.js`      | contracts의 상대 import는 `.ts` 확장자 ([기록](../records/2026-09-24-ts-extension-imports.md)) |
