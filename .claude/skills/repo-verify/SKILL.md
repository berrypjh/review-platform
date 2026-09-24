---
name: repo-verify
description: 바뀐 파일에서 영향받는 Nx 프로젝트를 정하고, 가장 싼 검사부터 필요한 만큼만 올려가며 검증한다. 검증하지 못한 것은 그대로 보고한다.
when_to_use: Use after changing code in this repository, before reporting that work is done. Also when unsure which projects a change affects, or how far to escalate lint / typecheck / test / build.
argument-hint: '<files|project> (생략 시 git 변경분)'
---

# repo-verify

목적은 전부 돌리는 것이 아니라 **이 변경에 필요한 만큼만 돌리고, 돌리지 않은 것을 정직하게 말하는 것**이다.

## 1. 무엇이 바뀌었나

```bash
git status --porcelain
```

**내가 만든 변경과 사용자의 기존 미커밋 변경을 구분한다.** 건드리지 않은 파일을 검증 범위에 넣지 않는다. 아직 git repository가 아니면 이번 세션에서 쓴 파일 목록이 기준이다.

## 2. 어떤 프로젝트가 영향받나

짐작하지 말고 Nx에게 묻는다.

```bash
nx show projects --affected --files=<바뀐 파일, 쉼표 구분>
```

이 저장소에서 실측한 매핑(2026-09-24):

| 바꾼 파일                                                                                        | affected                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `apps/web/**`                                                                                    | `web`, **`web-e2e`**                 |
| `apps/web-e2e/**`                                                                                | `web-e2e`                            |
| `libs/visual-contracts/**`                                                                       | `visual-contracts`, `web`, `web-e2e` |
| `fixtures/visual/**`                                                                             | **전부 3개** (`sharedGlobals`)       |
| `nx.json` · `tsconfig.base.json` · 루트 `package.json` · `eslint.config.mjs`                     | **전부 3개**                         |
| `tools/**` · `.claude/**` · `.github/**` · `docs/**` · 루트 `tsconfig.json` · `.prettierrc.json` | 없음 (`[]`)                          |

`web` 변경이 `web-e2e`까지 끌어오는 것은 `implicitDependencies` 때문이며 의도된 동작이다.

**affected가 비어 있는 경로에도 검사가 있다.** Nx 프로젝트가 아니라서 `nx`가 모를 뿐이다.

| 바꾼 곳                               | 검사                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| `tools/visual/**`                     | `pnpm tools:check` — tsc · eslint · Vitest                   |
| `.claude/hooks/**` · `tools/hooks/**` | `pnpm test:hooks`                                            |
| `.github/workflows/**`                | YAML 파싱 · `pnpm format:check`. Actions 위 실행은 사용자 몫 |
| `docs/**` · `*.md`                    | `pnpm format:check`, 링크가 실제 파일을 가리키는지           |
| `fixtures/visual/**`                  | affected 3개 + `pnpm tools:check` (compare 테스트가 읽는다)  |

## 3. 그 프로젝트에 target이 있는지 확인한다

| project            | 있는 target                                               |
| ------------------ | --------------------------------------------------------- |
| `web`              | `lint` `typecheck` `test` `build` (`dev`는 검증이 아니다) |
| `web-e2e`          | `lint` `typecheck` `e2e`                                  |
| `visual-contracts` | `lint` `typecheck` `test`                                 |

확실하지 않으면 `nx show project <이름>`으로 본다. `nx affected -t <target>`은 그 target이 없는 프로젝트를 **조용히 건너뛴다**(`No tasks were run`). 없는 target 때문에 실패하지 않으므로 target을 묶어서 넘겨도 된다.

## 4. 사다리 — 가장 싼 것부터

변경 크기에 따라 멈출 지점을 정한다. 모든 변경을 Level 5까지 올리지 않는다.

**Level 1 — 바꾼 프로젝트의 정적 검사**

```bash
nx affected -t lint,typecheck --files=<바뀐 파일>
```

한 파일 수정, 텍스트 · 스타일 변경이면 여기서 끝난다.

**Level 2 — 단위 테스트 추가**

```bash
nx affected -t lint,typecheck,test --files=<바뀐 파일>
```

