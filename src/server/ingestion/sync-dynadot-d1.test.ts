import { describe, expect, it, vi } from 'vitest';

import type { AppDatabase } from '../db/types';
import { createDynadotD1Storage } from './sync-dynadot-d1';
import type { DynadotListing } from '../providers/dynadot';

function finalizationDatabase(batchImpl: (statements: unknown[]) => unknown) {
  const listingStatement = { statement: 'inactivate-listings' };
  const runStatement = { statement: 'complete-run' };
  const listingWhere = vi.fn(() => listingStatement);
  const runWhere = vi.fn(() => ({ returning: vi.fn(() => runStatement) }));
  const update = vi
    .fn()
    .mockReturnValueOnce({ set: vi.fn(() => ({ where: listingWhere })) })
    .mockReturnValueOnce({ set: vi.fn(() => ({ where: runWhere })) });
  const batch = vi.fn(batchImpl);
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ value: 2 }]),
      })),
    })),
    update,
    batch,
  };

  return {
    db: db as unknown as AppDatabase,
    batch,
    listingStatement,
    runStatement,
  };
}

describe('createDynadotD1Storage finalization', () => {
  it('submits reconciliation and run success in one D1 atomic batch', async () => {
    const fixture = finalizationDatabase(async () => [[], [{ id: 7 }]]);
    const storage = createDynadotD1Storage(fixture.db);

    await expect(
      storage.finalizeSuccessfulRun(
        {
          runId: 7,
          startedAt: new Date('2026-07-13T00:00:00.000Z'),
          nextPage: 3,
          pagesFetched: 2,
          recordsFetched: 1,
          recordsUpserted: 1,
          recordsInactivated: 0,
        },
        {
          pagesFetched: 2,
          recordsFetched: 1,
          recordsUpserted: 1,
          completedAt: new Date('2026-07-13T00:01:00.000Z'),
        },
      ),
    ).resolves.toBe(2);

    expect(fixture.batch).toHaveBeenCalledTimes(1);
    expect(fixture.batch).toHaveBeenCalledWith([
      fixture.listingStatement,
      fixture.runStatement,
    ]);
  });

  it('surfaces an atomic batch failure', async () => {
    const fixture = finalizationDatabase(async () => {
      throw new Error('atomic batch failed');
    });
    const storage = createDynadotD1Storage(fixture.db);

    await expect(
      storage.finalizeSuccessfulRun(
        {
          runId: 7,
          startedAt: new Date('2026-07-13T00:00:00.000Z'),
          nextPage: 2,
          pagesFetched: 1,
          recordsFetched: 0,
          recordsUpserted: 0,
          recordsInactivated: 0,
        },
        {
          pagesFetched: 1,
          recordsFetched: 0,
          recordsUpserted: 0,
          completedAt: new Date('2026-07-13T00:01:00.000Z'),
        },
      ),
    ).rejects.toThrow('atomic batch failed');
  });

  it('rejects a zero-change stale success transition', async () => {
    const fixture = finalizationDatabase(async () => [[], []]);
    const storage = createDynadotD1Storage(fixture.db);

    await expect(
      storage.finalizeSuccessfulRun(
        {
          runId: 7,
          startedAt: new Date('2026-07-13T00:00:00.000Z'),
          nextPage: 2,
          pagesFetched: 1,
          recordsFetched: 0,
          recordsUpserted: 0,
          recordsInactivated: 0,
        },
        {
          pagesFetched: 1,
          recordsFetched: 0,
          recordsUpserted: 0,
          completedAt: new Date('2026-07-13T00:01:00.000Z'),
        },
      ),
    ).rejects.toMatchObject({ code: 'dynadot_stale_continuation' });
  });

  it('atomically cleans overlapping runs and inserts one new running run', async () => {
    const staleStatement = { statement: 'interrupt-stale-runs' };
    const insertStatement = { statement: 'insert-running-run' };
    const state = {
      runId: 8,
      startedAt: new Date('2026-07-13T00:00:00.000Z'),
      nextPage: 1,
      pagesFetched: 0,
      recordsFetched: 0,
      recordsUpserted: 0,
      recordsInactivated: 0,
    };
    const batch = vi.fn(async () => [[], [state]]);
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => staleStatement) })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => insertStatement),
        })),
      })),
      batch,
    } as unknown as AppDatabase;

    await expect(
      createDynadotD1Storage(db).startRun(state.startedAt),
    ).resolves.toEqual(state);
    expect(batch).toHaveBeenCalledWith([staleStatement, insertStatement]);
  });

  it('rejects zero-change progress and failure transitions', async () => {
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
        })),
      })),
    } as unknown as AppDatabase;
    const storage = createDynadotD1Storage(db);
    const run = {
      runId: 7,
      startedAt: new Date('2026-07-13T00:00:00.000Z'),
      nextPage: 2,
      pagesFetched: 1,
      recordsFetched: 1,
      recordsUpserted: 1,
      recordsInactivated: 0,
    };

    await expect(storage.updateRunProgress(run)).rejects.toMatchObject({
      code: 'dynadot_stale_continuation',
    });
    await expect(
      storage.completeRun(run, {
        pagesFetched: 1,
        recordsFetched: 1,
        recordsUpserted: 1,
        recordsInactivated: 0,
        status: 'failed',
        completedAt: new Date('2026-07-13T00:01:00.000Z'),
        errorCode: 'dynadot_sync_failed',
      }),
    ).rejects.toMatchObject({ code: 'dynadot_stale_continuation' });
  });

  it('does not load a completed, failed, other-provider, or missing run', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        })),
      })),
    } as unknown as AppDatabase;

    await expect(
      createDynadotD1Storage(db).loadRunningRun(7),
    ).rejects.toMatchObject({ code: 'dynadot_stale_continuation' });
  });

  it('atomically guards domain and listing upserts against a stale run', async () => {
    const preparedSql: string[] = [];
    const client = {
      prepare: vi.fn((statement: string) => {
        preparedSql.push(statement);
        return { bind: vi.fn(() => ({ statement })) };
      }),
      batch: vi.fn(async (statements: unknown[]) =>
        statements.map(() => ({ meta: { changes: 0 }, results: [] })),
      ),
    };
    const db = { $client: client } as unknown as AppDatabase;
    const run = {
      runId: 7,
      startedAt: new Date('2026-07-13T00:00:00.000Z'),
      nextPage: 1,
      pagesFetched: 0,
      recordsFetched: 0,
      recordsUpserted: 0,
      recordsInactivated: 0,
    };
    const item: DynadotListing = {
      provider: 'dynadot',
      externalId: 'fixture',
      domainName: 'fixture.example',
      auctionUrl: 'https://www.dynadot.com/market/auction/fixture.example',
      auctionType: 'EXPIRED',
      currency: 'USD',
      currentBidCents: 100,
      bidCount: 0,
      bidderCount: 0,
      startsAt: null,
      endsAt: new Date('2026-08-01T00:00:00.000Z'),
      ageYears: null,
      inboundLinks: null,
      visitors: null,
      dynadotAppraisalCents: null,
      renewalPriceCents: null,
    };

    await expect(
      createDynadotD1Storage(db).upsertListings(run, [item]),
    ).rejects.toMatchObject({ code: 'dynadot_stale_continuation' });
    expect(client.batch).toHaveBeenCalledTimes(1);
    expect(preparedSql).toHaveLength(2);
    expect(preparedSql.every((sql) => sql.includes('WHERE EXISTS'))).toBe(true);

    client.batch.mockImplementationOnce(async (statements: unknown[]) =>
      statements.map((_statement, index) => ({
        meta: { changes: index },
        results: [],
      })),
    );
    await expect(
      createDynadotD1Storage(db).upsertListings(run, [item]),
    ).resolves.toBeUndefined();
  });
});
