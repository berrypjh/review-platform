# review-platform — Engineering Review Platform

> `CLAUDE.md`가 `@AGENTS.md`로 이 파일을 불러온다. 에이전트 지침의 단일 출처는 이 파일이다.

다른 저장소의 변경을 사람이 검토할 수 있게 **증거를 수집하고 보여 주는** 플랫폼. 첫 기능은 Storybook Visual Regression이다.

`target manifest → capture(baseline · current) → compare → run.json → Review UI` 순서로 흐른다. 판단 기준은 **결정적인 수집 · 계약으로 검증한 데이터 · 사람이 판단할 수 있는 화면**이고, 도구는 차이를 보고할 뿐 의도한 변경인지 판단하지 않는다.

## Repository Overview

Nx integrated monorepo. package manager는 **pnpm**(`package.json`의 `packageManager`로 고정).

| project            | 위치                    | 스택                 | 역할                                                                   |
| ------------------ | ----------------------- | -------------------- | ---------------------------------------------------------------------- |
| `web`              | `apps/web`              | Next.js + TypeScript | Review UI. `run.json`을 읽기만 한다 — 비교 · 승인 · 저장을 하지 않는다 |
| `web-e2e`          | `apps/web-e2e`          | Playwright           | web E2E. Chromium 하나                                                 |
| `visual-contracts` | `libs/visual-contracts` | zod                  | artifact JSON의 단일 계약. 비공개 · 릴리스하지 않음                    |

Nx 프로젝트가 아닌 곳도 있다.

| 위치                | 내용                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `tools/visual`      | `visual:capture` · `visual:compare` · `visual:summary` CLI. `tsx`로 실행 |
| `tools/hooks`       | `.claude/hooks/` 테스트                                                  |
| `fixtures/visual`   | 커밋된 target manifest와 작은 fixture run. test · e2e · 문서가 읽는다    |
| `.github/workflows` | 다른 저장소의 PR이 호출하는 reusable workflow                            |
| `docs/`             | 구조 · 개발 · 품질 · 연동 문서, 개발 기록(`docs/records`)                |

**`tools/`는 Nx 프로젝트가 아니라 `nx affected`가 닿지 않는다.** 타입 검사 · lint · 테스트는 `pnpm tools:check`로 돈다.

**target 이름은 프로젝트마다 다르다. 문서를 믿지 말고 `nx show project <이름>`으로 확인한다.** `web`의 `typecheck`는 plugin이 추론하지 않아 `package.json`에 직접 두었다.

## Working Principles

- 수정 전 관련 코드를 **읽는다.** 추측해서 덮어쓰지 않는다
- 기존 architecture와 convention을 먼저 재사용한다. 새 방식을 들여오기 전에 기존 것으로 왜 안 되는지 설명한다
- **사용자의 미커밋 변경을 보존한다.** `reset` · `checkout --` · `stash`로 되돌리지 않는다
- 관계없는 refactor를 하지 않는다. scope 밖 기능을 만들지 않는다. **두 번째 기능은 첫 기능을 실제로 써 본 뒤에** 시작한다
- 작게 · 점진적으로 진행하고 각 단계를 검증한 뒤 넘어간다
- 문제를 고칠 때는 **근본 원인을 먼저 증명한다.** 재현 → 증거 → 수정. 추측 workaround를 넣지 않는다
- 과도한 방어적 프로그래밍을 하지 않는다. 모듈 · 함수는 짧게, 이름은 분명하게
- 주석은 docstring 위주로 간결하게. 주석과 문서는 한글, 식별자 · CLI 메시지 · UI 문자열은 영어. 코드 · print · 로그에 이모지를 쓰지 않는다

### 검사 대상과의 경계

