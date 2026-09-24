# Quality Gates

여기 적힌 명령은 전부 실제로 존재하고 통과하는 것들이다. 동작하지 않는 명령은 적지 않는다.

## PR 올리기 전에

| 명령                | 실제로 도는 것                                                                | 대상                                                             |
| ------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm format:check` | `nx format:check`                                                             | git이 있으면 base 대비 변경 파일, 없으면 전체                    |
| `pnpm lint`         | `nx run-many -t lint`                                                         | web · web-e2e · visual-contracts                                 |
| `pnpm typecheck`    | `nx run-many -t typecheck`                                                    | 셋 다. web은 `tsconfig.json`과 `tsconfig.spec.json` 두 번        |
| `pnpm test`         | `nx run-many -t test`                                                         | visual-contracts · web (Vitest)                                  |
| `pnpm build`        | `nx run-many -t build`                                                        | web (`next build`)                                               |
| `pnpm tools:check`  | `tsc -p tools/tsconfig.json && eslint tools && vitest run --config tools/...` | `tools/` — **Nx 프로젝트가 아니라 `pnpm test`에 들어 있지 않다** |
| `pnpm test:hooks`   | `node --test tools/hooks/*.test.mjs`                                          | `.claude/hooks/` — Node 24 내장 러너, 의존성 없음                |
| `pnpm e2e`          | `nx run-many -t e2e`                                                          | web-e2e — 브라우저와 3200번 포트 필요                            |

`nx run-many`는 해당 target이 없는 프로젝트를 조용히 건너뛴다. 없는 target 때문에 실패하지 않는다.

`web`의 `typecheck`는 `package.json`에 직접 둔 target이다. `@nx/js/typescript` plugin은 `next.config.*`가 있는 프로젝트를 일부러 건너뛰기 때문이다.

### 설정 패키지

lint · format · tsconfig는 이 저장소 안에 직접 둔다. 검사 대상 저장소가 publish하는 `@berrypjh/*`에 기대지 않는다 ([기록](../records/2026-09-24-no-berrypjh-dependency.md)).

| 설정     | 위치                 | 내용                                                                             |
| -------- | -------------------- | -------------------------------------------------------------------------------- |
| ESLint   | `eslint.config.mjs`  | `@nx/eslint-plugin`의 `flat/base` · `typescript` · `javascript`, module boundary |
| Prettier | `.prettierrc.json`   | `printWidth: 100` · `singleQuote` · md/yaml override                             |
| tsconfig | `tsconfig.base.json` | strict · `noUnusedLocals` · `nodenext` · TS project references                   |

### `format:check`의 범위

`nx format:check`는 git base 대비 변경된 파일만 검사한다. 이 저장소는 아직 git repository가 아니라 지금은 전체를 검사한다(`Defaulting to all files pattern`). git이 생기면 전체 검사가 필요할 때 `pnpm exec prettier --check .`를 쓴다.

`pnpm-lock.yaml`과 `**/next-env.d.ts`는 `.prettierignore`에 있다. lockfile은 pnpm이 자기 형식으로 쓰고, `next-env.d.ts`는 build마다 다시 생성된다.

### cache 입력

`nx.json`의 `sharedGlobals`에 `fixtures/visual/**`가 있다. fixture PNG · `run.json`을 바꾸면 test · e2e cache가 무효화된다. 이게 없던 동안 fixture를 지워도 e2e가 cache에서 "7 passed"를 재생했다 ([기록](../records/2026-09-24-fixtures-in-cache-inputs.md)). **cache 적중은 새 검증이 아니다** — `--skip-nx-cache`로 실제 실행을 본다.

## 테스트 현황 — 솔직하게

| 프로젝트         | 종류 | 명령               | 상태                                                                                                                      |
| ---------------- | ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| visual-contracts | 단위 | `pnpm test`        | Vitest 64개 (2 파일). manifest · 세 status 불변식 · status 계산 · SHA · ISO · 경로 거부                                   |
| web              | 단위 | `pnpm test`        | Vitest 22개 (2 파일). `lib/`만 — run 읽기 · 정렬 · 계약 거부 · artifact 경로 안전성(symlink 포함) · 표시 helper           |
| tools/visual     | 단위 | `pnpm tools:check` | Vitest 49개 (5 파일). 인자 파싱 · URL 결합 · 경로 탈출 · compare(코드로 만든 PNG) · run status · summary                  |
| .claude/hooks    | 단위 | `pnpm test:hooks`  | node:test — hook을 실제로 실행해 stdin/stdout 계약까지 확인                                                               |
| web-e2e          | E2E  | `pnpm e2e`         | 7개 × Chromium. fixture run으로 Runs → Run Review → changed target → Diff. 이미지는 `naturalWidth > 0`으로 실제 로드 확인 |

덮인 것은 계약 전체, capture의 인자 · URL · 경로, compare 알고리즘, web의 데이터 읽기 · artifact route, 사용자 흐름이다. **덮이지 않은 것** — 실제 Chromium capture(단위 테스트 없음, dogfooding으로 확인), web 화면 컴포넌트(e2e가 대신 잡음), empty · malformed 상태의 화면(loader 테스트만 있음), GitHub Actions 위에서의 workflow 실행(로컬에서 같은 shell step을 실행해 확인했을 뿐).

### 단위 테스트 실행 방식

`nx.json`의 `@nx/vitest` plugin은 `testMode: "watch"`지만 각 `vitest.config.mts`가 `watch: false`라 `nx test`는 한 번 돌고 끝난다.

web의 `vitest.config.mts`는 `environment: 'node'`다. `lib/`가 순수 TS라 DOM이 필요 없다. **React 컴포넌트를 단위 테스트하게 되면** `jsdom` · `@testing-library/react`를 그때 함께 추가한다.

spec 파일도 `pnpm typecheck`가 검사한다. web은 `tsconfig.spec.json`을 따로 두고 `typecheck` target이 두 tsconfig를 순서대로 돈다. contracts의 spec은 fixture를 `satisfies VisualChange`로 적어 계약 위반이 컴파일 오류가 된다.

### E2E

`apps/web-e2e`는 fixture run `sample`로 사용자 흐름을 고정한다 — Runs 목록의 status 텍스트, 키보드로 run 열기, SHA 표시, changed · unchanged 목록, 세 탭의 이미지 로드, unchanged의 "No diff generated", 탭 키보드 이동.

- Playwright가 `REVIEW_DATA_DIR=<root>/fixtures/visual/review-data`로 **`next dev --port 3200`을 직접 띄운다.** nx를 거치지 않는 이유는 [기록](../records/2026-09-24-e2e-starts-next-directly.md)
- `reuseExistingServer: false`. 3000번의 일반 `pnpm dev`를 잘못 보지 않는다
- 역할 기반 선택자만 쓴다 — `role` · `heading` · `link` · `tab` · `tabpanel` · `img`(alt). `data-testid`는 없다
- 비활성 탭 패널은 DOM에서 빠지므로 이미지는 현재 `tabpanel` 안에서만 찾는다. 좌우 비교 영역에 alt가 같은 이미지가 있어도 헷갈리지 않는다
- 이 저장소의 UI 자체를 스크린샷 baseline으로 잡지 않는다

브라우저를 아직 받지 않았다면:

```bash
pnpm exec playwright install chromium
```

## Dependency 추가 원칙

설치하기 **전에** 아래를 순서대로 확인하고 그 결과를 설명한다.

1. 기존 dependency로 되는가
2. 표준 라이브러리로 되는가 (Node 내장 · Web API)
3. 현재 platform SDK로 되는가 (Next.js · Playwright)
4. 그래도 필요하면 왜 필요한지

**"편해서"는 사유가 아니다.**

실제로 적용된 예:

- CLI 인자는 Node 내장 `util.parseArgs`다. yargs · commander를 넣지 않았다
- `tsx`는 넣었다. contracts가 `.ts` 확장자로 import하는데 Node 24의 기본 type stripping은 `@review-platform/...` 패키지 안의 `.ts`를 따라가지 못한다(`ERR_MODULE_NOT_FOUND`로 확인)
- `pixelmatch` · `pngjs`는 넣었다. Playwright 내부의 비공개 비교 API에 기대지 않기 위해서다. `pngjs`는 type이 없어 `@types/pngjs`도 함께
- `http-server`는 넣었다. workflow에서 `npx --yes http-server`가 `command not found`로 실패하는 것을 확인했고, lockfile에 고정된 `pnpm exec http-server`가 결정적이다
- 검사 대상이 publish하는 `@berrypjh/*`는 뺐다. 설정값은 이 저장소로 옮겼고 적용 결과는 전후로 같다

### Nx 플러그인

개별 `pnpm add` 금지. `nx add` 또는 `nx migrate`만 쓴다. `nx`와 모든 `@nx/*`는 정확히 같은 버전이어야 한다.

## Security 기본 원칙

- 실제 secret을 커밋하지 않는다. `.env*`는 git에서 제외되고 `permissions.deny`가 읽기를 막는다
- **artifact route는 `REVIEW_DATA_DIR` 밖을 제공하지 않는다.** run id · 경로를 계약으로 검사하고, symlink를 따라간 실제 위치가 데이터 디렉터리 안인지 확인하며, PNG signature로 시작하는 파일만 돌려준다. 그 외는 전부 404
- `run.json`에 절대 경로를 넣지 않는다. artifact로 올라가는 파일이다
- **오류 화면에 stack trace를 보이지 않는다.** production의 `error.tsx`는 digest만 보이고 서버 로그로 안내한다. run 단위의 계약 · 파일시스템 문제는 예외가 아니라 값(`RunProblem`)으로 돌려 화면이 이유별로 그린다
- 앱 소스에 `console.*`를 남기지 않는다. CLI(`tools/visual`)에서는 출력이 곧 인터페이스다
- `.claude/hooks/` · `.github/workflows/`는 아무도 지시하지 않아도 돈다. 이 파일들을 건드리는 변경은 일반 코드와 다르게 리뷰한다 ([.claude/README.md](../../.claude/README.md#신뢰-표면))

## TypeScript

- `any`를 쓰지 않는다. 외부 입력(`run.json` · manifest · CLI 인자)은 zod schema로 좁힌다
- unused import · dead code를 남기지 않는다. `tsconfig.base.json`의 `noUnusedLocals`가 잡는다
- contracts의 상대 import는 `.ts` 확장자를 쓴다. Turbopack이 `.js`로 적힌 import를 `.ts`로 연결하지 못한다 ([기록](../records/2026-09-24-ts-extension-imports.md))

## 접근성

화면을 추가할 때마다 확인한다.

- `html lang="en"`, skip link, `header` · `main` · `nav` landmark
- status는 아이콘 + 텍스트 badge(`StatusBadge`). 색만으로 구분하지 않는다
- 클릭 가능한 것은 `<button>` 또는 `<a>`. 선택된 change에는 `aria-current`
- focus 표시는 `lib/styles.ts`의 `focusRing` 하나로
- 이미지 alt는 목적을 적는다 — `"<label>: diff with 8 px highlighted in red"`
- 390px 폭에서 가로 스크롤 없음 (e2e는 보지 않는다 — 수동 확인)

측정하지 않은 값을 0으로 보이지 않게 한다. "Not measured"다.
