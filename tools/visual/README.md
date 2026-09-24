# tools/visual

Visual Regression의 수집 단계를 담당하는 Node CLI. Nx 프로젝트가 아니라 root tooling이며 `tsx`로 실행한다. 입력 manifest와 출력 `run.json`은 모두 `@review-platform/visual-contracts`로 검증한다. 사용 순서 · 산출물 · 트러블슈팅은 [local-development.md](../../docs/development/local-development.md).

## 명령

```bash
pnpm visual:capture -- --run-id <id> --kind baseline|current --base-url <storybook-url> --targets <manifest>
pnpm visual:compare -- --run-id <id> --repository <name> --base-sha <sha> --head-sha <sha> --targets <manifest>
pnpm visual:summary -- --run-id <id> [--fail-on failed|review-required]
```

모든 명령은 `--data-dir`(기본 `.review-data`)와 `--help`를 받는다. `visual:summary`는 CI용이다 — `run.json`을 Markdown 표로 출력하고 run status가 `--fail-on` 이상이면 exit 1, `GITHUB_OUTPUT`이 있으면 `status=`를 덧붙인다.

## 파일

```
cli-args.ts        세 CLI의 공통 옵션과 run-id 검증. 새 명령도 COMMON_OPTIONS를 펼쳐 쓴다
paths.ts           run 디렉터리와 artifact 경로. resolveInside가 run 밖을 거부한다
manifest.ts        manifest 읽기와 검증
capture/           url.ts(base URL 결합) · args.ts · capture.ts(Playwright) · cli.ts
compare/           args.ts · compare-target.ts(pixelmatch) · run.ts(run.json) · cli.ts
summary/           summary.ts(Markdown · fail-on 판정) · cli.ts
```

## 규칙

- **Node 내장 `util.parseArgs`만.** yargs · commander를 넣지 않는다
- **경로는 `paths.ts`로만 만든다.** 문자열을 직접 이어 붙이지 않는다. `run.json`에는 run 기준 상대 경로만 들어간다
- **capture는 target마다 새 context, 순차 실행, 고정 sleep 없음.** 결정성을 위한 것이라 바꾸지 않는다. `#storybook-root`와 `document.fonts.ready`만 기다린다
- **compare는 정확 일치**(`threshold: 0` · `includeAA: true`). 이미지가 없거나 크기가 다르면 `error` change. run status는 `deriveRunStatus`로만
- **`run.json`은 `VisualRunSchema.parse` 뒤 임시 파일 → rename.** 이미 있는 산출물(같은 kind의 capture, `run.json`, `diff/`)은 거부한다
- **오류는 삼키지 않는다.** 어떤 target이 어느 단계(`navigate` · `wait-root` · `wait-fonts` · `screenshot`)에서 실패했는지 메시지에 담는다. retry · queue · partial recovery를 만들지 않는다
- **workflow에 판정 로직을 두지 않는다.** `.github/workflows/visual-regression.yml`은 세 CLI만 부른다

## 검증

```bash
pnpm tools:check   # tsc -p tools/tsconfig.json · eslint tools · Vitest 49개
```

PNG는 테스트 안에서 `pngjs`로 만든다. 파일 fixture에 기대지 않는다. 실제 Chromium capture는 단위 테스트가 없고 dogfooding으로 확인한다 ([shared-stack-dogfood.md](../../docs/integration/shared-stack-dogfood.md)).

## Gotcha

- **`tsx`가 필요하다.** contracts가 `.ts` 확장자로 import하는데 Node 24의 기본 type stripping은 패키지 안의 `.ts`를 따라가지 못한다
- **정적 서버는 devDependency `http-server`(`pnpm exec`).** `npx --yes http-server`는 `command not found`로 실패한 적이 있다
- **`--kind`가 실패하면 그 전까지 찍은 PNG가 남는다.** 같은 run-id로는 다시 못 찍으므로 새 run-id를 쓴다
