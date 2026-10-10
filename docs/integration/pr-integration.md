# PR에서 Visual Regression 실행

검사 대상 저장소의 PR마다 base와 head의 Storybook을 비교하고 결과를 workflow artifact로 남김. review-platform의 [`.github/workflows/visual-regression.yml`](../../.github/workflows/visual-regression.yml)을 reusable workflow로 호출.

- **하는 것** — capture → compare → artifact 업로드, step summary 표, `fail-on` 기준 job 실패
- **하지 않는 것** — PR 코멘트, baseline 보관, Review UI 호스팅

## 1. review-platform 쪽

review-platform은 public. 호출 저장소의 `GITHUB_TOKEN`으로 checkout되므로 설정이 필요 없음.

- **`review-platform-token`(선택 secret)** — review-platform을 private으로 바꿀 때만 필요. Contents read 권한의 PAT

## 2. 검사 대상 저장소 쪽

### manifest

target manifest는 검사 대상 저장소가 소유. 형식은 [`fixtures/visual/targets/shared-stack.json`](../../fixtures/visual/targets/shared-stack.json)과 같음.

- story id는 build된 `storybook-static/index.json`에서 확인

### workflow

`.github/workflows/`에 파일 하나 추가. 예시(shared-stack):

```yaml
name: Visual Regression

on:
  pull_request:
    branches: [main]
    paths:
      - 'libs/react-ui/**'
      - 'libs/ui-core/**'
      - 'libs/design-tokens/**'
      - '.review/visual-targets.json'

concurrency:
  group: visual-${{ github.ref }}
  cancel-in-progress: true

jobs:
  visual:
    uses: berrypjh/review-platform/.github/workflows/visual-regression.yml@main
    with:
      manifest: .review/visual-targets.json
      storybook-build: pnpm build:libs:web && pnpm build-storybook
      storybook-dir: libs/react-ui/storybook-static
      # fail-on: review-required
```

| 입력                  | 의미                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `manifest`            | 호출 저장소 root 기준 manifest 경로. head checkout에서 읽음        |
| `storybook-build`     | 호출 저장소 root에서 실행할 Storybook static build 명령            |
| `storybook-dir`       | build 결과 디렉터리 (호출 저장소 root 기준)                        |
| `install`             | 의존성 설치 명령. 기본 `pnpm install --frozen-lockfile`            |
| `fail-on`             | `failed`(기본) 또는 `review-required`. 이 status 이상이면 job 실패 |
| `review-platform-ref` | 사용할 review-platform ref. 기본 `main`                            |

`paths`에는 Storybook 결과에 영향을 주는 경로와 manifest를 넣음.

## 3. 실행 순서

1. review-platform · base(PR base SHA) · head(PR head SHA)를 각각 checkout
2. base Storybook build → `127.0.0.1:6006`에서 serve → `visual:capture --kind baseline`
3. head Storybook build → `127.0.0.1:6007`에서 serve → `visual:capture --kind current`
4. `visual:compare` → diff PNG · `run.json`
5. `.review-data` 전체를 artifact `visual-run-<run id>`로 업로드(보관 14일). capture · compare가 실패해도 업로드
6. `visual:summary` → step summary 표, `fail-on` 판정. `review-required`면 warning annotation

- **run id** — `pull_request`면 `pr-<번호>`, `workflow_dispatch`면 `manual-<run number>`
- **timeout** — 30분

## 4. 결과 확인

artifact `visual-run-pr-<번호>`를 내려받아 압축을 풀고 review-platform에서:

```bash
REVIEW_DATA_DIR=<압축 푼 폴더> pnpm dev
```

`/runs/pr-<번호>`에서 baseline · current · diff 확인.

## 5. review-platform에서 직접 실행

Actions → "Visual Regression" → `Run workflow`(`workflow_dispatch`).

| 입력              | 기본값                                        |
| ----------------- | --------------------------------------------- |
| `repository`      | `berrypjh/shared-stack`                       |
| `base-ref`        | `main`                                        |
| `head-ref`        | `main`                                        |
| `manifest`        | `fixtures/visual/targets/shared-stack.json`   |
| `storybook-build` | `pnpm build:libs:web && pnpm build-storybook` |
| `storybook-dir`   | `libs/react-ui/storybook-static`              |

- manifest는 review-platform root 기준 경로

## 제약

- **비용** — PR마다 Storybook build 두 번
- **정확 일치 비교** — 픽셀 단위. Chromium · 폰트가 바뀌면 모든 target이 `changed`가 될 수 있음. Chromium은 review-platform `pnpm-lock.yaml`의 Playwright 버전을 따름
- **같은 PR의 재실행** — artifact 이름이 같음. 최신 workflow run의 artifact를 봄
