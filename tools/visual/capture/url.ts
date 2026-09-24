/** Storybook base URL을 파싱한다. http(s)만 받고 query·hash는 거부하며, pathname은 항상 "/"로 끝나게 맞춘다. */
export function parseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Base URL must use http or https: ${value}`);
  }
  if (url.search || url.hash) throw new Error(`Base URL must not have a query or hash: ${value}`);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

/** target path를 base URL에 붙인다. 결과가 base의 origin이나 경로 밖으로 나가면 예외를 던진다. */
export function joinTargetUrl(base: URL, targetPath: string): URL {
  const url = new URL(targetPath, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error(`Target path "${targetPath}" escapes base URL ${base.href}`);
  }
  return url;
}
