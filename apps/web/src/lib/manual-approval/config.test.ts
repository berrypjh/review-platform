import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../db/config.ts';
import { readManualApprovalConfig } from './config.ts';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

const env = (overrides: Record<string, string | undefined> = {}) => ({
  GITHUB_APP_ID: '77',
  GITHUB_APP_CLIENT_ID: 'Iv1.testclient',
  GITHUB_APP_CLIENT_SECRET: 'client-secret-value',
  GITHUB_APP_PRIVATE_KEY: pem,
  GITHUB_WEBHOOK_SECRET: 'webhook-secret-value',
  GITHUB_INSTALLATION_ID: '5',
  GITHUB_ALLOWED_REPOSITORY_IDS: '101, 102,103',
  APPROVER_GITHUB_IDS: '42',
  PUBLIC_BASE_URL: 'https://review.example',
  ...overrides,
});

describe('readManualApprovalConfig', () => {
  it('reads numeric IDs and keeps App ID and client ID apart', () => {
    const config = readManualApprovalConfig(env());
    expect(config.appId).toBe(77);
    expect(config.clientId).toBe('Iv1.testclient');
    expect([...config.allowedRepositoryIds]).toEqual([101, 102, 103]);
    expect(config.publicBaseUrl).toBe('https://review.example');
  });

  it('accepts a private key with escaped newlines', () => {
    expect(() =>
      readManualApprovalConfig(env({ GITHUB_APP_PRIVATE_KEY: pem.replaceAll('\n', '\\n') })),
    ).not.toThrow();
  });

  it.each([
    ['GITHUB_WEBHOOK_SECRET', undefined],
    ['APPROVER_GITHUB_IDS', 'octocat'],
    ['GITHUB_ALLOWED_REPOSITORY_IDS', '101,-1'],
    ['GITHUB_APP_PRIVATE_KEY', 'not-a-key-s3cret'],
    ['PUBLIC_BASE_URL', 'http://review.example'],
    ['PUBLIC_BASE_URL', 'https://review.example/app'],
  ])('fails closed on %s=%s without echoing the value', (name, value) => {
    try {
      readManualApprovalConfig(env({ [name]: value }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain(name);
      if (value) expect((error as Error).message).not.toContain(value);
    }
  });

  it('allows plain http only for localhost', () => {
    expect(
      readManualApprovalConfig(env({ PUBLIC_BASE_URL: 'http://localhost:3000' })).publicBaseUrl,
    ).toBe('http://localhost:3000');
  });
});
