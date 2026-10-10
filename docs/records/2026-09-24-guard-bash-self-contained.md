# `guard-bash.mjs`를 자체 완결형으로 교체

`.claude/hooks/guard-bash.mjs`가 저장소에 없는 모듈을 import해 실행되지 않았음. 규칙을 파일 안에 두고 `pnpm test:hooks`로 실제 실행을 검사.

## 상황

- hook이 `../../plugins/berry-dev/scripts/secret-policy.mjs`를 import했지만 이 저장소에 `plugins/`가 없음 → `ERR_MODULE_NOT_FOUND`, exit 1
- Claude Code는 hook 오류(exit 1)를 통과로 처리 → secret 차단 · 포트 바인딩 차단이 동작하지 않았음

## 판단

- **자체 완결형** — `PORT_BOUND` · `BYPASS` · secret basename 규칙을 hook 안에 둠
- **PORT_BOUND** — `pnpm dev` · `nx dev web` · `next dev` · `next start` · `pnpm e2e` · `nx e2e` · `playwright test` · `nx build web` · `http-server`
- **sandbox 설정과 무관하게 막음** — hook은 committed 정책
- **hook 자체가 실패하면 통과** — 대신 `test:hooks`가 hook을 실제로 실행해 깨짐을 잡음

## 반영

- `.claude/hooks/guard-bash.mjs` — import 제거, 규칙 내장
- `tools/hooks/guard-bash.test.mjs` — 차단 · 허용 · 응답 형식
- `package.json` — `test:hooks`

## 검증

- `pnpm test:hooks` 통과. 차단 명령은 `permissionDecision: deny`와 사유, 허용 명령은 빈 stdout
