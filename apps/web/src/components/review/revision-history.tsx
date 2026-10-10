import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatTimestamp } from '@/lib/format';
import { decisionLabel, SYNC_STATE_LABEL } from '@/lib/manual-approval/display';
import type { RevisionRecord } from '@/lib/manual-approval/schema';

import { ShortSha } from './short-sha';

/**
 * 승인 단위 이력. 새 HEAD · 재오픈마다 한 줄이 생기고 과거 결정은 그대로 남는다.
 * 현재 revision만 승인 대상이다 — 이전 줄의 Approved는 그 commit에 대한 기록일 뿐이다.
 */
export function RevisionHistory({
  revisions,
  activeRevisionId,
}: {
  revisions: RevisionRecord[];
  activeRevisionId: number | null;
}) {
  return (
    <Table>
      <caption className="sr-only">Approval history, newest first</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Revision</TableHead>
          <TableHead scope="col">Head</TableHead>
          <TableHead scope="col">Decision</TableHead>
          <TableHead scope="col">Approved by</TableHead>
          <TableHead scope="col">Decided at</TableHead>
          <TableHead scope="col">GitHub check</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {revisions.map((revision) => (
          <TableRow key={revision.id}>
            <TableCell>
              {revision.generation}
              {revision.id === activeRevisionId && (
                <span className="ml-2 text-muted-foreground">(current)</span>
              )}
            </TableCell>
            <TableCell>
              <ShortSha sha={revision.headSha} label={`Revision ${revision.generation} head SHA`} />
            </TableCell>
            <TableCell>{decisionLabel(revision)}</TableCell>
            <TableCell className="break-all whitespace-normal">
              {revision.approverLogin ? `@${revision.approverLogin}` : '—'}
            </TableCell>
            <TableCell>
              {revision.decisionAt ? (
                <time dateTime={revision.decisionAt.toISOString()}>
                  {formatTimestamp(revision.decisionAt.toISOString())}
                </time>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell>{SYNC_STATE_LABEL[revision.syncState]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
