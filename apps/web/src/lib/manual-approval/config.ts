import { createPrivateKey, type KeyObject } from 'node:crypto';

import { ConfigurationError } from '../db/config.ts';

/** GitHub App · 로그인 · 공개 URL 설정. 서버에서만 읽는다. 값은 오류 · 로그에 넣지 않는다. */
export type ManualApprovalConfig = {
  /** OAuth web flow와 App JWT의 `iss`(GitHub 권장)에 쓰는 client ID. */
  clientId: string;
  clientSecret: string;
  privateKey: KeyObject;
  webhookSecret: string;
  installationId: number;
  allowedRepositoryIds: ReadonlySet<number>;
  approverIds: ReadonlySet<number>;
  /** `https://host` — commit status `target_url` · OAuth callback · POST Origin 비교 기준. 끝 `/` 없음. */
  publicBaseUrl: string;
};

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigurationError(`${name} is not set.`);
  return value;
}

function positiveInt(env: Env, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer.`);
  }
  return value;
}

function idList(env: Env, name: string): ReadonlySet<number> {
  const ids = required(env, name)
    .split(',')
    .map((part) => Number(part.trim()));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new ConfigurationError(`${name} must be a comma-separated list of numeric IDs.`);
  }
  return new Set(ids);
}

function privateKey(env: Env): KeyObject {
  // 호스팅 env에 한 줄로 넣은 경우(`\n` 이스케이프)도 받는다.
  const pem = required(env, 'GITHUB_APP_PRIVATE_KEY').replaceAll('\\n', '\n');
  try {
    return createPrivateKey(pem);
  } catch {
    throw new ConfigurationError('GITHUB_APP_PRIVATE_KEY is not a valid PEM private key.');
  }
}

function publicBaseUrl(env: Env): string {
  let url: URL;
  try {
    url = new URL(required(env, 'PUBLIC_BASE_URL'));
  } catch {
    throw new ConfigurationError('PUBLIC_BASE_URL is not a valid URL.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new ConfigurationError('PUBLIC_BASE_URL must use https (http only for localhost).');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigurationError('PUBLIC_BASE_URL must be an origin without a path.');
  }
  return url.origin;
}

/** 승인 경로의 설정을 읽는다. 하나라도 없거나 잘못되면 `ConfigurationError` — 일부 설정으로 동작하지 않는다. */
export function readManualApprovalConfig(env: Env = process.env): ManualApprovalConfig {
  return {
    clientId: required(env, 'GITHUB_APP_CLIENT_ID'),
    clientSecret: required(env, 'GITHUB_APP_CLIENT_SECRET'),
    privateKey: privateKey(env),
    webhookSecret: required(env, 'GITHUB_WEBHOOK_SECRET'),
    installationId: positiveInt(env, 'GITHUB_INSTALLATION_ID'),
    allowedRepositoryIds: idList(env, 'GITHUB_ALLOWED_REPOSITORY_IDS'),
    approverIds: idList(env, 'APPROVER_GITHUB_IDS'),
    publicBaseUrl: publicBaseUrl(env),
  };
}
