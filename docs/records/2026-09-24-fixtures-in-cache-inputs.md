# fixture 디렉터리를 Nx cache 입력에 추가

`nx.json`의 `sharedGlobals`에 `{workspaceRoot}/fixtures/visual/**/*` 추가. fixture PNG · `run.json`을 바꾸면 test · e2e cache가 무효화됨.

## 상황

- e2e와 contracts · web 테스트가 `fixtures/visual/`을 읽지만, 그 경로는 어느 프로젝트의 `{projectRoot}`도 아니라 cache 입력에 빠져 있었음
- release 전 검증에서 fixture diff PNG를 지워도 `nx e2e web-e2e`가 cache에서 "7 passed"를 재생함. 이전 단계의 음성 대조(fixture를 숨겼다 되돌림)가 같은 입력 hash로 기록되어 Nx가 "flaky task"로 표시

## 판단

- **sharedGlobals 한 줄** — 모든 프로젝트의 `default` 입력이 sharedGlobals를 포함하므로 한 곳만 고침
- **fixture는 workspace 공유 입력** — 프로젝트 안으로 옮기지 않음. web · web-e2e · contracts · 문서가 같은 fixture를 읽음

## 반영

- `nx.json` — `"sharedGlobals": ["{workspaceRoot}/fixtures/visual/**/*"]`

## 검증

- 수정 후 diff PNG를 지우면 cache 무효화 → 실제 실행 → 해당 테스트 실패(`Received: 0`). 되돌리면 통과
- 검증 순서: cache warm → fixture 제거 → 재실행 → 복원. 실제 실행 여부는 Nx 출력의 `[existing outputs match the cache]` 유무로 구분
