# AI Development Harness

이 저장소의 Claude Code 설정이 어떻게 구성돼 있고 왜 그렇게 됐는지에 대한 **개발자용 문서**다. Claude에게 항상 주입되는 문서가 아니다.

Claude에게 주입되는 것은 `AGENTS.md`(루트 `CLAUDE.md`가 `@AGENTS.md`로 불러온다)와 `.claude/rules/`이며, 이 문서는 그 내용을 반복하지 않는다.

## 목적

AI가 이 저장소에서 **일반적인 Nx 조언이 아니라 이 저장소의 실제 규칙**을 따르게 하는 것. 그리고 그 규칙을 매 세션 전부 읽히지 않고 필요한 순간에만 읽히게 하는 것.

같은 지시를 두 군데에 적지 않는다. 새 규칙을 추가할 때는 아래 순서로 자리를 정한다.

| 문제의 성격                                | 장치                       | 예                                                |
| ------------------------------------------ | -------------------------- | ------------------------------------------------- |
| 이미 저장소 도구가 강제한다                | **아무것도 만들지 않는다** | 포맷 → prettier, unused import → `noUnusedLocals` |
| Claude Code에 이미 있다                    | **built-in을 쓴다**        | 코드 리뷰 → `/code-review`                        |
| 거의 모든 세션에 필요한 짧고 안정적인 사실 | `AGENTS.md`                | 프로젝트 이름과 역할, 검사 대상과의 경계          |
| 특정 경로에서만 참인 불변식                | `.claude/rules/*.md`       | 계약은 zod에서만, UI는 status를 재계산하지 않음   |
| 모델 판단과 무관하게 **막아야** 하는 것    | permission (settings)      | `.env` 읽기, force push                           |
| permission 문법으로 표현되지 않는 판단     | `.claude/hooks/*.mjs`      | 명령 문자열 전체를 봐야 하는 것                   |
| 여러 저장소가 같은 규칙으로 쓰는 개발 도구 | 공용 plugin                | `berry-commit@berrypjh` (commit skill + MCP)      |

`AGENTS.md`와 rule은 **context이지 강제 장치가 아니다.** 반드시 막아야 하는 것은 permission으로 처리한다.

## Directory map

```
.claude/
  settings.json          permissions · hook 등록 · plugin (committed)
  settings.local.json    이 머신 전용 — sandbox · 개인 allow (git 제외)
  rules/
    docs.md              docs/ 문체
    web.md               apps/web
    contracts.md         libs/visual-contracts
    tools.md             tools/ · fixtures/visual
    e2e.md               apps/web-e2e
  skills/
    repo-verify/         변경 → 영향 범위 → 검증 사다리
  hooks/
    guard-bash.mjs       PreToolUse · Bash
tools/hooks/
  guard-bash.test.mjs    hook 테스트 (pnpm test:hooks)
```

rule은 `paths:` frontmatter의 경로 파일을 열 때만 읽힌다.

**하위 `AGENTS.md` · `CLAUDE.md`를 두지 않는다.** 프로젝트 규칙은 경로 rule에, 사람용 설명은 root `docs/`에 둔다 — snapdone과 같은 구조다. shared-stack은 패키지마다 `AGENTS.md`를 두지만 그것은 패키지가 따로 배포될 때의 방식이다. Next 16.3이 `apps/web/AGENTS.md`를 자동 생성하는 것은 `next.config.js`의 `agentRules: false`로 껐다 ([기록](../docs/records/2026-09-24-rules-not-per-project-agents.md)).

## Skill

| skill                        | 출처                       | 언제                              | 누가 호출               |
| ---------------------------- | -------------------------- | --------------------------------- | ----------------------- |
| `/berry-commit:commit-scope` | 공용 plugin `berry-commit` | staged 변경을 scope별로 커밋할 때 | **사용자만**            |
| `repo-verify`                | 이 저장소                  | 코드를 바꾸고 완료를 보고하기 전  | Claude 자동 또는 사용자 |

커밋은 사용자가 시작해야 하는 일이다. plugin의 `commit_scope` tool은 **명시적 승인 뒤에만** 호출하고, git commit은 permission `ask`가 한 번 더 지킨다.

