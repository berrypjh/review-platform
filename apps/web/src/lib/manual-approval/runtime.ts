import 'server-only';

import { getSql } from '../db/client.ts';
import { ConfigurationError } from '../db/config.ts';
import { createGitHubApi } from '../github/api.ts';
import { deadlineIn, GitHubApiError, type Transport } from '../github/http.ts';
import { type ManualApprovalConfig, readManualApprovalConfig } from './config.ts';
import type { ApprovalDeps } from './sync.ts';

let config: ManualApprovalConfig | undefined;

/** 런타임 전송은 전역 fetch 하나다. 테스트용 transport를 고르는 경로는 없다. */
const transport: Transport = (url, init) => fetch(url, init);

/**
 * 승인 route가 쓰는 의존을 만든다. 설정 · DB 연결은 처음 부를 때 만든다 — Visual 화면은 이 모듈을 import하지 않는다.
 * 설정이 없으면 `ConfigurationError`. 요청마다 새 GitHub 접근(installation token 포함)과 deadline을 쓴다.
 */
export function approvalRuntime(deadlineMs: number): ApprovalDeps & {
  config: ManualApprovalConfig;
  transport: Transport;
} {
  const { sql, config } = approvalContext();
  return {
    sql,
    github: createGitHubApi(transport, config, deadlineIn(deadlineMs)),
    config,
    transport,
  };
}

/** 화면이 쓰는 설정 · DB. GitHub 호출이 필요 없는 읽기 전용 경로다. 설정이 없으면 `ConfigurationError`. */
export function approvalContext() {
  config ??= readManualApprovalConfig();
  return { sql: getSql(), config };
}

/** route 공통 JSON 응답. 캐시하지 않는다. */
export const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * 설정 누락은 503, GitHub 오류는 502(종류만), 그 밖의 예상하지 못한 오류는 500.
 * 응답에 내부 메시지 · secret을 넣지 않는다. 로그에는 secret이 없는 메시지만 남긴다.
 */
export function failureResponse(error: unknown): Response {
  if (error instanceof GitHubApiError) {
    console.error(error.message);
    return json(502, { error: 'github', kind: error.kind });
  }
  if (error instanceof ConfigurationError) {
    console.error(error.message);
    return json(503, { error: 'not-configured' });
  }
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'Unexpected failure');
  return json(500, { error: 'internal' });
}
