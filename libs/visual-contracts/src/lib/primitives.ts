import { z } from 'zod';

/** 소문자·숫자·하이픈만 허용하는 id. 파일/디렉터리 이름으로 그대로 쓸 수 있어야 한다. */
export const SafeIdSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/,
    'Must be 1-100 chars of a-z, 0-9 and "-", not starting or ending with "-"',
  );

/** 소문자 hex Git SHA. 짧은 SHA(7)부터 SHA-256(64)까지 받고, 대문자는 소문자로 바꾸지 않고 거부한다. */
export const GitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{7,64}$/, 'Must be 7-64 lowercase hex chars');

/** 끝이 "Z"인 UTC ISO 8601 시각. offset 표기와 날짜만 있는 값은 거부한다. */
export const IsoDateTimeSchema = z.iso.datetime();

export const ViewportSchema = z.strictObject({
  width: z.int().positive(),
  height: z.int().positive(),
});

const hasScheme = (value: string) => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
const isControlChar = (char: string) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f;
const hasUnsafeChars = (value: string) => /[\s\\]/.test(value) || [...value].some(isControlChar);
const hasDotSegment = (path: string) =>
  path.split('/').some((segment) => segment === '.' || segment === '..');

/**
 * Storybook base URL 뒤에 붙이는 상대 URL. 예: `iframe.html?id=button--primary`.
 * scheme, 맨 앞 "/", 공백·백슬래시, `.`/`..` 경로 segment를 모두 거부해서 base origin 밖으로 나가지 못하게 한다.
 */
export const RelativeTargetPathSchema = z
  .string()
  .min(1)
  .refine((value) => !hasScheme(value), 'Must not be an absolute URL')
  .refine((value) => !value.startsWith('/'), 'Must not start with "/"')
  .refine(
    (value) => !hasUnsafeChars(value),
    'Must not contain whitespace, backslash or control characters',
  )
  .refine(
    (value) => !hasDotSegment(value.split(/[?#]/)[0] ?? ''),
    'Must not contain "." or ".." path segments',
  );

/**
 * run 디렉터리 기준 PNG artifact 상대 경로. 예: `current/button--primary.png`.
 * 맨 앞 "/", 드라이브 문자, 백슬래시, 빈 segment, `.`/`..` segment를 거부한다.
 */
export const ArtifactPathSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.png$/,
    'Must be a relative "/"-separated path ending in .png',
  )
  .refine((value) => !hasDotSegment(value), 'Must not contain "." or ".." path segments');
