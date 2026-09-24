---
paths:
  - 'tools/**'
  - 'fixtures/visual/**'
---

# tools (`tools/`) · fixtures (`fixtures/visual/`)

`tools/visual`은 capture · compare · summary CLI, `tools/hooks`는 hook 테스트다. **Nx 프로젝트가 아니다** — `nx affected`가 닿지 않고 `pnpm tools:check`(typecheck · eslint · Vitest) · `pnpm test:hooks`로 검증한다. 사용법은 [tools/visual/README.md](../../tools/visual/README.md), 순서 · 산출물 · 트러블슈팅은 [local-development.md](../../docs/development/local-development.md).

## CLI

- **Node 내장 `util.parseArgs`만 쓴다.** yargs · commander를 넣지 않는다
- 세 명령의 공통 옵션(`--run-id` · `--targets` · `--data-dir` · `--help`)과 run-id 검증은 `cli-args.ts`에 있다. 새 명령도 `COMMON_OPTIONS`를 펼쳐 쓴다
- `pnpm script -- ...`가 넘기는 맨 앞 `--`는 `stripLeadingDashes`가 뗀다
- 입력 manifest는 `readManifest`로만 읽는다. schema issue를 전부 나열해 던진다
- 오류는 삼키지 않는다. 어떤 target이 어느 단계(`navigate` · `wait-root` · `wait-fonts` · `screenshot`)에서 실패했는지 메시지에 담는다. partial recovery · retry · queue를 만들지 않는다
- `tsx`로 실행한다. contracts가 `.ts` 확장자로 import하는데 Node 24의 기본 type stripping은 패키지 안의 `.ts`를 따라가지 못한다. `tools/tsconfig.json`은 `noEmit` · `allowImportingTsExtensions`

## 경로

- 산출물 경로는 `paths.ts`로만 만든다. `resolveInside`가 run 디렉터리 밖을 거부한다. 문자열을 직접 이어 붙이지 않는다
- run 기준 상대 경로(`artifactPath`)와 절대 경로(`resolveArtifact`)를 구분한다. `run.json`에는 상대 경로만 들어간다
- base URL과 target path 결합은 `capture/url.ts`. origin · base 경로 밖으로 나가면 예외

## capture · compare 불변식

- capture는 **target마다 새 context, 순차 실행, 고정 sleep 없음.** 이 셋은 결정성을 위한 것이라 바꾸지 않는다. viewport는 manifest 값 한 벌. `#storybook-root`와 `document.fonts.ready`만 기다린다
- compare는 **정확 일치**(`threshold: 0` · `includeAA: true`). 허용치는 없다
- 이미지가 없거나 크기가 다르면 `error` change. mismatch 값을 만들지 않는다
- run status는 `deriveRunStatus`로만. 두 번째 로직을 두지 않는다
- `run.json`은 `VisualRunSchema.parse` 뒤 임시 파일 → rename
- 이미 있는 산출물(같은 kind의 capture, `run.json`, `diff/`)은 덮어쓰지 않고 거부한다. `--kind`가 중간에 실패하면 찍힌 PNG가 남으므로 새 run-id를 쓴다

## workflow와의 접점

- `.github/workflows/visual-regression.yml`은 `visual:capture` · `visual:compare` · `visual:summary`만 부른다. 판정 로직을 YAML에 두지 않는다
- `visual:summary`의 `--fail-on`이 job 성패다. `GITHUB_OUTPUT`에 `status=`를 쓴다
- 정적 서버는 devDependency `http-server`(`pnpm exec`). `npx --yes`는 쓰지 않는다 — `command not found`로 실패한 적이 있다

## fixtures

- **작고 결정적이어야 한다.** `review-data/runs/sample`의 PNG는 코드로 만든 32x20이다. 실제 스크린샷 같은 큰 바이너리를 커밋하지 않는다
- `nx.json`의 `sharedGlobals`에 이 디렉터리가 있어 바꾸면 세 프로젝트의 test · e2e cache가 무효화된다. 항목을 지우지 않는다
- `review-data/runs/sample/diff` · `run.json`은 커밋 대상이다. e2e가 저장소 안 데이터만으로 돌아야 한다. 손으로 고치지 않고 compare로 다시 만든다 ([local-development.md](../../docs/development/local-development.md#fixture))
- `targets/shared-stack.json`의 story id는 build된 `storybook-static/index.json`에서 읽은 값이다. 추측으로 바꾸지 않는다. target manifest는 원래 검사받는 저장소가 소유하고, 여기 있는 것은 시험용이다
- 새 fixture run이 필요하면 먼저 `apps/web/src/lib/review-data.test.ts`(임시 디렉터리에 코드로 만든다)로 되는지 본다

## 테스트

- PNG는 테스트 안에서 `pngjs`로 만든다. 파일 fixture에 기대지 않는다
- 임시 디렉터리는 `mkdtemp`로 만들고 `afterEach`에서 지운다
- hook 테스트는 hook 프로세스를 **실제로 실행**한다. 정규식만 검사하지 않는다. `PORT_BOUND` · `BYPASS`를 고치면 테스트를 함께 고친다
- 실제 Chromium capture는 단위 테스트가 없다. dogfooding으로 확인한다 ([shared-stack-dogfood.md](../../docs/integration/shared-stack-dogfood.md))
