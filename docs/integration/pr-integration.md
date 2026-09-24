# PR에서 Visual Regression 실행하기

검사 대상 repo(예: shared-stack)의 PR마다 base와 head의 Storybook을 비교하고, 결과를 workflow artifact로 남기는 설정이다. review-platform의 [`.github/workflows/visual-regression.yml`](../../.github/workflows/visual-regression.yml)을 reusable workflow로 호출한다.

이 단계에서 하는 것과 하지 않는 것:

- 한다: PR마다 capture → compare → artifact 업로드, step summary에 표, `failed`면 job 실패
- 하지 않는다: PR 코멘트, status check 이름 붙이기, baseline 보관, Review UI 호스팅, 승인 기록

## 1. review-platform 쪽 설정 (한 번)

review-platform이 **private인 동안** 두 가지가 필요하다.

1. **reusable workflow 접근 허용**
   review-platform → Settings → Actions → General → Access →
   "Accessible from repositories owned by the user 'berrypjh'" 선택.
   이 설정이 없으면 다른 repo가 `uses: berrypjh/review-platform/...`를 쓸 수 없다.
2. **코드 checkout용 토큰**
   reusable workflow는 호출 repo의 `GITHUB_TOKEN`으로 실행되므로, 그 토큰으로는 private인 review-platform을 checkout할 수 없다.
   fine-grained PAT를 만들어(Repository access: review-platform, Permissions: Contents **read**) 호출 repo의 secret `REVIEW_PLATFORM_TOKEN`으로 등록한다.

review-platform이 **public이 되면** 2번은 필요 없다. workflow는 토큰이 없으면 `github.token`을 쓰도록 되어 있으므로, caller에서 `secrets:` 줄만 지우면 된다.

## 2. 검사 대상 repo 쪽 설정

### manifest

target manifest는 **검사받는 repo가 소유**한다. story 이름을 바꾸는 PR이 manifest도 같은 PR에서 고칠 수 있어야 하기 때문이다.
예를 들어 shared-stack에 `.review/visual-targets.json`을 만든다. 내용은 review-platform의 [`fixtures/visual/targets/shared-stack.json`](../../fixtures/visual/targets/shared-stack.json)과 같은 형식이다.

story id는 build된 `storybook-static/index.json`에서 확인한다.

### workflow

shared-stack의 `.github/workflows/`에 파일을 하나 추가한다 (기존 `pr-check.yml`은 건드리지 않아도 된다).

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
      # fail-on: review-required   # 변경이 있으면 job을 실패시키고 싶을 때
    secrets:
      review-platform-token: ${{ secrets.REVIEW_PLATFORM_TOKEN }} # public이 되면 이 두 줄 삭제
```

입력값의 의미:

| 입력                  | 의미                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `manifest`            | 호출 repo root 기준 manifest 경로. head checkout에서 읽는다        |
| `storybook-build`     | 호출 repo root에서 실행할 Storybook static build 명령              |
| `storybook-dir`       | build 결과 디렉터리 (호출 repo root 기준)                          |
| `install`             | 의존성 설치 명령. 기본 `pnpm install --frozen-lockfile`            |
| `fail-on`             | `failed`(기본) 또는 `review-required`. 이 status 이상이면 job 실패 |
| `review-platform-ref` | 사용할 review-platform ref. 기본 `main`                            |

it-tech-blog는 `storybook-build: pnpm build-storybook`, `storybook-dir: apps/storybook/storybook-static` 정도로 같은 방식이 된다. snapdone은 Storybook이 없어서 이 workflow의 대상이 아니다.

## 3. 무엇이 일어나나

1. review-platform, base(PR base SHA), head(PR head SHA)를 각각 checkout한다.
2. base에서 Storybook을 build해 127.0.0.1:6006에 serve하고 `visual:capture --kind baseline`을 찍는다.
3. head에서 같은 일을 6007에 하고 `--kind current`를 찍는다.
4. `visual:compare`가 diff PNG와 `run.json`을 만든다.
5. `.review-data` 전체를 artifact `visual-run-pr-<번호>`로 올린다 (보관 14일). capture 도중 실패해도 찍힌 것까지는 올라간다.
6. `visual:summary`가 step summary에 표를 쓰고, `fail-on` 기준으로 job 성패를 정한다. `review-required`면 warning annotation이 붙는다.

run id는 `pr-<번호>`, `workflow_dispatch`면 `manual-<run number>`다.

## 4. 결과 확인

Actions의 job 페이지에서 artifact `visual-run-pr-<번호>`를 내려받아 압축을 풀고, review-platform에서:

```bash
REVIEW_DATA_DIR=<압축 푼 폴더> pnpm dev
```

`/runs/pr-<번호>`에서 baseline, current, diff를 본다. 변경이 의도한 것인지 판단하는 일은 아직 사람이 PR 리뷰에서 한다.

## 5. review-platform에서 먼저 시험하기

호출 repo를 건드리기 전에 review-platform의 Actions 탭에서 "Visual Regression" workflow를 `Run workflow`로 직접 실행할 수 있다.
기본값은 shared-stack `main` vs `main`이라 결과는 `passed`여야 한다. `head-ref`에 브랜치나 SHA를 넣으면 그 변경과 비교한다.
이때 manifest는 review-platform 안의 `fixtures/visual/targets/shared-stack.json`을 읽는다.

## 알아둘 점

- 비용은 PR마다 Storybook build 두 번이다. baseline을 보관해 base build를 생략하는 것은 다음 단계다.
- 비교는 픽셀 단위 정확 일치라서, Chromium이나 폰트 버전이 바뀌면 모든 target이 `changed`가 될 수 있다. review-platform이 Playwright 버전을 고정하므로 runner 이미지보다는 review-platform 업그레이드 시점에 생긴다.
- 같은 PR에 push하면 새 run이 생기고 artifact 이름은 같다. 최신 workflow run의 artifact를 보면 된다.
- `paths` 필터에 manifest 파일과 Storybook에 영향을 주는 경로를 넣어 두면, 관계없는 PR에서는 실행되지 않는다.
