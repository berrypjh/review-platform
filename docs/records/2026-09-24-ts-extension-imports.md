# contracts의 상대 import를 `.ts` 확장자로 변경

`libs/visual-contracts`의 상대 import는 `./lib/*.ts`이고 `allowImportingTsExtensions`가 켜져 있음. web(Turbopack)과 tools(`tsx`)가 lib source를 그대로 읽음.

## 상황

- Nx generator가 만든 `./lib/primitives.js` import를 `next build`가 `Module not found`로 해석하지 못함. Turbopack은 `.js` → `.ts` 확장자 매핑을 하지 않음
- `tsx`도 같은 import에서 `ERR_MODULE_NOT_FOUND`

## 판단

- **소비자(web · tools)가 모두 source를 직접 읽음** — build 산출물이 없는 private lib이므로 `.ts`가 실제 파일 이름
- **`allowImportingTsExtensions`** — 이 저장소의 tsconfig는 emit하지 않으므로 제약 없음
- **lib을 build하지 않음** — 소비자마다 build 순서가 생기는 것을 피함

## 반영

- `libs/visual-contracts/src/**` — 상대 import 확장자 `.ts`
- `libs/visual-contracts/tsconfig.lib.json` · `tsconfig.spec.json`, `apps/web/tsconfig.json`, `tools/tsconfig.json` — `allowImportingTsExtensions: true`

## 검증

- contracts lint · typecheck · test, `nx build web`, `pnpm tools:check` 통과
- `nx sync:check` 정상
