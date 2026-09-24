# 검사 도구는 검사 대상이 publish하는 패키지에 의존하지 않음

review-platform이 `@berrypjh/*`(shared-stack이 publish하는 설정 · UI 패키지)를 하나도 쓰지 않도록 정리. 설정값은 이 저장소로 옮겼고 적용 결과는 전후로 같음.

## 상황

- bootstrap 때 `@berrypjh/prettier-config` · `@berrypjh/tsconfig`를 받아 썼고, `.npmrc`가 GitHub Packages를 가리킴
- `@berrypjh/eslint-config` 1.1.2는 peer가 `@nx/eslint-plugin ^22.6.5`라 Nx 23.2.1과 맞지 않아 처음부터 쓰지 못함. shared-stack 자신은 `workspace:^`라 드러나지 않고, snapdone은 unmet peer 상태로 동작 중
- review-platform의 역할은 shared-stack의 UI가 깨졌는지 잡는 것. 검사 도구가 검사 대상의 패키지에 기대는 구조

## 판단

- **검사하는 쪽이 검사받는 쪽에 기대지 않음** — 검사 대상의 결함이 도구까지 깨뜨리고, 패키지 업그레이드가 "검사 대상 변경"인지 "도구 변경"인지 구분되지 않음
- **설정 패키지도 뺌** — 버전을 고정하면 무해하지만, 하나라도 남기면 `.npmrc` · 토큰 · registry 접근이 따라옴. 값을 옮기는 비용이 더 작음
- **shared-stack과의 연결은 데이터뿐** — Storybook URL과 story id. 코드 · 패키지 · symlink 없음
- **peer 문제는 shared-stack에서 고칠 것** — `^22.6.5 || ^23.0.0`으로 넓혀 patch release. lockfile 갱신 없이는 CI의 `--frozen-lockfile`이 실패함(scratch clone에서 확인)

## 반영

- `tsconfig.base.json` — `extends` 없이 base 설정값을 직접 기재
- `.prettierrc.json` — 같은 옵션과 md · yaml override
- `package.json` — 두 devDependency와 `prettier` 필드 삭제
- `.npmrc` 삭제
- generator가 남긴 `.prettierrc`(`singleQuote`만) 삭제 — `prettier` 필드가 있는 동안 가려져 있던 것

## 검증

- tsconfig 5종(root · web · web-e2e · contracts lib · tools)의 `tsc --showConfig` 결과가 전후 동일
- `prettier.resolveConfig` 결과가 전후 동일, `format:check` 변경 없이 통과
- `node_modules` · lockfile에 `@berrypjh` 없음. 전체 lint · typecheck · test · build · e2e 통과
