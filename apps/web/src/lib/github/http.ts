import type { z } from 'zod';

/** 공식 지원 REST API 버전 중 최신(docs.github.com/rest/about-the-rest-api/api-versions). */
export const GITHUB_API_VERSION = '2026-03-10';
export const GITHUB_API = 'https://api.github.com';

/**
 * HTTP 전송. 런타임은 전역 `fetch`, 테스트만 제어 가능한 가짜를 넘긴다.
 * `Request` 객체가 아니라 `(url, init)`을 넘긴다 — `new Request(..., { signal })`가 만든 파생 signal은
 * GC 뒤 부모 timeout과의 연결을 잃어 `fetch`가 끝없이 기다릴 수 있다(Node 24에서 재현 확인).
 */
export type Transport = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Response>;

/** 요청 묶음 전체의 마감 시각(epoch ms). 모든 외부 호출은 남은 시간 안에서만 기다린다. */
export type Deadline = { at: number };

export const deadlineIn = (ms: number): Deadline => ({ at: Date.now() + ms });
export const remainingMs = (deadline: Deadline) => deadline.at - Date.now();

export type GitHubErrorKind =
  | 'rate-limited'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'invalid'
  | 'server'
  | 'timeout'
  | 'network';

/**
 * GitHub 호출 실패. 메시지에는 method · 경로 · status · request ID만 넣는다 — 토큰 · 본문 원문을 넣지 않는다.
 * `outcomeUnknown`이면 쓰기 요청이 GitHub에 반영됐는지 알 수 없다(응답 유실 · timeout · 5xx).
 */
export class GitHubApiError extends Error {
  override name = 'GitHubApiError';

  constructor(
    readonly kind: GitHubErrorKind,
    readonly method: string,
    readonly path: string,
    readonly status: number | null,
    readonly requestId: string | null,
    readonly retryAfterSeconds: number | null,
  ) {
    super(
      `GitHub ${method} ${path} failed: ${kind}` +
        (status ? ` (${status})` : '') +
        (requestId ? ` request ${requestId}` : '') +
        (retryAfterSeconds !== null ? ` retry after ${retryAfterSeconds}s` : ''),
    );
  }

  get outcomeUnknown() {
    return this.kind === 'timeout' || this.kind === 'network' || this.kind === 'server';
  }
}

function classify(response: Response): GitHubErrorKind {
  const { status, headers } = response;
  if (status === 429) return 'rate-limited';
  if (
    status === 403 &&
    (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after'))
  ) {
    return 'rate-limited';
  }
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status >= 500) return 'server';
  return 'invalid';
}

function retryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header && /^\d+$/.test(header)) return Number(header);
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset && /^\d+$/.test(reset))
    return Math.max(0, Number(reset) - Math.floor(Date.now() / 1000));
  return null;
}

export type GitHubRequest<T> = {
  method: 'GET' | 'POST' | 'PATCH';
  /** `https://api.github.com` 아래 경로(`/repos/...`) 또는 절대 URL. */
  url: string;
  token: string;
  deadline: Deadline;
  body?: unknown;
  schema: z.ZodType<T>;
};

export type GitHubResponse<T> = { data: T; nextUrl: string | null };

/**
 * GitHub REST 요청 하나. 남은 deadline으로 timeout을 걸고, 2xx가 아니면 종류별 `GitHubApiError`를 던진다.
 * 응답은 `schema`로 검증한다 — 필요한 필드만 보고 나머지는 버린다.
 */
export async function githubRequest<T>(
  transport: Transport,
  { method, url, token, deadline, body, schema }: GitHubRequest<T>,
): Promise<GitHubResponse<T>> {
  const target = new URL(url, GITHUB_API);
  const path = target.pathname;
  const timeout = remainingMs(deadline);
  if (timeout <= 0) throw new GitHubApiError('timeout', method, path, null, null, null);

  let response: Response;
  try {
    response = await transport(target.toString(), {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': GITHUB_API_VERSION,
        'user-agent': 'review-platform',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new GitHubApiError(timedOut ? 'timeout' : 'network', method, path, null, null, null);
  }

  const requestId = response.headers.get('x-github-request-id');
  if (!response.ok) {
    await response.body?.cancel();
    throw new GitHubApiError(
      classify(response),
      method,
      path,
      response.status,
      requestId,
      retryAfter(response),
    );
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new GitHubApiError('network', method, path, response.status, requestId, null);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new GitHubApiError('invalid', method, path, response.status, requestId, null);
  }
  return { data: parsed.data, nextUrl: nextLink(response.headers.get('link')) };
}

/** `Link` header의 `rel="next"`. 페이지네이션은 이 URL만 따라간다. */
function nextLink(header: string | null): string | null {
  const match = header?.split(',').find((part) => /rel="next"/.test(part));
  const url = match?.match(/<([^>]+)>/)?.[1];
  return url && url.startsWith(`${GITHUB_API}/`) ? url : null;
}
