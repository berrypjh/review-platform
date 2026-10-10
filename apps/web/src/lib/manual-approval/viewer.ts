import 'server-only';

import { cookies } from 'next/headers';

import { csrfTokenFor, currentOperator, SESSION_COOKIE } from '../auth/session.ts';
import type { SessionUser } from '../auth/store.ts';
import type { Db } from '../db/config.ts';
import { ConfigurationError } from '../db/config.ts';
import type { ManualApprovalConfig } from './config.ts';
import { approvalContext } from './runtime.ts';

export type Viewer =
  | { kind: 'not-configured' }
  | { kind: 'signed-out' }
  | {
      kind: 'operator';
      operator: SessionUser;
      /** form에 넣을 CSRF token. 세션 cookie(HttpOnly) 없이는 쓸모가 없다. */
      csrfToken: string;
      sql: Db;
      config: ManualApprovalConfig;
    };

/**
 * 요청한 사람이 운영자인지 서버에서 판정한다. 세션 만료 · 철회 · `APPROVER_GITHUB_IDS`를 매 요청 확인한다.
 * 운영자가 아니면(로그인 안 함 포함) PR 데이터를 읽지 않는다. 화면의 버튼 숨김은 보안 경계가 아니다.
 */
export async function loadViewer(): Promise<Viewer> {
  let context: ReturnType<typeof approvalContext>;
  try {
    context = approvalContext();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      return { kind: 'not-configured' };
    }
    throw error;
  }
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  const operator = await currentOperator(context.sql, context.config, sessionToken);
  if (!operator || !sessionToken) return { kind: 'signed-out' };
  return { kind: 'operator', operator, csrfToken: csrfTokenFor(sessionToken), ...context };
}
