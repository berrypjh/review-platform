# GitHub 호출 timeout을 Request가 아닌 fetch init signal로 전달

`fetch(new Request(url, { signal }))`는 GC 뒤 timeout이 발화하지 않음. 전송 계층은 `(url, init) => fetch(url, init)`이고 `AbortSignal.timeout`을 `init.signal`로 넘김.

## 상황

- `githubRequest`가 `new Request(target, { signal: AbortSignal.timeout(ms) })`를 만들어 `fetch(request)`로 호출
- timeout을 기대한 단위 테스트가 끝나지 않음
- webhook은 GitHub 10초 제한 안에 응답해야 함

## 판단

- **재현(Node 24.20, `--expose-gc`)** — `request.signal`(파생 signal)은 GC 뒤 abort가 발화하지 않음. 원본 `AbortSignal.timeout`은 발화
- **실제 fetch** — 응답 없는 로컬 TCP 서버에 대해 `fetch(new Request(url, { signal }))`는 2초 넘게 대기, `fetch(url, { signal })`는 150ms에 `TimeoutError`
- **선택** — 파생 signal을 만들지 않는 호출 형태

## 반영

- `apps/web/src/lib/github/http.ts` — `Transport = (url, init) => Promise<Response>`. 요청마다 `AbortSignal.timeout(남은 deadline)`을 `init.signal`로
- `apps/web/src/lib/manual-approval/runtime.ts` — `(url, init) => fetch(url, init)`
- `apps/web/src/lib/github/fake-github.ts` — 테스트 가짜도 `init.signal`을 들음

## 검증

- `http.test.ts`의 timeout 테스트, `webhook.db-test.ts`의 "times out inside the webhook budget"(1.5초 deadline, 5초 안에 503) 통과
