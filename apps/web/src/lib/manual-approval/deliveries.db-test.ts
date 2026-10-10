import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase, type TestDatabase } from '../db/test-database.ts';
import { beginDelivery, type DeliveryHeader, finishDelivery } from './deliveries.ts';

const HEADER: DeliveryHeader = {
  deliveryId: '72d3162e-cc78-11e3-81ab-4c9367dc0958',
  event: 'pull_request',
  action: 'synchronize',
  repositoryId: 101,
  installationId: 9,
  pullNumber: 7,
};
const STALE_MS = 60_000;

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

afterEach(async () => {
  await db.close();
});

describe('webhook deliveries', () => {
  it('processes a new delivery and treats a finished one as a no-op', async () => {
    expect(await beginDelivery(db.sql, HEADER, STALE_MS)).toEqual({ kind: 'process', attempt: 1 });
    expect(await finishDelivery(db.sql, HEADER.deliveryId, 1, { status: 'done' })).toBe(true);
    expect(await beginDelivery(db.sql, HEADER, STALE_MS)).toEqual({ kind: 'duplicate' });
  });

  it('treats an ignored delivery as finished', async () => {
    await beginDelivery(db.sql, HEADER, STALE_MS);
    await finishDelivery(db.sql, HEADER.deliveryId, 1, { status: 'ignored' });
    expect(await beginDelivery(db.sql, HEADER, STALE_MS)).toEqual({ kind: 'duplicate' });
  });

  it('reprocesses a failed delivery when GitHub redelivers the same ID', async () => {
    await beginDelivery(db.sql, HEADER, STALE_MS);
    await finishDelivery(db.sql, HEADER.deliveryId, 1, {
      status: 'failed',
      error: 'GitHub timed out',
    });
    expect(await beginDelivery(db.sql, HEADER, STALE_MS)).toEqual({ kind: 'process', attempt: 2 });
    const [row] = await db.sql`SELECT status, attempts, last_error FROM webhook_deliveries`;
    expect(row).toEqual({ status: 'processing', attempts: 2, last_error: null });
  });

  it('reports a delivery that is still being processed', async () => {
    await beginDelivery(db.sql, HEADER, STALE_MS);
    expect(await beginDelivery(db.sql, HEADER, STALE_MS)).toEqual({ kind: 'in-progress' });
  });

  it('takes over an abandoned delivery and ignores the late result of the old attempt', async () => {
    await beginDelivery(db.sql, HEADER, 50);
    await sleep(100);
    expect(await beginDelivery(db.sql, HEADER, 50)).toEqual({ kind: 'process', attempt: 2 });
    expect(await finishDelivery(db.sql, HEADER.deliveryId, 1, { status: 'done' })).toBe(false);
    expect(await finishDelivery(db.sql, HEADER.deliveryId, 2, { status: 'done' })).toBe(true);
  });

  it('records each delivery once when two arrive at the same time', async () => {
    const results = await Promise.all([
      beginDelivery(db.sql, HEADER, STALE_MS),
      beginDelivery(db.connect(), HEADER, STALE_MS),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(['in-progress', 'process']);
  });
});
