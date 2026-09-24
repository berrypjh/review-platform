import { cn } from '@/lib/utils';

export type DefinitionField = { term: string; value: string; mono?: boolean };

/** 용어-값 쌍을 반응형 그리드로 그리는 `<dl>`. SHA나 경로처럼 고정폭이 필요한 값은 `mono`로 표시한다. */
export function DefinitionList({
  fields,
  className,
}: {
  fields: DefinitionField[];
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-x-8 gap-y-3 text-sm', className)}>
      {fields.map(({ term, value, mono }) => (
        <div key={term} className="min-w-0">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className={cn('break-all', mono && 'font-mono')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
