import { describe, expect, it } from 'vitest';

import { safeReturnTo } from './oauth.ts';
import { cookie, csrfTokenFor, randomToken, readCookie, SESSION_COOKIE } from './session.ts';

describe('cookies', () => {
  it('sets HttpOnly, Secure, SameSite=Lax and Path=/ for __Host- cookies', () => {
    expect(cookie(SESSION_COOKIE, 'value', 60)).toBe(
      '__Host-rp_session=value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60',
    );
  });

  it('reads one cookie out of a header', () => {
    expect(readCookie('a=1; __Host-rp_session=abc=; b=2', SESSION_COOKIE)).toBe('abc=');
    expect(readCookie('a=1', SESSION_COOKIE)).toBeNull();
    expect(readCookie(null, SESSION_COOKIE)).toBeNull();
  });
});

describe('tokens', () => {
  it('creates 43-character random tokens and a CSRF token bound to the session', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrfTokenFor(token)).toBe(csrfTokenFor(token));
    expect(csrfTokenFor(token)).not.toBe(csrfTokenFor(randomToken()));
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/pulls/101/7', '/pulls/101/7'],
    [null, '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['pulls', '/'],
  ])('maps %s to %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
