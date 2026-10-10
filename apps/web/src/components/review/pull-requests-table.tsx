import Link from 'next/link';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { APPROVAL_STATUS_DISPLAY } from '@/lib/manual-approval/display';
import { approvalStatus, type Snapshot } from '@/lib/manual-approval/state';
import { focusRing } from '@/lib/styles';
import { cn } from '@/lib/utils';

import { ExternalLink } from './external-link';
import { ShortSha } from './short-sha';
import { StatusBadge } from './status-badge';

export const pullRequestPath = ({ pullRequest }: Pick<Snapshot, 'pullRequest'>) =>
  `/pulls/${pullRequest.repositoryId}/${pullRequest.number}`;

/** PR 목록 표. 승인 상태는 `approvalStatus`의 결과를 그대로 쓴다. 긴 제목 · 저장소 이름은 줄바꿈한다. */
export function PullRequestsTable({ snapshots }: { snapshots: Snapshot[] }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="w-[18%]">
            Repository
          </TableHead>
          <TableHead scope="col">Pull request</TableHead>
          <TableHead scope="col" className="w-[12%]">
            Author
          </TableHead>
          <TableHead scope="col" className="w-[10%]">
            Head
          </TableHead>
          <TableHead scope="col" className="w-[17%]">
            Approval
          </TableHead>
          <TableHead scope="col" className="w-[10%]">
            GitHub
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {snapshots.map((snapshot) => {
          const { pullRequest } = snapshot;
          return (
            <TableRow key={pullRequest.id}>
              <TableCell className="whitespace-normal break-words">
                {pullRequest.owner}/{pullRequest.name}
              </TableCell>
              <TableCell className="whitespace-normal">
                <Link
                  href={pullRequestPath(snapshot)}
                  className={cn('font-medium break-words underline underline-offset-4', focusRing)}
                >
                  #{pullRequest.number} {pullRequest.title}
                </Link>
              </TableCell>
              <TableCell className="whitespace-normal break-all">
                {pullRequest.authorLogin}
              </TableCell>
              <TableCell>
                <ShortSha sha={pullRequest.headSha} label="Head SHA" />
              </TableCell>
              <TableCell className="whitespace-normal">
                <StatusBadge display={APPROVAL_STATUS_DISPLAY[approvalStatus(snapshot)]} />
              </TableCell>
              <TableCell>
                <ExternalLink href={pullRequest.htmlUrl}>#{pullRequest.number}</ExternalLink>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
