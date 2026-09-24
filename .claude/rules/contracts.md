---
paths:
  - 'libs/visual-contracts/**'
---

# visual-contracts (`libs/visual-contracts`)

capture · compare(`tools/visual`)가 쓰고 web이 읽는 JSON의 **유일한 계약**. 비공개이고 릴리스 대상이 아니다. 설계와 각 schema의 뜻은 [visual-contracts.md](../../docs/architecture/visual-contracts.md).

## 원칙

- **schema가 type의 단일 출처다.** type은 `z.infer`로만 얻는다. 손으로 쓴 type을 두지 않는다. `VisualChangeStatus`도 `VisualChange['status']`에서 얻는다
- **의존은 `zod` 하나.** React · Node · DOM을 import하지 않는다. `tsconfig.lib.json`(`types: []`, `lib: es2022`)이 막는다. Buffer · URL · PathLike를 계약에 넣지 않는다
- **없는 값은 `null` + 이유.** 0 · pass로 바꾸는 기본값을 넣지 않는다
- **status별 불변식은 union 구조에.** refine으로 뒤늦게 검사하지 않고 `discriminatedUnion`의 각 branch가 값의 모양을 정한다
- **모든 object는 `strictObject`.** 모르는 key를 조용히 통과시키지 않는다
- **run status는 `deriveRunStatus` 하나.** 소비자가 같은 로직을 다시 쓰지 않는다
- **경로는 run 디렉터리 기준 상대 경로만.** 절대 경로 · 드라이브 · 백슬래시 · `.` · `..`을 거부한다

## 모양

- 빌드 없는 소스 패키지다. `exports`가 `./src/index.ts`를 가리키고 소비자는 `workspace:*`로 의존한다
- 상대 import는 **`.ts` 확장자**다(`./lib/primitives.ts`). Turbopack · tsx가 `.js`를 `.ts`로 연결하지 못한다 ([기록](../../docs/records/2026-09-24-ts-extension-imports.md))
- `src/index.ts`가 public export 목록이다. 새 schema · type은 여기에 명시한다
- `*.spec.ts`는 `lib/`에 같은 폴더로 둔다

## 바꿀 때

- `schemaVersion`은 `literal(1)`이다. 호환되지 않는 변경이면 2로 올리고 web · tools의 읽기 경로를 함께 고친다. 아직 그런 변경은 없었다
- spec의 fixture는 `satisfies VisualChange`로 적는다. 계약을 바꾸면 fixture가 컴파일 오류로 알려 준다
- 거부해야 하는 값(경로 탈출 · 대문자 SHA · offset 시각 · 빈 `changes`)은 테스트에 **거부 케이스**로 남긴다
- `fixtures/visual/review-data/runs/sample/run.json`도 새 계약을 통과해야 한다. e2e가 그 파일을 읽는다
- **`nx affected`는 `tools/`를 모른다.** 계약을 바꿨으면 `pnpm tools:check`를 반드시 함께 돌린다. web · web-e2e는 affected가 끌어온다

## 함정

- **zod 4는 `min(1)`이 실패해도 object의 refine을 실행한다.** `VisualRunSchema`의 status refine이 `deriveRunStatus`(빈 배열에 던짐)를 부르므로 빈 `changes`를 먼저 거른다. 지우면 `safeParse`가 예외를 던진다 — 실험으로 확인했다
- generator가 만든 `vitest.config.mts`의 `globals: true`는 쓰지 않는다. spec은 `vitest`에서 명시적으로 import한다

## 검증

```bash
pnpm nx test visual-contracts
pnpm nx typecheck visual-contracts
pnpm nx lint visual-contracts
pnpm tools:check
```
