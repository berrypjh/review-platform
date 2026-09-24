import { Badge } from '@/components/ui/badge';
import type { StatusDisplay } from '@/lib/status-display';

/** 아이콘 + 텍스트 badge. 색만으로 status를 구분하지 않기 위한 유일한 status 표시 방법이다. */
export function StatusBadge({ display }: { display: StatusDisplay }) {
  const Icon = display.icon;
  return (
    <Badge variant={display.variant} className={display.className}>
      <Icon aria-hidden="true" />
      {display.label}
    </Badge>
  );
}
