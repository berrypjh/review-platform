# Local Development

이 문서의 명령은 전부 실제 `package.json` script와 Nx target에 대응한다. 동작하지 않는 명령은 적지 않는다.

## Requirements

| 도구 | 버전    | 확인                                     |
| ---- | ------- | ---------------------------------------- |
| Node | 24.20.0 | `.nvmrc`로 고정. `nvm use`               |
| pnpm | 11.25.0 | `package.json`의 `packageManager`로 고정 |

## Install

```bash
nvm use
pnpm install
pnpm exec playwright install chromium
```

GitHub Packages 토큰은 필요 없다. lint · format · tsconfig 설정은 이 저장소 안에 있다(`eslint.config.mjs` · `.prettierrc.json` · `tsconfig.base.json`).

`pnpm install`은 pnpm 11의 정책대로 build script를 막는다. 허용 목록은 `pnpm-workspace.yaml`의 `allowBuilds`(`@swc/core` · `esbuild` · `nx` · `sharp` · `unrs-resolver`)이고, 새 패키지가 script를 요구하면 `ERR_PNPM_IGNORED_BUILDS`로 알려 준다. 그때 목록에 추가한다.

Chromium은 Playwright 버전에 묶인다. `@playwright/test`를 올리면 `playwright install chromium`을 다시 한다 — 없으면 e2e · capture가 `Executable doesn't exist`로 실패한다.

## 실행

### Review UI

```bash
pnpm dev                                              # http://localhost:3000, .review-data 사용
REVIEW_DATA_DIR=fixtures/visual/review-data pnpm dev  # 커밋된 fixture run
```

`REVIEW_DATA_DIR`는 **workspace root 기준**으로 해석한다(`pnpm-workspace.yaml`이 있는 곳). `next dev`가 `apps/web`에서 실행되므로 cwd를 기준으로 삼지 않는다. 기본값은 `<root>/.review-data`다.

화면은 `<data-dir>/runs/*/run.json`을 요청 시점마다 읽는다. run을 새로 만들면 새로고침만 하면 된다. 읽지 못한 run은 화면에 이유와 함께 나온다 — 잘못된 JSON · 계약 위반 · `run.json`이 아직 없음(미비교) · 파일시스템 오류.

### 비교 순서

Storybook이 어딘가에 떠 있어야 한다. 실제 예는 [shared-stack-dogfood.md](../integration/shared-stack-dogfood.md).

```bash
pnpm visual:capture -- --run-id <id> --kind baseline --base-url http://127.0.0.1:6006 --targets <manifest>
pnpm visual:capture -- --run-id <id> --kind current  --base-url http://127.0.0.1:6006 --targets <manifest>
pnpm visual:compare -- --run-id <id> --repository <owner/name> --base-sha <sha> --head-sha <sha> --targets <manifest>
pnpm visual:summary -- --run-id <id>        # Markdown 요약 (CI용)
```

- 세 명령 모두 `--data-dir`(기본 `.review-data`)와 `--help`를 받는다
- run id는 `a-z` · `0-9` · `-`만. 디렉터리 이름이 된다
- `pnpm script -- ...`의 `--`는 pnpm이 script에 그대로 넘기고 CLI가 떼어 낸다
- 같은 run의 같은 `--kind`를 다시 찍거나, 이미 `run.json`이 있는 run을 다시 비교하면 거부한다. 새 run id를 쓰거나 직접 지운다

### 산출물

```
<data-dir>/runs/<run-id>/
  baseline/<target-id>.png   capture --kind baseline
  current/<target-id>.png    capture --kind current
  diff/<target-id>.png       compare — changed target에만
  run.json                   compare — VisualRun
```

`.review-data`는 git ignore 대상이다. 어디로 옮겨도 `run.json`의 경로는 run 기준 상대 경로라 그대로 읽힌다.

### capture가 결정적인 이유

- target마다 새 browser context — 고정 viewport, DPR 1, light, reduced motion, `en-US`, UTC
- `#storybook-root`가 보이고 `document.fonts.ready`가 끝날 때까지만 기다린다. 고정 sleep은 없다
- animation 비활성화, caret 숨김, `fullPage: false`
- 순차 capture. 첫 실패에서 `Target "<id>" failed at stage "<navigate|wait-root|wait-fonts|screenshot>"`로 멈춘다

같은 build를 두 번 찍으면 byte 단위로 같다(animation이 있는 spinner 포함, 2026-09-24 shared-stack에서 확인).

### compare 규칙

- pixelmatch `threshold: 0`, `includeAA: true` — 색이 조금이라도 다르면 mismatch. 허용치 설정은 없다
- 이미지가 없거나 크기가 다르면 `error`. mismatch 값은 null이고 diff는 만들지 않는다
- 파일이 있지만 PNG로 읽을 수 없으면 target별 `error`가 아니라 명령 전체가 실패한다
- exit code는 "비교 결과를 만들었는가"다. run status가 `failed`여도 `run.json`을 썼으면 0

## fixture

| 위치                                        | 용도                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `fixtures/visual/targets/sample.json`       | 예시 manifest. 1280x800, `button--primary` · `card--default`           |
| `fixtures/visual/targets/shared-stack.json` | dogfooding · workflow_dispatch 시험용. Button Default/Loading          |
| `fixtures/visual/review-data/`              | Review UI · e2e가 읽는 완성된 run `sample`(32x20 PNG, review-required) |

`review-data/runs/sample`의 `diff/`와 `run.json`을 다시 만들려면 둘을 지운 뒤:

```bash
pnpm visual:compare -- --run-id sample --repository berrypjh/shared-stack \
  --base-sha 7888724e59b35e45880c736f03b4ecf3215f8e78 --head-sha 951cadd \
  --targets fixtures/visual/review-data/sample-targets.json --data-dir fixtures/visual/review-data
```

PNG와 mismatch 값은 결정적이라 같고 `createdAt`만 바뀐다.

## 트러블슈팅

| 증상                                                          | 원인 · 대처                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `... already exists; use a new --run-id`                      | 그 run에 이미 같은 kind의 capture 또는 `run.json`이 있다                                                                             |
| `failed at stage "navigate": ... ERR_CONNECTION_REFUSED`      | `--base-url`에 Storybook이 떠 있지 않다                                                                                              |
| `failed at stage "wait-root": ... Timeout 30000ms`            | 그 build에 story id가 없다. `storybook-static/index.json`을 확인해 manifest를 고친다                                                 |
| `Executable doesn't exist at .../chromium_headless_shell-...` | Playwright 버전에 맞는 Chromium이 없다. `pnpm exec playwright install chromium`                                                      |
| Runs 화면 "Invalid run.json"                                  | 계약 위반. alert의 상세에 어긋난 필드가 나온다                                                                                       |
| Runs 화면 "Not compared yet"                                  | capture만 하고 compare를 하지 않은 run                                                                                               |
| e2e가 10분 넘게 멈춤                                          | 3200번 포트에 이전 서버가 남아 있다. `lsof -nP -iTCP:3200`로 찾아 끝낸다 ([기록](../records/2026-09-24-e2e-starts-next-directly.md)) |
| `nx build web`이 `Module not found: ./lib/primitives.js`      | contracts의 상대 import는 `.ts` 확장자여야 한다 ([기록](../records/2026-09-24-ts-extension-imports.md))                              |
