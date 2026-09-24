import { describe, expect, it } from 'vitest';

import { joinTargetUrl, parseBaseUrl } from './url.ts';

describe('joinTargetUrl', () => {
  it('joins a target path onto a root base URL', () => {
    const base = parseBaseUrl('http://127.0.0.1:6006');
    expect(joinTargetUrl(base, 'iframe.html?id=button--primary&viewMode=story').href).toBe(
      'http://127.0.0.1:6006/iframe.html?id=button--primary&viewMode=story',
    );
  });

  it('keeps a base sub-path with or without a trailing slash', () => {
    for (const value of ['https://example.com/storybook', 'https://example.com/storybook/']) {
      expect(joinTargetUrl(parseBaseUrl(value), 'iframe.html?id=a--b').href).toBe(
        'https://example.com/storybook/iframe.html?id=a--b',
      );
    }
  });

  it.each([
    'https://evil.example/iframe.html',
    '//evil.example/iframe.html',
    '/iframe.html',
    '../iframe.html',
    '%2e%2e/iframe.html',
  ])('blocks %j from escaping the base URL', (targetPath) => {
    const base = parseBaseUrl('https://example.com/storybook/');
    expect(() => joinTargetUrl(base, targetPath)).toThrow(/escapes base URL/);
  });
});
