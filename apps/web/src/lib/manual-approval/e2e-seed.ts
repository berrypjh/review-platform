/**
 * E2E 전용 테스트 데이터 CLI. Playwright가 `node e2e-seed.ts '<json>'`로 부른다. 앱 런타임은 이 파일을 import하지 않는다.
 * `E2E_DATABASE_URL`(전용 테스트 DB)만 쓴다. 행은 실제 repository 함수로 만들어 운영과 같은 제약을 지난다.
 */
import { fileURLToPath } from 'node:url';

import { hashToken } from '../auth/session.ts';
import { createSession } from '../auth/store.ts';
import { openDatabase, readDatabaseConfig } from '../db/config.ts';
import { migrate } from '../db/migrate.ts';
import {
  applyObservation,
  claimPullRequest,
  listRevisionsToSync,
  loadSnapshot,
  recordApproval,
  recordSyncResult,
  releaseClaim,
} from './repository.ts';
import { type ObservedPullRequest, ObservedPullRequestSchema } from './schema.ts';

type SyncResult = 'synced' | 'unknown' | 'error';
type Command =
  | { op: 'reset' }
  | { op: 'session'; token: string; githubUserId: number; login: string; expiresInSeconds?: number }
  | { op: 'observe'; pull: ObservedPullRequest; sync?: SyncResult }
  | {
      op: 'approve';
      repositoryId: number;
      number: number;
      login: string;
      githubUserId: number;
      sync: SyncResult;
    };

const url = process.env['E2E_DATABASE_URL'];
if (!url) throw new Error('E2E_DATABASE_URL is not set');
const sql = openDatabase(readDatabaseConfig({ DATABASE_URL: url }), { max: 1 });

async function withClaim<T>(
  key: { repositoryId: number; number: number },
  work: (claim: NonNullable<Awaited<ReturnType<typeof claimPullRequest>>>) => Promise<T>,
) {
  const claim = await claimPullRequest(sql, key, 10_000);
  if (!claim) throw new Error('PR is claimed by another worker');
  try {
    return await work(claim);
  } finally {
    await releaseClaim(sql, claim);
  }
}

/** 반영되지 않은 revision 모두에 GitHub 결과를 기록한다(실제 GitHub 호출 없음). */
async function markSync(key: { repositoryId: number; number: number }, result: SyncResult) {
  await withClaim(key, async (claim) => {
    const snapshot = await loadSnapshot(sql, key);
    if (!snapshot) throw new Error('PR is not stored');
    for (const revision of await listRevisionsToSync(sql, snapshot.pullRequest.id)) {
      const outcome =
        result === 'synced'
          ? { state: 'synced' as const }
          : { state: result, error: `E2E seeded ${result}` };
      await recordSyncResult(sql, claim, revision.id, revision.version, outcome);
    }
  });
}

async function run(command: Command) {
  switch (command.op) {
    case 'reset':
      await migrate(sql, fileURLToPath(new URL('../../../db/migrations', import.meta.url)));
      await sql`TRUNCATE sessions, oauth_transactions, webhook_deliveries, pull_request_claims, revisions, pull_requests RESTART IDENTITY CASCADE`;
      return;
    case 'session':
      await createSession(sql, {
        tokenHash: hashToken(command.token),
        githubUserId: command.githubUserId,
        login: command.login,
        expiresAt: new Date(Date.now() + (command.expiresInSeconds ?? 3600) * 1000),
      });
      return;
    case 'observe': {
      const pull = ObservedPullRequestSchema.parse(command.pull);
      await withClaim(pull, (claim) => applyObservation(sql, claim, pull));
      if (command.sync) await markSync(pull, command.sync);
      return;
    }
    case 'approve': {
      const key = { repositoryId: command.repositoryId, number: command.number };
      const snapshot = await loadSnapshot(sql, key);
      if (!snapshot?.revision) throw new Error('PR has no revision to approve');
      const { headSha, generation } = snapshot.revision;
      const result = await withClaim(key, (claim) =>
        recordApproval(
          sql,
          claim,
          { expectedHeadSha: headSha, expectedRevision: generation },
          command,
        ),
      );
      if (result.kind === 'rejected') throw new Error(`Approval rejected: ${result.reason}`);
      await markSync(key, command.sync);
      return;
    }
  }
}

try {
  await run(JSON.parse(process.argv[2] ?? '{}') as Command);
} finally {
  await sql.end();
}
