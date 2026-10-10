# Visual Contracts

`libs/visual-contracts`는 capture · compare가 쓰고 Review UI가 읽는 JSON의 계약. zod schema에서 `z.infer`로 type을 얻음. 의존은 `zod` 하나, `tsconfig.lib.json`이 `types: []` · `lib: es2022`(base)로 Node · DOM · React 타입을 막음.

## 원칙

- **측정하지 못한 값은 0이 아님** — `null` + 이유(`error`)
- **status별 불변식은 discriminated union 구조에 있음** — 어긋난 값은 parse 실패
- **run status는 `deriveRunStatus` 한 곳에서 계산** — schema가 `status`와 계산값의 일치를 검사
- **경로는 run 디렉터리 기준 상대 경로만** — 절대 경로 · 드라이브 문자 · 백슬래시 · `.` · `..` segment 거부
- **모든 object는 `strictObject`** — 정의되지 않은 key 거부

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
| `SafeIdSchema`             | `a-z` · `0-9` · `-`, 1–100자, `-`로 시작 · 끝나지 않음. run id와 target id                                      |
| `GitShaSchema`             | 소문자 hex 7–64자. 대문자 거부                                                                                  |
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

- `targets`는 1개 이상, `id` 중복 불가
- viewport는 run 전체에 한 벌
- story id는 build된 `storybook-static/index.json`의 값

## VisualChange

`status` 기준 discriminated union.

| status      | 뜻                       | `baselinePath` · `currentPath` | `diffPath` | `mismatchPixels` · `mismatchRatio` | `error`        |
| ----------- | ------------------------ | ------------------------------ | ---------- | ---------------------------------- | -------------- |
| `unchanged` | 두 이미지가 완전히 같음  | 필수                           | null 허용  | `0` · `0`                          | `null`         |
| `changed`   | 다름. diff 이미지가 있음 | 필수                           | 필수       | 양의 정수 · `0 < r ≤ 1`            | `null`         |
| `error`     | capture 또는 비교가 실패 | null 허용                      | null 허용  | `null` · `null`                    | 비어 있지 않음 |

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

- `changes`는 1개 이상, `id` 중복 불가
- `status`는 `deriveRunStatus(changes)`와 같아야 함
- `browser`는 `chromium`뿐

### `deriveRunStatus`

| 조건                           | status            |
| ------------------------------ | ----------------- |
| `error`가 하나라도 있음        | `failed`          |
| 없고 `changed`가 하나라도 있음 | `review-required` |
| 전부 `unchanged`               | `passed`          |

빈 배열은 예외.

## 검증

```bash
pnpm nx test visual-contracts
pnpm nx typecheck visual-contracts
pnpm nx lint visual-contracts
```
