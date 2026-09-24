# contracts의 상대 import를 `.ts` 확장자로 변경

`libs/visual-contracts`의 `./lib/*.js` import를 `./lib/*.ts`로 바꾸고 `allowImportingTsExtensions`를 켬. web build(Turbopack)가 workspace 패키지의 source를 그대로 읽을 수 있게 됨.

## 상황

- Nx generator는 TS-solution 관례대로 `./lib/primitives.js`처럼 `.js`로 import를 생성. `tsc`는 이것을 `.ts`로 연결함
- web이 `@review-platform/visual-contracts`를 쓰기 시작하자 `next build`가 `Module not found: Can't resolve './lib/primitives.js'`로 실패
- Turbopack은 workspace 패키지를 자동 transpile하지만 `.js` → `.ts` 확장자 매핑은 하지 않음. `resolveExtensions`는 확장자 없는 import에만 해당하고, 이 매핑을 켜는 설정이 없음(번들된 Next 문서 확인)
- `tsx`도 같은 이유로 `.js` import를 따라가지 못해 `ERR_MODULE_NOT_FOUND`

## 판단

- **소비자 둘(web · tools)이 모두 source를 직접 읽음** — build 산출물이 없는 private lib이므로 `.ts`가 실제 파일 이름
- **`.ts` 확장자 import** — TS 5.0+의 `allowImportingTsExtensions`. `noEmit` · `emitDeclarationOnly`인 이 저장소에서는 제약이 없음
- **lib을 build해서 `.js`를 만들지 않음** — 소비자마다 build 순서가 생기고, private lib에 필요 없는 산출물

## 반영

- `libs/visual-contracts/src/**` — 상대 import 확장자 `.ts`
- `libs/visual-contracts/tsconfig.lib.json` · `tsconfig.spec.json`, `apps/web/tsconfig.json`, `tools/tsconfig.json` — `allowImportingTsExtensions: true`

## 검증

- contracts lint · typecheck · test 64개 통과, `nx build web` 통과, `pnpm tools:check` 통과
- `nx sync`로 web의 tsconfig에 contracts reference가 추가됨. `nx sync:check` 정상