로직을 건드렸거나 파일을 여러 개 고쳤으면 여기까지. `tools/`를 고쳤으면 `pnpm tools:check`를 함께.

**Level 3 — 교차 변경**

- `libs/visual-contracts`를 고치면 affected가 `web` · `web-e2e`를 끌어온다. **`tools/`는 끌어오지 않으므로** `pnpm tools:check`를 반드시 붙인다 — capture · compare · summary가 같은 계약을 쓴다
- `run.json`의 모양을 바꿨으면 `fixtures/visual/review-data/runs/sample/run.json`도 새 계약을 통과해야 한다. contracts 테스트가 fixture manifest를 읽고, e2e가 fixture run을 읽는다
- `tools/visual/paths.ts`(경로 규칙)를 바꿨으면 `apps/web/src/lib/review-data.ts`(같은 규칙을 읽는 쪽)도 본다. 둘은 코드를 공유하지 않는다

**Level 4 — 빌드**

```bash
nx affected -t build --files=<바뀐 파일>
```

`web`의 라우팅 · 설정 · 의존성, 또는 contracts의 import 형태를 건드렸을 때. **AI 세션에서는 hook이 막는다** — 아래 6절.

**Level 5 — 런타임 / E2E**

```bash
pnpm e2e        # web-e2e. 브라우저 바이너리와 3200번 포트가 필요하다
```

화면 구조 · 라우팅 · 이미지 로드 경로 · fixture run을 바꿨을 때만. 사용자 터미널에서.

**대규모 변경** — `nx.json` · `tsconfig.base.json` · 루트 `package.json` · `eslint.config.mjs` · `fixtures/visual/**`를 고쳤으면 affected가 전부를 반환한다. 그때는 `pnpm lint && pnpm typecheck && pnpm test && pnpm tools:check`를 쓰고 build · e2e는 사용자에게 요청한다.

**cache 적중은 새 검증이 아니다.** 결과가 의심되면 `--skip-nx-cache`로 실제 실행을 본다. 출력의 `[existing outputs match the cache]`가 재생의 표시다.

## 5. 이 환경에서 실행할 수 없는 것

돌리지 못한 것을 돌렸다고 말하지 않는다.

| 항목                                   | 이유                                                             |
| -------------------------------------- | ---------------------------------------------------------------- |
| `pnpm e2e` · `playwright test`         | 포트 바인딩이 샌드박스에서 차단된다. `--list`는 된다             |
| `pnpm dev` · `next dev` · `next start` | 같은 이유                                                        |
| `nx build web`                         | Turbopack의 PostCSS 워커가 포트를 연다. 같은 이유로 막힌다       |
| `http-server` (Storybook serve)        | 같은 이유. capture는 서버가 있어야 하므로 dogfooding은 사용자 몫 |
| GitHub Actions 위의 workflow 실행      | 수단 자체가 없다. shell step을 로컬에서 같은 명령으로 돌려 본다  |

앞의 넷은 **AI 세션에서만** 막힌다(`.claude/hooks/guard-bash.mjs`의 `PORT_BOUND`). 사용자 터미널에서는 정상 동작하므로 실행을 요청하면 된다.

`pnpm build`는 막지 않는다 — `web` 하나뿐이라 부분 성공이 없고, hook은 `nx build web` 형태만 본다. 결과를 받았으면 `apps/web/.next/BUILD_ID` 존재로 성공을 확인할 수 있다.

## 6. 마지막

```bash
git diff
```

의도한 변경만 있는지 본다. 그리고 보고할 때 **무엇을 돌렸는지, 무엇을 못 돌렸는지, 왜 못 돌렸는지**를 함께 적는다.

명령의 전체 목록과 배경은 [quality-gates.md](../../../docs/engineering/quality-gates.md).

## 보고

```
영향: <affected 프로젝트 목록> (판정 근거: nx show projects --affected --files=...)

## 실행함
- <명령> — PASS / FAIL(<요약>)

## 실행 안 함
- <명령> — <왜 불필요했는지 또는 이 환경에서 왜 불가능한지>
```

`실행 안 함`을 비워두지 않는다. 돌리지 않은 것을 적지 않으면 전부 돌린 것처럼 읽힌다.
