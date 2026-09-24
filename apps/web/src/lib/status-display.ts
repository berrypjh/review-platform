import type { VisualChangeStatus, VisualRunStatus } from '@review-platform/visual-contracts';
import { Check, CircleX, GitCompare, type LucideIcon, TriangleAlert } from 'lucide-react';

/** status 하나의 표시 방법. 아이콘과 텍스트를 항상 같이 써서 색만으로 구분하지 않는다. */
export type StatusDisplay = {
  label: string;
  icon: LucideIcon;
  variant: 'secondary' | 'outline' | 'destructive';
  className?: string;
};

const WARNING = 'border-amber-300 bg-amber-50 text-amber-900';

export const RUN_STATUS_DISPLAY = {
  passed: { label: 'Passed', icon: Check, variant: 'secondary' },
  'review-required': {
    label: 'Review required',
    icon: TriangleAlert,
    variant: 'outline',
    className: WARNING,
  },
  failed: { label: 'Failed', icon: CircleX, variant: 'destructive' },
} satisfies Record<VisualRunStatus, StatusDisplay>;

export const CHANGE_STATUS_DISPLAY = {
  unchanged: { label: 'Unchanged', icon: Check, variant: 'secondary' },
  changed: { label: 'Changed', icon: GitCompare, variant: 'outline', className: WARNING },
  error: { label: 'Error', icon: CircleX, variant: 'destructive' },
} satisfies Record<VisualChangeStatus, StatusDisplay>;