`repo-verify`는 자동 호출을 허용한다. "검증 없이 완료를 선언하지 않는다"가 Claude가 스스로 지켜야 하는 규칙이라, 사용자가 매번 타이핑해야 한다면 의미가 없기 때문이다. affected 매핑과 target 표는 이 저장소에서 실측한 값이고, 프로젝트가 늘면 함께 고친다.

**rule과 겹치지 않게 한다.** rule은 _무엇이 옳은가_(불변식), skill은 _어떻게 확인하는가_(절차)다. 같은 문장을 양쪽에 적지 않는다.

**의도적으로 만들지 않은 것 둘.**

- `frontend-quality` — snapdone의 것은 `@berrypjh` UI kit 조회 CLI와 `ko-ui` 규칙을 전제한다. 이 저장소는 shadcn과 영어 UI라 맞지 않고, 화면이 둘뿐이라 검수 절차보다 `.claude/rules/web.md`의 불변식으로 충분하다. 화면이 늘어 같은 검수를 반복하게 되면 그때 만든다
- `berry-dev` plugin 채택 — shared-stack은 공통 원칙(`core.md`)과 skill을 plugin으로 빼고 `harness.profile.md`에 저장소 사실만 둔다. 소비 저장소는 shared-stack checkout 경로를 가리키는 `harness:sync`로 rule을 생성하는데, 이 저장소는 검사 대상(shared-stack)과의 결합을 데이터로만 두기로 했다([target-architecture.md](../docs/architecture/target-architecture.md#경계)). 공통 원칙은 `AGENTS.md`에 직접 적었다(snapdone과 같은 방식). plugin이 marketplace로 배포되어 checkout 경로 없이 켤 수 있게 되면 다시 판단한다

## Subagent

**커스텀 subagent를 만들지 않았다.** 내장으로 충분하다 — 탐색은 `Explore`, 계획은 plan mode, 격리된 복합 작업은 `general-purpose`, 리뷰는 `/code-review` · `/security-review`.

`Explore`와 `Plan`만 `AGENTS.md`와 rule을 건너뛴다. 코드를 쓰는 위임에는 `general-purpose`를 쓰면 컨벤션이 함께 간다. 제품 소스는 `apps/web/src` · `tools/visual` · `libs/visual-contracts/src`를 합쳐 2,000줄이 안 된다(2026-09-24) — 한 번의 리뷰가 컨텍스트를 밀어낼 양이 아니다.

## Permissions

`.claude/settings.json`의 `permissions`. **`allow` 규칙은 두지 않았다.** `defaultMode`가 `auto`라 안전한 일상 명령은 분류기가 이미 통과시킨다.

| 종류     | 대상                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| **deny** | 실제 secret 파일 읽기 (`.env` · `.env.local` · `.env.*.local` · 서명 키류)             |
| **deny** | force push, 스토어 제출(`nx submit` · `eas submit`)                                    |
| **ask**  | commit · push · merge · rebase · tag · branch 삭제                                     |
| **ask**  | 작업 내용을 지우는 것 (`reset --hard` · `clean` · `checkout --` · `restore` · `stash`) |
| **ask**  | 릴리스 · publish (`pnpm release:npm` · `nx release` · `npm publish`)                   |
| **ask**  | 의존성 설치 · 제거 · 갱신, Nx 플러그인 추가, `nx migrate`                              |

`.env.example`은 막지 않는다. 이 저장소에는 아직 `.env` 파일 자체가 없다 — `REVIEW_DATA_DIR` 하나뿐이고 secret이 아니다.

스토어 제출 · EAS 항목은 이 저장소에 mobile이 없어 실제로 걸릴 일이 없지만, 다른 저장소와 같은 설정을 유지한다.

### 이 방어가 막지 못하는 것

| 층                             | 성격                        | 한계                                          |
| ------------------------------ | --------------------------- | --------------------------------------------- |
| `AGENTS.md` · `.claude/rules/` | **지시일 뿐 강제가 아니다** | Claude가 따르려 하지만 보장은 없다            |
| **permissions**                | tool 단위 guard             | Claude Code가 인식하는 tool 호출에만 적용된다 |
| **hook**                       | event 단위 guard            | 명령 문자열을 보는 것이라 우회 가능하다       |
| **sandbox**                    | OS 수준 프로세스 격리       | `settings.local.json`에 있어 머신마다 다르다  |

Read deny는 내장 파일 도구와 `cat` · `head` · `tail` · `sed`에만 적용된다. `node -e "readFileSync('.env')"`는 permission 층을 지나가고, **`guard-bash.mjs`가 이 경로를 덮는다.** 모든 프로세스를 막는 것은 sandbox의 일이다.

## Hook

`.claude/hooks/guard-bash.mjs` 하나뿐이다. `PreToolUse` · matcher `Bash`. 규칙은 전부 이 파일 안에 있고 plugin에 기대지 않는다.

| 막는 것                                                                                       | permission으로 안 되는 이유                                          |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| dev 서버 · `next dev/start` · `pnpm e2e` · `playwright test` · `nx build web` · `http-server` | 영구 금지가 아니라 **샌드박스에서만** 불가. "사용자에게 요청"이 정답 |
| secret 경로 + 리다이렉트 / `node -e` / `grep` / `base64` 등                                   | Read deny는 `cat` · `head` · `tail` · `sed`만 인식한다               |

두 번째 항목은 **두 조건이 함께 있을 때만** 막는다. `cat .env.example` · `echo x > /tmp/out` · 검색어 안의 `pnpm dev`는 통과한다.

**샌드박스를 끈 머신에 대해.** hook은 committed 정책이고 sandbox는 `settings.local.json`(git 제외)의 로컬 설정이다. `sandbox.enabled: false`인 머신에서는 dev 서버 · e2e가 세션 안에서 실제로 돌지만 hook은 그래도 막는다. 그 머신에서 세션 안 실행을 허용하려면 `PORT_BOUND`를 비우되, 다른 저장소(snapdone · shared-stack)와 정책이 갈린다는 것을 알고 한다.

**실패하면 통과시킨다.** 훅이 깨져서 모든 Bash가 막히는 쪽이 더 나쁘다. 그래서 이것은 보조 장치이지 마지막 방어선이 아니다. 실제로 이 저장소의 첫 hook은 없는 모듈을 import해 조용히 무력화된 채로 있었다 ([기록](../docs/records/2026-09-24-guard-bash-self-contained.md)).

### 테스트

```bash
pnpm test:hooks    # node --test tools/hooks/*.test.mjs
```

`tools/hooks/guard-bash.test.mjs`가 훅을 **실제로 실행해서** stdin/stdout 계약과 종료 코드까지 확인한다. 정규식만 검사하면 import가 깨져도 통과하는데, 그러면 훅이 조용히 무력해진다.

`PORT_BOUND` · `BYPASS`를 고칠 때는 테스트를 함께 고친다. `.claude/`는 Nx 프로젝트가 아니라 `nx test`가 잡지 못하므로 `test:hooks`를 따로 부른다.

## 신뢰 표면

`.claude/hooks/` · `.claude/settings.json` · `.github/workflows/`는 **아무도 실행을 지시하지 않아도 돈다.** 이 파일들을 건드리는 변경은 일반 코드와 다르게 리뷰한다.

- hook — 어떤 명령을 막고 통과시키는지 diff에서 읽는다. 테스트가 같이 바뀌었는지 본다
- settings — `deny`가 줄어들거나 `ask`가 빠지면 이유를 요구한다
- workflow — 새 secret · 새 `uses:` · checkout token 변경은 [pr-integration.md](../docs/integration/pr-integration.md)와 대조한다

**clone한 저장소의 내용 자체가 신뢰 대상이 아닐 수 있다.** hook · plugin 선언은 git에서 오고, 일부는 신뢰 다이얼로그를 수락하기 전에도 적용된다.

## 로컬 전용 설정

`settings.local.json`은 git에 들어가지 않는다. sandbox · 개인 allow 규칙 · `defaultMode`가 여기 있다. 이 문서는 committed 설정만 다룬다.

## Memory

architecture · convention · 명령은 `AGENTS.md` · `.claude/rules/` · `docs/`에 커밋한다. auto memory에는 이 머신에서 반복되는 사실만 둔다. secret과 credential은 어디에도 저장하지 않는다.
