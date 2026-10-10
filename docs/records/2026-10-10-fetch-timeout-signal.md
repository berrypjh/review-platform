# GitHub 호출 timeout을 Request가 아닌 fetch init signal로 전달

`fetch(new Request(url, { signal }))`는 GC 뒤 timeout이 오지 않아 끝없이 기다릴 수 있음. 전송 계층을 `(url, init) => fetch(url, init)`로 바꿔 원본 `AbortSignal.timeout`을 그대로 넘김.

## 상황

- **증상** — timeout을 기대한 단위 테스트가 5초 vitest 제한까지 끝나지 않음
- **당시 구조** — `githubRequest`가 `new Request(target, { signal: AbortSignal.timeout(ms) })`를 만들어 `transport(request)` → 런타임은 `fetch(request)`
- **영향** — webhook은 GitHub 10초 제한 안에 응답해야 함. 응답 없는 GitHub 호출이 timeout 없이 걸리면 제한을 넘김

## 판단

- **재현(Node 24.20, `--expose-gc`)** — 원본 `AbortSignal.timeout`을 직접 들으면 GC 뒤에도 abort 발화. `new Request(..., { signal })`의 `request.signal`은 GC 뒤 발화하지 않음. `AbortController` + 명시적 timer여도 같음
- **실제 fetch** — 응답하지 않는 로컬 TCP 서버에 GC를 강제한 비교. `fetch(new Request(url, { signal }))`는 2초 넘게 대기, `fetch(url, { signal })`는 150ms에 `TimeoutError`
- **원인** — Request가 만드는 파생 signal과 부모 signal의 연결이 GC에 살아남지 못함. 원본 signal을 변수로 붙잡아도 해결되지 않음
- **선택** — 우회 timer를 덧대지 않고 파생 signal을 만들지 않는 호출 형태로 바꿈

## 반영

- `apps/web/src/lib/github/http.ts` — `Transport = (url, init) => Promise<Response>`. 요청마다 `AbortSignal.timeout(남은 deadline)`을 `init.signal`로
- `apps/web/src/lib/auth/oauth.ts` — code 교환도 같은 형태
- `apps/web/src/lib/manual-approval/runtime.ts` — `(url, init) => fetch(url, init)`
- `apps/web/src/lib/github/fake-github.ts` — 테스트 가짜도 `init.signal`을 들음

## 검증

- 재현 스크립트 3개(원본 signal · Request 파생 · 실제 fetch)를 scratchpad에서 실행해 위 결과 확인. 저장소에는 넣지 않음 — vitest에서 GC를 강제할 수 없음
- `http.test.ts`의 timeout 테스트, `webhook.db-test.ts`의 "times out inside the webhook budget"(1.5초 deadline, 5초 안에 503) 통과
- Vercel 런타임에서의 동작은 확인하지 못함
