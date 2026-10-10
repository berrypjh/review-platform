# fixture 디렉터리를 Nx cache 입력에 추가

`nx.json`의 `sharedGlobals`에 `{workspaceRoot}/fixtures/visual/**/*`. fixture PNG · `run.json`을 바꾸면 test · e2e cache가 무효화됨.

## 상황

- web · web-e2e · contracts 테스트가 `fixtures/visual/`을 읽지만, 어느 프로젝트의 `{projectRoot}`에도 속하지 않아 cache 입력에서 빠져 있었음
- fixture diff PNG를 지워도 `nx e2e web-e2e`가 cache 결과(통과)를 재생함

## 판단

- **sharedGlobals 한 줄** — 모든 프로젝트의 `default` 입력이 `sharedGlobals`를 포함
- **fixture는 workspace 공유 입력** — 여러 프로젝트가 같은 fixture를 읽으므로 프로젝트 안으로 옮기지 않음

## 반영

- `nx.json` — `"sharedGlobals": ["{workspaceRoot}/fixtures/visual/**/*"]`

## 검증

- diff PNG를 지우면 cache가 무효화되고 해당 테스트가 실패. 되돌리면 통과
