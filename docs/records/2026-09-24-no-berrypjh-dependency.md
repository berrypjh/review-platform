# 검사 도구는 검사 대상이 publish하는 패키지에 의존하지 않음

review-platform은 `@berrypjh/*`(shared-stack이 publish하는 패키지)를 쓰지 않음. 설정값은 이 저장소에 직접 둠.

## 상황

- `@berrypjh/prettier-config` · `@berrypjh/tsconfig`를 쓰고 있었고, `.npmrc`가 GitHub Packages를 가리킴
- `@berrypjh/eslint-config` 1.1.2의 peer `@nx/eslint-plugin ^22.6.5`가 Nx 23.2.1과 맞지 않음
- review-platform은 shared-stack의 변경을 검사하는 도구

## 판단

- **검사하는 쪽이 검사받는 쪽에 의존하지 않음** — 검사 대상의 결함이 도구를 깨뜨리지 않게 함
- **설정 패키지도 제외** — 하나라도 남기면 `.npmrc` · 토큰 · registry 접근이 필요
- **shared-stack과의 연결은 데이터뿐** — Storybook URL과 story id

## 반영

- `tsconfig.base.json` — `extends` 없이 설정값 직접 기재
- `.prettierrc.json` — 옵션과 md · yaml override
- `package.json` — `@berrypjh/*` devDependency와 `prettier` 필드 삭제
- `.npmrc` · `.prettierrc` 삭제

## 검증

- tsconfig 5종의 `tsc --showConfig` 결과가 전후 동일
- `prettier.resolveConfig` 결과가 전후 동일, `format:check` 통과
- `node_modules` · lockfile에 `@berrypjh` 없음
