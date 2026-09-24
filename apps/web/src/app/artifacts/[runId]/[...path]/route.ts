import { readArtifactPng, reviewDataDir } from '@/lib/review-data';

type Context = { params: Promise<{ runId: string; path: string[] }> };

/** REVIEW_DATA_DIR 안의 run artifact PNG만 제공한다. 경로 검사는 readArtifactPng가 하고, 그 외는 모두 404다. */
export async function GET(_request: Request, { params }: Context) {
  const { runId, path } = await params;
  const png = await readArtifactPng(reviewDataDir(), runId, path);
  if (!png) return new Response('Not found', { status: 404 });
  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
