import { ExternalLink, Image as ImageIcon } from 'lucide-react';
import Image from 'next/image';

import { focusRing } from '@/lib/styles';
import { cn } from '@/lib/utils';

type ArtifactImageProps = {
  runId: string;
  path: string | null;
  alt: string;
  caption: string;
  missingText: string;
  viewport: { width: number; height: number };
};

const artifactUrl = (runId: string, path: string) => `/artifacts/${runId}/${path}`;

/**
 * run artifact PNG 하나. 캡션과 원본 크기 링크를 함께 그리고, 경로가 null이면 이유를 적은 자리 표시자를 그린다.
 * 픽셀 단위 diff를 정확히 보기 위해 `image-rendering: pixelated`로 표시한다.
 */
export function ArtifactImage({
  runId,
  path,
  alt,
  caption,
  missingText,
  viewport,
}: ArtifactImageProps) {
  if (!path) {
    return (
      <figure className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <ImageIcon aria-hidden="true" className="size-5" />
        <figcaption>
          <span className="font-medium text-foreground">{caption}:</span> {missingText}
        </figcaption>
      </figure>
    );
  }
  const url = artifactUrl(runId, path);
  return (
    <figure className="space-y-2">
      <Image
        src={url}
        alt={alt}
        width={viewport.width}
        height={viewport.height}
        unoptimized
        className="h-auto w-full rounded-lg border bg-muted [image-rendering:pixelated]"
      />
      <figcaption className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{caption}</span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'inline-flex items-center gap-1 underline-offset-4 hover:underline',
            focusRing,
          )}
        >
          Open full size
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </figcaption>
    </figure>
  );
}