이 저장소는 **검사받는 저장소의 코드를 모른다.** 이어지는 것은 Storybook URL과 story id라는 데이터뿐이다 ([target-architecture.md](docs/architecture/target-architecture.md#경계)).

- 검사 대상 저장소의 source · dist를 import · symlink · submodule로 끌어오지 않는다
- 검사 대상이 publish하는 패키지에도 의존하지 않는다. `@berrypjh/*`를 쓰지 않는 이유는 [기록](docs/records/2026-09-24-no-berrypjh-dependency.md)
- target manifest는 검사받는 저장소가 소유한다. 이 저장소의 `fixtures/visual/targets/`는 dogfooding · 시험용이다

### 데이터 원칙

- **schema가 type의 단일 출처다.** `libs/visual-contracts`의 zod schema에서 `z.infer`로 type을 얻는다. 손으로 쓴 중복 type을 두지 않는다
- **측정하지 못한 값은 0이 아니다.** `null` + 이유로 남기고, 화면은 "Not measured"로 보여 준다
- **status는 한 곳에서 계산한다.** `deriveRunStatus` 하나. UI · CLI가 다시 계산하지 않는다
- **artifact 경로는 run 디렉터리 기준 상대 경로다.** 절대 경로 · `..`은 계약이 거부한다

경로별 상세 규칙은 `.claude/rules/`에 있고 해당 파일을 열 때 적용된다 — `web.md` · `contracts.md` · `tools.md` · `e2e.md` · `docs.md`. **하위 `AGENTS.md`를 두지 않는다.** 프로젝트 문서는 root의 `docs/`와 rule이 맡는다 ([기록](docs/records/2026-09-24-rules-not-per-project-agents.md)).

### Dependency

설치하기 **전에** 순서대로 확인하고 결과를 설명한 뒤에만 설치한다.

1. 기존 dependency로 되는가
2. 표준 라이브러리로 되는가 (Node 내장 · Web API)
3. 현재 platform SDK로 되는가 (Next.js · Playwright)
4. 그래도 필요하면 왜 필요한지

**"편해서"는 사유가 아니다.** 설치가 필요하면 실행하기 전에 사용자에게 요청한다.

버전은 임의로 올리지 않는다. Nx plugin(`@nx/*`)은 개별 `pnpm add` 금지 — `nx add` 또는 `nx migrate`만 쓴다. 고정 버전 표는 [target-architecture.md](docs/architecture/target-architecture.md#버전-정책).

## Validation

- 완료를 선언하기 전에 **영향 범위를 검증한다.** 검증하지 않은 것을 검증했다고 말하지 않는다
- 가장 작은 범위부터 올라간다. `tools/`를 바꿨으면 `pnpm tools:check`, 한 프로젝트를 바꿨으면 그 프로젝트의 target부터
- lint · typecheck · test 오류를 무시하지 않는다. 기존 테스트를 깨뜨리지 않는다. 통과시키려고 테스트를 지우거나 skip하지 않는다
- fixture를 바꾸면 `nx.json`의 `sharedGlobals` 덕분에 test · e2e cache가 무효화된다. cache 적중은 새 검증이 아니다
- 무엇을 어디까지 돌릴지는 `/repo-verify`가 판단한다. affected 매핑 · target 표 · 사다리가 거기 있다

**AI 세션에서 실행할 수 없는 것**이 있다. dev 서버 · `pnpm e2e` · `nx build web` · 정적 서버(`http-server`)는 샌드박스에서 포트 바인딩이 막혀 `.claude/hooks/guard-bash.mjs`가 거부한다. 사용자 터미널에서는 정상 동작하므로 실행을 요청하고, 실행하지 못했으면 그렇게 보고한다. 샌드박스를 끈 머신에서는 [.claude/README.md](.claude/README.md#hook)를 본다.

검증 명령은 [quality-gates.md](docs/engineering/quality-gates.md).

## Git Safety

명시적 요청 없이 하지 않는다.

- commit · push · force push · merge · branch 삭제 · tag · release
- `git reset --hard` · `git checkout --` · `git stash` — 사용자 변경을 지운다
- **CI · workflow 파일 수정** — 작업이 자동화 자체일 때만 고친다
- 검사 대상 저장소(shared-stack 등)의 파일 수정 — 이 저장소는 그쪽을 읽기만 한다

커밋은 공용 plugin `berry-commit`의 `/berry-commit:commit-scope`로 한다(`.claude/settings.json`의 `enabledPlugins`). scope별로 사용자 승인을 받은 뒤에만 커밋한다.

## Memory

| 어디에                                                                       | 무엇을                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **committed** — `AGENTS.md` · `.claude/rules/` · `.claude/skills/` · `docs/` | architecture · 안정적인 convention · 명령 · 팀 정책           |
| **auto memory**                                                              | 이 머신에서 반복되는 사실 (막히는 경로, 우회 방법, 개인 선호) |

architecture를 auto memory에만 두지 않는다. **secret과 credential은 어디에도 저장하지 않는다.**

## 문서

| 문서                                                                | 내용                                          |
| ------------------------------------------------------------------- | --------------------------------------------- |
| [target-architecture.md](docs/architecture/target-architecture.md)  | 구조 · 경계 · 버전 정책 · 무엇이 있고 없는가  |
| [visual-contracts.md](docs/architecture/visual-contracts.md)        | artifact 계약 — schema · 불변식 · 경로 규칙   |
| [local-development.md](docs/development/local-development.md)       | 실행 · `REVIEW_DATA_DIR` · CLI · 트러블슈팅   |
| [quality-gates.md](docs/engineering/quality-gates.md)               | 검증 · 테스트 현황 · 의존성 원칙              |
| [shared-stack-dogfood.md](docs/integration/shared-stack-dogfood.md) | shared-stack Storybook으로 손으로 돌려 보기   |
| [pr-integration.md](docs/integration/pr-integration.md)             | 다른 저장소의 PR에서 reusable workflow로 실행 |
| [docs/records](docs/records/)                                       | 날짜별 개발 기록(결정 · 수정 · 구현)          |

AI harness(rule · hook · permission)가 어떻게 구성돼 있는지는 [.claude/README.md](.claude/README.md).
