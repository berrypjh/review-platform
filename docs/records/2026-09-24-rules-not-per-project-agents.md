# 프로젝트 규칙은 하위 `AGENTS.md`가 아니라 `.claude/rules/`에

snapdone과 같은 구조로 확정. 루트 `AGENTS.md` 하나와 경로별 rule(`.claude/rules/*.md`), 사람용 문서는 root `docs/`. `apps/` · `libs/` 아래에 `AGENTS.md` · `CLAUDE.md` · `README.md`를 두지 않음. Next 16.3의 `AGENTS.md` 자동 생성은 `agentRules: false`로 끔.

## 상황

- shared-stack은 패키지마다 `AGENTS.md`(maintainer 규칙)와 `README.md`(consumer 사용법)를 둠. 패키지가 따로 배포되고 소비자가 다르기 때문
- snapdone은 하위 `AGENTS.md`를 두지 않음. 규칙은 `.claude/rules/<경로>.md`, 설명은 root `docs/`. devhub 카탈로그와 어긋날 위험을 피하려는 선택
- review-platform은 프로젝트가 셋인 한 제품. 배포되는 패키지가 없고 소비자는 이 저장소뿐
- Next 16.3.6은 `next dev`가 AI 에이전트를 감지하면 `apps/web/AGENTS.md` · `CLAUDE.md`를 만들어 넣음. snapdone(Next 16.1)에는 이 동작이 없음

## 판단

- **snapdone 구조** — 한 제품이라 문서를 한 곳(root)에서 관리하는 쪽이 어긋남이 적음. shared-stack 방식은 패키지 단위 배포가 있을 때의 것
- **경로 rule이 프로젝트 문서 역할** — `web.md` · `contracts.md` · `tools.md` · `e2e.md`. shared-stack `AGENTS.md`의 파일 구성 · 작업별 수정 위치 · 함정도 rule에 담음. 해당 경로 파일을 열 때만 읽히므로 세션마다 전부 읽히지 않음
- **`agentRules: false`** — Next의 자동 생성이 켜져 있으면 `apps/web/AGENTS.md`가 다시 생겨 구조가 깨짐. 번들 문서(`node_modules/next/dist/docs/`)를 먼저 읽으라는 안내는 `rules/web.md`에 한 줄로 유지
- **`tools/visual/README.md`는 둠** — Nx 프로젝트가 아닌 도구의 사용법. snapdone의 `tools/evals/README.md`와 같은 자리
- **skill은 `repo-verify` 하나** — snapdone과 같이 로컬 skill. `frontend-quality`는 `@berrypjh` UI kit 조회를 전제해 맞지 않음. berry-dev plugin은 shared-stack checkout 경로에 묶여 채택하지 않음

## 반영

- `.claude/rules/` — `docs.md` · `web.md` · `contracts.md` · `tools.md` · `e2e.md`
- `.claude/skills/repo-verify/SKILL.md` — 실측한 affected 매핑 · target 표 · 검증 사다리
- `apps/web/next.config.js` — `agentRules: false`
- 삭제 — `apps/web/{AGENTS,CLAUDE,README}.md` · `apps/web-e2e/{AGENTS,CLAUDE}.md` · `libs/visual-contracts/{AGENTS,CLAUDE}.md` · `fixtures/visual/README.md`
- `AGENTS.md` · `.claude/README.md` — 구조 설명을 이 결정에 맞춤

## 검증

- `pnpm build`에서 `agentRules` 키 경고 없음. `next dev`로 파일이 다시 생기지 않는 것은 사용자 터미널에서 확인할 것 — AI 세션은 dev 서버를 띄우지 못함
- 문서 링크 무결성 검사에서 삭제한 파일을 가리키는 링크 0
- format:check · lint 통과
