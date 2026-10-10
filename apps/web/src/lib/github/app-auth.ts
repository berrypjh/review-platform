import { createSign, type KeyObject } from 'node:crypto';

import { z } from 'zod';

import { type Deadline, githubRequest, type Transport } from './http.ts';

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/**
 * App JWT(RS256). `iat`는 시계 오차를 견디도록 60초 전, 만료는 9분 뒤(GitHub 상한 10분).
 * `iss`는 GitHub 권장대로 client ID다.
 */
export function createAppJwt(clientId: string, privateKey: KeyObject, now = new Date()): string {
  const seconds = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: clientId }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

/** installation token에 요청하는 권한. App이 받은 권한보다 넓게 요청하지 않는다. */
export const TOKEN_PERMISSIONS = {
  checks: 'write',
  pull_requests: 'read',
  metadata: 'read',
} as const;

const TokenSchema = z.object({ token: z.string().min(1), expires_at: z.string() });

export type AppCredentials = { clientId: string; privateKey: KeyObject; installationId: number };

/**
 * 지정한 저장소로만 범위를 좁힌 installation token을 받는다. installation에 없는 저장소면 GitHub이 거부한다(fail closed).
 * 토큰은 호출자가 한 요청 안에서만 쓰고 저장하지 않는다.
 */
export async function createInstallationToken(
  transport: Transport,
  credentials: AppCredentials,
  repositoryIds: number[],
  deadline: Deadline,
): Promise<string> {
  const { data } = await githubRequest(transport, {
    method: 'POST',
    url: `/app/installations/${credentials.installationId}/access_tokens`,
    token: createAppJwt(credentials.clientId, credentials.privateKey),
    deadline,
    body: { repository_ids: repositoryIds, permissions: TOKEN_PERMISSIONS },
    schema: TokenSchema,
  });
  return data.token;
}
