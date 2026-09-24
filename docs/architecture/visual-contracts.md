# Visual Contracts

`libs/visual-contracts`는 capture · compare가 쓰고 Review UI가 읽는 JSON의 유일한 계약이다. zod schema가 type의 단일 출처이고(`z.infer`), 손으로 쓴 중복 type은 없다. 의존은 `zod` 하나이며 Node · DOM · React 타입은 `tsconfig.lib.json`(`types: []`, `lib: es2022`)이 막는다.

## 원칙

- **측정하지 못한 값은 0이 아니다.** `null` + 이유(`error`)로 남긴다
- **상태의 의미를 섞지 않는다.** `unchanged` · `changed` · `error`의 불변식은 discriminated union 구조에 들어 있어 어긋난 값을 만들 수 없다
- **run status는 `deriveRunStatus` 한 곳에서 계산한다.** schema가 `status`와 계산값의 일치를 다시 검사한다
- **경로는 run 디렉터리 기준 상대 경로만.** 절대 경로 · 드라이브 문자 · 백슬래시 · `.` · `..` segment를 거부한다
- **모든 object는 `strictObject`다.** 정의되지 않은 key가 있으면 거부한다

## 파일

```
src/
  index.ts                 public exports
  lib/primitives.ts        SafeId · GitSha · IsoDateTime · Viewport · RelativeTargetPath · ArtifactPath
  lib/target-manifest.ts   VisualTargetManifest (capture · compare 입력)
  lib/visual-run.ts        VisualRun · VisualChange · deriveRunStatus (compare 출력)
```

## Primitives

| schema                     | 규칙                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SafeIdSchema`             | `a-z` · `0-9` · `-`, 1–100자, `-`로 시작 · 끝나지 않음. run id와 target id — 디렉터리 · 파일 이름이 된다        |
| `GitShaSchema`             | 소문자 hex 7–64자. 대문자는 소문자로 바꾸지 않고 거부                                                           |
| `IsoDateTimeSchema`        | `z.iso.datetime()` — 끝이 `Z`인 UTC. offset · 날짜만 있는 값 거부                                               |
| `ViewportSchema`           | `width` · `height` 양의 정수                                                                                    |
| `RelativeTargetPathSchema` | Storybook base URL 뒤에 붙는 상대 URL. scheme · 맨 앞 `/` · 공백 · 백슬래시 · 제어 문자 · `.`/`..` segment 거부 |
| `ArtifactPathSchema`       | `/`로 구분된 상대 경로, `.png`로 끝남. `.`/`..` segment 거부                                                    |

## VisualTargetManifest

```json
{
  "schemaVersion": 1,
  "repository": "berrypjh/shared-stack",
  "viewport": { "width": 1280, "height": 720 },
  "targets": [
    {
      "id": "components-buttons-button--default",
      "label": "Button / Default",
      "path": "iframe.html?id=components-buttons-button--default&viewMode=story"
    }
  ]
}
```

- `targets`는 1개 이상, `id`는 중복 불가
- viewport는 run 전체에 한 벌. mobile viewport matrix는 없다
- story id는 build된 `storybook-static/index.json`에서 읽는다. 추측하지 않는다

## VisualChange

`status`를 기준으로 한 discriminated union이다.

| status      | 뜻                       | `baselinePath` · `currentPath` | `diffPath` | `mismatchPixels` · `mismatchRatio` | `error`        |
| ----------- | ------------------------ | ------------------------------ | ---------- | ---------------------------------- | -------------- |
| `unchanged` | 두 이미지가 완전히 같음  | 필수                           | null 허용  | `0` · `0`                          | `null`         |
| `changed`   | 다름. diff 이미지가 있음 | 필수                           | 필수       | 양의 정수 · `0 < r ≤ 1`            | `null`         |
| `error`     | capture 또는 비교가 실패 | null 허용                      | `null`     | `null` · `null`                    | 비어 있지 않음 |

`mismatchRatio = mismatchPixels / (width × height)`.

## VisualRun

```json
{
  "schemaVersion": 1,
  "id": "pr-12",
  "repository": "berrypjh/shared-stack",
  "baseSha": "7888724e59b35e45880c736f03b4ecf3215f8e78",
  "headSha": "1b23f79",
  "createdAt": "2026-09-24T13:04:00.000Z",
  "browser": "chromium",
  "viewport": { "width": 1280, "height": 720 },
  "status": "review-required",
  "changes": []
}
```

- `changes`는 1개 이상, `id`는 중복 불가. **change가 없는 run은 존재하지 않는다** — 결과가 없는데 passed로 읽히면 안 된다
- `status`는 `deriveRunStatus(changes)`와 같아야 한다. 다르면 schema가 거부한다
- `browser`는 `chromium`뿐이다

### `deriveRunStatus`

| 조건                           | status            |
| ------------------------------ | ----------------- |
| `error`가 하나라도 있음        | `failed`          |
| 없고 `changed`가 하나라도 있음 | `review-required` |
| 전부 `unchanged`               | `passed`          |

빈 배열은 예외를 던진다. schema의 refine은 zod 4가 `min(1)` 실패 뒤에도 refine을 실행하므로 빈 배열을 먼저 걸러 이 예외가 `safeParse` 안에서 새지 않게 한다.

## 검증

```bash
pnpm nx test visual-contracts       # Vitest 64개 — fixture manifest · 세 status의 불변식 · status 계산 · SHA · ISO · 경로 거부
pnpm nx typecheck visual-contracts
pnpm nx lint visual-contracts
```

spec의 fixture는 `satisfies VisualChange`로 적어 fixture 자체가 계약과 맞는지 컴파일 시점에 검사된다.
