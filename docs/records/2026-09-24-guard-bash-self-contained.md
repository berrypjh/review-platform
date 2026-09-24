# `guard-bash.mjs`를 자체 완결형으로 교체

`.claude/hooks/guard-bash.mjs`가 없는 모듈을 import해 import 단계에서 죽고 있었음. snapdone의 hook과 같은 자체 완결형으로 교체하고 `pnpm test:hooks`로 실제 실행을 검사.

## 상황

- 이 저장소의 hook은 shared-stack의 것을 복사한 상태. `../../plugins/berry-dev/scripts/secret-policy.mjs`를 import하지만 review-platform에 `plugins/`가 없음
- `echo '{"tool_input":{"command":"cat .env"}}' | node .claude/hooks/guard-bash.mjs` → `ERR_MODULE_NOT_FOUND`, exit 1
- Claude Code는 hook 오류(exit 1)를 통과로 처리. 결과적으로 secret 우회 차단과 포트 바인딩 안내가 처음부터 동작하지 않았음. `main().catch`는 import 오류를 잡지 못함
- 이 머신의 `settings.local.json`(git 제외)은 `sandbox.enabled: false`라 세션 안에서 dev 서버 · e2e가 실제로 돌았음

## 판단

- **자체 완결형** — snapdone의 `PORT_BOUND` · `BYPASS` · secret basename 규칙을 이 저장소 안에 둠. plugin 활성 여부에 기대지 않음
- **PORT_BOUND는 이 저장소의 명령으로** — `pnpm dev` · `nx dev web` · `next dev` · `next start` · `pnpm e2e` · `nx e2e` · `playwright test` · `nx build web` · `http-server`
- **샌드박스를 끈 머신에서도 막음** — hook은 committed 정책이고 sandbox 설정은 로컬. 두 저장소와 같은 관례를 유지. 그 머신에서 세션 안 실행이 필요하면 `PORT_BOUND`를 비우는 것은 로컬 판단
- **실패하면 통과** — hook이 깨져 모든 Bash가 막히는 쪽이 더 나쁨. 대신 `test:hooks`가 hook을 실제로 실행해 깨짐을 잡음

## 반영

- `.claude/hooks/guard-bash.mjs` — import 제거, 규칙 내장
- `tools/hooks/guard-bash.test.mjs` — 차단 · 허용 · 응답 형식 검사
- `package.json` — `test:hooks`

## 검증

- `pnpm test:hooks` 통과. 차단 명령은 `permissionDecision: deny`와 사유, 허용 명령은 빈 stdout
- `cat .env.example` · `pnpm tools:check` · 검색어 안의 `pnpm dev` 문자열은 통과
