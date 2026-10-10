# Quality Gates

## 명령

| 명령                  | 실행 내용                                                                     | 대상                                                        |
| --------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm format:check`   | `nx format:check`                                                             | git base 대비 변경 파일                                     |
| `pnpm lint`           | `nx run-many -t lint`                                                         | web · web-e2e · visual-contracts                            |
| `pnpm typecheck`      | `nx run-many -t typecheck`                                                    | 셋 다. web은 `tsconfig.json` · `tsconfig.spec.json`         |
| `pnpm test`           | `nx run-many -t test`                                                         | visual-contracts · web (Vitest)                             |
| `pnpm build`          | `nx run-many -t build`                                                        | web (`next build`)                                          |
| `pnpm tools:check`    | `tsc -p tools/tsconfig.json && eslint tools && vitest run --config tools/...` | `tools/` — Nx 프로젝트가 아니라 `pnpm test`에 없음          |
| `pnpm test:hooks`     | `node --test tools/hooks/*.test.mjs`                                          | `.claude/hooks/`                                            |
| `pnpm e2e`            | `nx run-many -t e2e`                                                          | web-e2e — 브라우저 · 3200번 포트 필요                       |
| `pnpm nx test-db web` | `vitest run --config vitest.db.config.mts`                                    | web의 `*.db-test.ts` — `TEST_DATABASE_URL` 필요, cache 없음 |

- `nx run-many`는 target이 없는 프로젝트를 건너뜀
- web의 `typecheck`는 `apps/web/package.json`에 직접 정의. `@nx/js/typescript` plugin이 `next.config.*`가 있는 프로젝트를 건너뜀
- 전체 파일 형식 검사는 `pnpm exec prettier --check .`

### 설정

| 설정     | 위치                 | 내용                                                                             |
| -------- | -------------------- | -------------------------------------------------------------------------------- |
| ESLint   | `eslint.config.mjs`  | `@nx/eslint-plugin`의 `flat/base` · `typescript` · `javascript`, module boundary |
| Prettier | `.prettierrc.json`   | `printWidth: 100` · `singleQuote` · md/yaml override                             |
| tsconfig | `tsconfig.base.json` | strict · `noUnusedLocals` · `nodenext` · project references                      |

- `.prettierignore` — `pnpm-lock.yaml` · `**/next-env.d.ts`
- `@berrypjh/*` 설정 패키지는 쓰지 않음 ([기록](../records/2026-09-24-no-berrypjh-dependency.md))

### cache 입력

`nx.json`의 `sharedGlobals`가 `fixtures/visual/**`. fixture를 바꾸면 test · e2e cache 무효화 ([기록](../records/2026-09-24-fixtures-in-cache-inputs.md)). 실제 실행은 `--skip-nx-cache`.

## 테스트 범위

| 프로젝트         | 종류    | 명령                  | 범위                                                                                         |
| ---------------- | ------- | --------------------- | -------------------------------------------------------------------------------------------- |
| visual-contracts | 단위    | `pnpm test`           | manifest · status 불변식 · status 계산 · SHA · ISO 시각 · 경로 거부                          |
| web              | 단위    | `pnpm test`           | `src/lib/**/*.test.ts` — run 읽기 · 표시 helper · 승인 상태 전이 · GitHub 서명 · 설정 · 세션 |
| web              | DB 통합 | `pnpm nx test-db web` | `src/lib/**/*.db-test.ts` — 실제 PostgreSQL + 가짜 GitHub transport                          |
| tools/visual     | 단위    | `pnpm tools:check`    | 인자 파싱 · URL 결합 · 경로 탈출 · compare · run status · summary                            |
| .claude/hooks    | 단위    | `pnpm test:hooks`     | hook을 실행해 stdin/stdout 계약 확인                                                         |
| web-e2e          | E2E     | `pnpm e2e`            | `review-flow` · `manual-approval`(`E2E_DATABASE_URL` 필요) · `live-smoke`(opt-in) — Chromium |

- **단위 테스트 없음** — 실제 Chromium capture, web 화면 컴포넌트, route handler
- **Vitest** — `watch: false`, `environment: 'node'`
- **spec 타입 검사** — web은 `tsconfig.spec.json`. contracts spec은 fixture를 `satisfies VisualChange`로 작성

### E2E

- Playwright가 `next dev --port 3200`을 직접 띄움(`REVIEW_DATA_DIR=<root>/fixtures/visual/review-data`). `reuseExistingServer: false` ([기록](../records/2026-09-24-e2e-starts-next-directly.md))
- 역할 기반 선택자만. `data-testid` 없음
- 이미지는 현재 `tabpanel` 안에서 찾고 `naturalWidth`로 로드 확인
- 이 저장소의 UI 스크린샷 baseline은 없음

## Dependency

추가 전 확인 순서는 [AGENTS.md](../../AGENTS.md#dependency). 현재 선택:

| 패키지                 | 용도                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `util.parseArgs`(내장) | CLI 인자. yargs · commander 없음                                                                |
| `tsx`                  | `tools/visual` 실행. contracts의 `.ts` 확장자 import를 Node 기본 type stripping이 따라가지 못함 |
| `pixelmatch` · `pngjs` | 이미지 비교 · PNG 읽기(`@types/pngjs` 포함)                                                     |
| `http-server`          | workflow에서 Storybook static serve(`pnpm exec http-server`)                                    |
| `postgres`             | 승인 DB 접속                                                                                    |

Nx plugin(`@nx/*`)은 `nx add` · `nx migrate`로만. `nx`와 모든 `@nx/*`는 같은 버전.

## Security

- `.env*`는 git 제외(`!.env.example`만 허용). `.claude/settings.json`의 deny가 읽기 차단
- **artifact route** — run id · 경로를 계약으로 검사, symlink를 따라간 실제 위치가 데이터 디렉터리 안인지 확인, PNG signature 파일만 제공. 그 외 404
- `run.json`에 절대 경로 없음
- **오류 화면** — `error.tsx`는 digest만 표시. run 단위 문제는 `RunProblem` 값으로 이유별 표시
- **앱 로그** — `console.error`만, 서버 쪽 오류 기록에만(`app/pulls` · `lib/manual-approval`)
- `.claude/hooks/` · `.github/workflows/`는 지시 없이 실행됨 ([.claude/README.md](../../.claude/README.md#신뢰-표면))

## TypeScript

- `any` 없음. 외부 입력(`run.json` · manifest · CLI 인자 · webhook · form)은 zod로 좁힘
- `noUnusedLocals`
- contracts의 상대 import는 `.ts` 확장자 ([기록](../records/2026-09-24-ts-extension-imports.md))

## 접근성

- `html lang="en"`, skip link, `header` · `main` · `nav` landmark
- status는 아이콘 + 텍스트(`StatusBadge`)
- 클릭 대상은 `<button>` · `<a>`. 선택된 change에 `aria-current`
- focus 표시는 `lib/styles.ts`의 `focusRing`
- 이미지 alt는 목적 — 예: `"<label>: diff with 8 px highlighted in red"`
- 측정하지 않은 값은 0이 아니라 "Not measured"
