import { createPublicKey, createVerify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { testConfig } from '../manual-approval/test-support.ts';
import { createAppJwt } from './app-auth.ts';

describe('createAppJwt', () => {
  it('signs RS256 claims GitHub accepts: iss = client ID, iat 60s back, exp under 10 minutes', () => {
    const config = testConfig();
    const now = new Date('2026-10-10T00:00:00Z');
    const [header, payload, signature] = createAppJwt(
      config.clientId,
      config.privateKey,
      now,
    ).split('.');
    const decode = (part: string | undefined) =>
      JSON.parse(Buffer.from(part ?? '', 'base64url').toString());

    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const seconds = now.getTime() / 1000;
    expect(decode(payload)).toEqual({
      iat: seconds - 60,
      exp: seconds + 540,
      iss: config.clientId,
    });
    const valid = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(createPublicKey(config.privateKey), Buffer.from(signature ?? '', 'base64url'));
    expect(valid).toBe(true);
  });
});
