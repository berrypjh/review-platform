import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { shortSha } from '@/lib/format';
import { focusRing } from '@/lib/styles';
import { cn } from '@/lib/utils';

/** 짧은 SHA. 전체 값은 hover와 키보드 focus에서 tooltip으로, 스크린리더에는 aria-label로 제공한다. */
export function ShortSha({ sha, label }: { sha: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger aria-label={`${label} ${sha}`} className={cn('font-mono text-sm', focusRing)}>
        {shortSha(sha)}
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono">{sha}</span>
      </TooltipContent>
    </Tooltip>
  );
}
