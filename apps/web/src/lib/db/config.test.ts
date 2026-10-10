import { describe, expect, it } from 'vitest';

import { ConfigurationError, readDatabaseConfig } from './config.ts';

const SECRET_URL =
  'postgres://app:s3cret-pass@ep-example.neon.tech/review?sslmode=require&channel_binding=require';

describe('readDatabaseConfig', () => {
  it('fails with a configuration error when DATABASE_URL is missing', () => {
    expect(() => readDatabaseConfig({})).toThrow(ConfigurationError);
  });

  it.each(['not a url', 'mysql://app:s3cret-pass@host/db'])(
    'rejects %s without echoing the value',
    (value) => {
      try {
        readDatabaseConfig({ DATABASE_URL: value });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as Error).message).not.toContain('s3cret');
        expect((error as Error).message).not.toContain(value);
      }
    },
  );

  it('drops URL query options and verifies TLS for remote hosts', () => {
    const config = readDatabaseConfig({ DATABASE_URL: SECRET_URL });
    expect(config.ssl).toBe('verify-full');
    expect(config.url).not.toContain('sslmode');
    expect(config.url).not.toContain('channel_binding');
  });

  it('allows plain connections only to a local database', () => {
    expect(readDatabaseConfig({ DATABASE_URL: 'postgres://review@127.0.0.1:54329/db' }).ssl).toBe(
      false,
    );
    expect(readDatabaseConfig({ DATABASE_URL: 'postgres://review@localhost/db' }).ssl).toBe(false);
  });
});
