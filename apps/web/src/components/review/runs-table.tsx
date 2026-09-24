import type { VisualRun } from '@review-platform/visual-contracts';
import Link from 'next/link';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { countChanges, formatTimestamp } from '@/lib/format';
import { RUN_STATUS_DISPLAY } from '@/lib/status-display';
import { focusRing } from '@/lib/styles';
import { cn } from '@/lib/utils';

import { ShortSha } from './short-sha';
import { StatusBadge } from './status-badge';

/** Runs 목록 표. 개수는 run.json의 changes에서 세기만 하고 status는 다시 계산하지 않는다. */
export function RunsTable({ runs }: { runs: VisualRun[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Run</TableHead>
          <TableHead scope="col">Repository</TableHead>
          <TableHead scope="col">Base</TableHead>
          <TableHead scope="col">Head</TableHead>
          <TableHead scope="col">Created</TableHead>
          <TableHead scope="col" className="text-right">
            Changed
          </TableHead>
          <TableHead scope="col" className="text-right">
            Unchanged
          </TableHead>
          <TableHead scope="col" className="text-right">
            Errors
          </TableHead>
          <TableHead scope="col">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const counts = countChanges(run.changes);
          return (
            <TableRow key={run.id}>
              <TableCell>
                <Link
                  href={`/runs/${run.id}`}
                  className={cn('font-medium underline underline-offset-4', focusRing)}
                >
                  {run.id}
                </Link>
              </TableCell>
              <TableCell>{run.repository}</TableCell>
              <TableCell>
                <ShortSha sha={run.baseSha} label="Base SHA" />
              </TableCell>
              <TableCell>
                <ShortSha sha={run.headSha} label="Head SHA" />
              </TableCell>
              <TableCell>
                <time dateTime={run.createdAt}>{formatTimestamp(run.createdAt)}</time>
              </TableCell>
              <TableCell className="text-right tabular-nums">{counts.changed}</TableCell>
              <TableCell className="text-right tabular-nums">{counts.unchanged}</TableCell>
              <TableCell className="text-right tabular-nums">{counts.error}</TableCell>
              <TableCell>
                <StatusBadge display={RUN_STATUS_DISPLAY[run.status]} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
