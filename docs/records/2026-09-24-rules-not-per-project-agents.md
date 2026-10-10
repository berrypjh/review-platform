# 프로젝트 규칙은 하위 `AGENTS.md`가 아니라 `.claude/rules/`에

루트 `AGENTS.md` 하나, 경로별 rule(`.claude/rules/*.md`), 사람용 문서는 root `docs/`. `apps/` · `libs/` 아래에 `AGENTS.md` · `CLAUDE.md` · `README.md`를 두지 않음. Next의 `AGENTS.md` 자동 생성은 `agentRules: false`로 끔.

## 상황

- 이 저장소는 배포되는 패키지가 없는 한 제품(Nx 프로젝트 3개)
- Next 16.3은 `next dev`가 AI 에이전트를 감지하면 `apps/web/AGENTS.md` · `CLAUDE.md`를 생성함

## 판단

- **문서는 root 한 곳** — 프로젝트별 문서를 두지 않음
- **경로 rule이 프로젝트 문서 역할** — 해당 경로 파일을 열 때만 읽힘
- **`agentRules: false`** — 자동 생성된 `apps/web/AGENTS.md`가 구조를 깨지 않게 함
- **`tools/visual/README.md`는 둠** — Nx 프로젝트가 아닌 도구의 사용법
- **skill은 `repo-verify` 하나**

## 반영

- `.claude/rules/` — `docs.md` · `web.md` · `contracts.md` · `tools.md` · `e2e.md`
- `.claude/skills/repo-verify/SKILL.md`
- `apps/web/next.config.js` — `agentRules: false`
- 삭제 — `apps/web/{AGENTS,CLAUDE,README}.md` · `apps/web-e2e/{AGENTS,CLAUDE}.md` · `libs/visual-contracts/{AGENTS,CLAUDE}.md` · `fixtures/visual/README.md`

## 검증

- build에서 `agentRules` 키 경고 없음
- 삭제한 파일을 가리키는 문서 링크 없음
