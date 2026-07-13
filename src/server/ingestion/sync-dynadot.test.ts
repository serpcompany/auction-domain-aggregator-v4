import { describe, expect, it, vi } from 'vitest';

import type { DynadotListing } from '../providers/dynadot';
import {
  DynadotSyncError,
  runDynadotSegment,
  syncDynadotWithStorage,
  type DynadotIngestionStorage,
  type DynadotRunCompletion,
  type DynadotRunState,
  type DynadotSuccessfulRunFinalization,
  type RunCounters,
} from './sync-dynadot';

function listing(
  externalId: string,
  domainName: string,
  currentBidCents = 100,
): DynadotListing {
  return {
    provider: 'dynadot',
    externalId,
    domainName,
    auctionUrl: `https://www.dynadot.com/market/auction/${domainName}`,
    auctionType: 'EXPIRED',
    currency: 'USD',
    currentBidCents,
    bidCount: 1,
    bidderCount: 1,
    startsAt: null,
    endsAt: new Date('2026-08-01T00:00:00.000Z'),
    ageYears: null,
    inboundLinks: null,
    visitors: null,
    dynadotAppraisalCents: null,
    renewalPriceCents: null,
  };
}

type StoredListing = DynadotListing & {
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: 'active' | 'inactive';
};

class MemoryStorage implements DynadotIngestionStorage {
  readonly domains = new Map<string, Date>();
  readonly listings = new Map<string, StoredListing>();
  readonly completions: Array<
    RunCounters & {
      status: 'succeeded' | 'failed';
      completedAt: Date;
      errorCode: string | null;
    }
  > = [];
  readonly progress: RunCounters[] = [];
  readonly running = new Map<number, DynadotRunState>();
  runCount = 0;
  staleRunningRuns = 0;
  interruptedRuns = 0;

  async startRun(startedAt: Date) {
    this.interruptedRuns += this.staleRunningRuns + this.running.size;
    this.staleRunningRuns = 0;
    this.running.clear();
    this.runCount += 1;
    const run = {
      runId: this.runCount,
      startedAt,
      nextPage: 1,
      pagesFetched: 0,
      recordsFetched: 0,
      recordsUpserted: 0,
      recordsInactivated: 0,
    };
    this.running.set(run.runId, run);
    return { ...run };
  }

  async loadRunningRun(runId: number) {
    const run = this.running.get(runId);
    if (!run) throw new DynadotSyncError('dynadot_stale_continuation');
    return { ...run };
  }

  async upsertListings(run: DynadotRunState, items: DynadotListing[]) {
    if (!this.running.has(run.runId)) {
      throw new DynadotSyncError('dynadot_stale_continuation');
    }
    for (const item of items) {
      if (!this.domains.has(item.domainName)) {
        this.domains.set(item.domainName, run.startedAt);
      }
      const previous = this.listings.get(item.externalId);
      this.listings.set(item.externalId, {
        ...item,
        firstSeenAt: previous?.firstSeenAt ?? run.startedAt,
        lastSeenAt: run.startedAt,
        status: 'active',
      });
    }
  }

  async finalizeSuccessfulRun(
    run: DynadotRunState,
    finalization: DynadotSuccessfulRunFinalization,
  ) {
    if (!this.running.has(run.runId)) {
      throw new DynadotSyncError('dynadot_stale_continuation');
    }
    const targets = [...this.listings].filter(
      ([, item]) => item.status === 'active' && item.lastSeenAt < run.startedAt,
    );
    for (const [id, item] of targets) {
      this.listings.set(id, { ...item, status: 'inactive' });
    }
    this.completions.push({
      ...finalization,
      recordsInactivated: targets.length,
      status: 'succeeded',
      errorCode: null,
    });
    this.running.delete(run.runId);
    return targets.length;
  }

  async updateRunProgress(run: DynadotRunState) {
    if (!this.running.has(run.runId)) {
      throw new DynadotSyncError('dynadot_stale_continuation');
    }
    this.running.set(run.runId, { ...run });
    this.progress.push({ ...run });
  }

  async completeRun(run: DynadotRunState, completion: DynadotRunCompletion) {
    if (!this.running.has(run.runId)) {
      throw new DynadotSyncError('dynadot_stale_continuation');
    }
    this.completions.push(completion);
    this.running.delete(run.runId);
  }
}

function clock(...dates: string[]) {
  let index = 0;
  return () => new Date(dates[index++]!);
}

describe('syncDynadotWithStorage', () => {
  it('segments progress and reconciles only after the final short page', async () => {
    const storage = new MemoryStorage();
    const old = listing('old', 'old.example');
    storage.listings.set('old', {
      ...old,
      firstSeenAt: new Date('2026-07-12T00:00:00.000Z'),
      lastSeenAt: new Date('2026-07-12T00:00:00.000Z'),
      status: 'active',
    });
    storage.staleRunningRuns = 2;

    const firstSegment = await runDynadotSegment(storage, {
      pageSize: 1,
      segmentPages: 1,
      fetchPage: async () => [listing('current', 'current.example')],
      clock: clock('2026-07-13T00:00:00.000Z'),
    });

    expect(firstSegment.done).toBe(false);
    expect(storage.progress).toEqual([
      expect.objectContaining({ pagesFetched: 1, recordsFetched: 1 }),
    ]);
    expect(storage.completions).toHaveLength(0);
    expect(storage.listings.get('old')?.status).toBe('active');
    expect(storage.interruptedRuns).toBe(2);

    const run = (firstSegment as { done: false; run: DynadotRunState }).run;
    const finalSegment = await runDynadotSegment(storage, {
      pageSize: 1,
      segmentPages: 1,
      runId: run.runId,
      fetchPage: async () => [],
      clock: clock('2026-07-13T00:01:00.000Z'),
    });

    expect(finalSegment).toMatchObject({
      done: true,
      summary: {
        status: 'succeeded',
        pagesFetched: 2,
        recordsFetched: 1,
        recordsInactivated: 1,
      },
    });
    expect(storage.listings.get('old')?.status).toBe('inactive');
  });

  it('marks a continued segment failed without reconciliation', async () => {
    const storage = new MemoryStorage();
    const firstSegment = await runDynadotSegment(storage, {
      pageSize: 1,
      segmentPages: 1,
      fetchPage: async () => [listing('current', 'current.example')],
      clock: clock('2026-07-13T00:00:00.000Z'),
    });
    const run = (firstSegment as { done: false; run: DynadotRunState }).run;

    await expect(
      runDynadotSegment(storage, {
        pageSize: 1,
        segmentPages: 1,
        runId: run.runId,
        fetchPage: async () => {
          throw new Error('provider internals');
        },
        clock: clock('2026-07-13T00:01:00.000Z'),
      }),
    ).rejects.toEqual(new DynadotSyncError('dynadot_sync_failed'));

    expect(storage.completions.at(-1)).toMatchObject({
      status: 'failed',
      pagesFetched: 1,
      recordsFetched: 1,
      recordsInactivated: 0,
    });
  });

  it('rejects forged and completed run ids without fetching', async () => {
    const storage = new MemoryStorage();
    const fetchPage = vi.fn(async () => []);

    await expect(
      runDynadotSegment(storage, { runId: 999, fetchPage }),
    ).rejects.toMatchObject({ code: 'dynadot_stale_continuation' });

    const completed = await runDynadotSegment(storage, { fetchPage });
    expect(completed.done).toBe(true);
    await expect(
      runDynadotSegment(storage, { runId: 1, fetchPage }),
    ).rejects.toMatchObject({ code: 'dynadot_stale_continuation' });
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('surfaces a stale zero-change progress transition', async () => {
    const storage = new MemoryStorage();
    storage.updateRunProgress = async () => {
      throw new DynadotSyncError('dynadot_stale_continuation');
    };

    await expect(
      runDynadotSegment(storage, {
        pageSize: 1,
        segmentPages: 1,
        fetchPage: async () => [listing('current', 'current.example')],
      }),
    ).rejects.toMatchObject({ code: 'dynadot_stale_continuation' });
    expect(storage.completions).toHaveLength(0);
  });

  it('rejects stale in-flight writes when another run interrupts after fetch', async () => {
    const storage = new MemoryStorage();

    await expect(
      runDynadotSegment(storage, {
        pageSize: 1,
        fetchPage: async () => {
          storage.running.clear();
          return [listing('stale', 'stale.example', 999)];
        },
      }),
    ).rejects.toMatchObject({ code: 'dynadot_stale_continuation' });

    expect(storage.domains).toHaveLength(0);
    expect(storage.listings).toHaveLength(0);
    expect(storage.completions).toHaveLength(0);
  });

  it('rejects malformed server-owned run state', async () => {
    const storage = new MemoryStorage();
    storage.loadRunningRun = vi.fn(async () => ({
      runId: 1,
      startedAt: new Date('2026-07-13T00:00:00.000Z'),
      nextPage: 0,
      pagesFetched: 0,
      recordsFetched: 0,
      recordsUpserted: 0,
      recordsInactivated: 0,
    }));
    await expect(
      runDynadotSegment(storage, {
        runId: 1,
        fetchPage: async () => [],
      }),
    ).rejects.toMatchObject({ code: 'dynadot_stale_continuation' });
  });

  it('keeps listings active and marks the run failed when atomic finalization fails', async () => {
    const storage = new MemoryStorage();
    const old = listing('old', 'old.example');
    storage.listings.set('old', {
      ...old,
      firstSeenAt: new Date('2026-07-12T00:00:00.000Z'),
      lastSeenAt: new Date('2026-07-12T00:00:00.000Z'),
      status: 'active',
    });
    storage.finalizeSuccessfulRun = async () => {
      throw new Error('atomic batch failed');
    };

    await expect(
      syncDynadotWithStorage(storage, {
        pageSize: 1,
        fetchPage: async () => [],
        clock: clock(
          '2026-07-13T00:00:00.000Z',
          '2026-07-13T00:01:00.000Z',
          '2026-07-13T00:02:00.000Z',
        ),
      }),
    ).rejects.toEqual(new DynadotSyncError('dynadot_sync_failed'));

    expect(storage.listings.get('old')?.status).toBe('active');
    expect(storage.completions.at(-1)).toMatchObject({
      status: 'failed',
      errorCode: 'dynadot_sync_failed',
      recordsInactivated: 0,
    });
  });

  it('is idempotent, preserves first seen, and updates mutable fields', async () => {
    const storage = new MemoryStorage();
    const first = listing('first', 'first.example');
    const second = listing('second', 'second.example');

    const initial = await syncDynadotWithStorage(storage, {
      pageSize: 2,
      fetchPage: async ({ pageIndex }) =>
        pageIndex === 1 ? [first, second] : [],
      clock: clock('2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z'),
    });
    const originalFirstSeen = storage.listings.get('first')?.firstSeenAt;

    const repeated = await syncDynadotWithStorage(storage, {
      pageSize: 2,
      fetchPage: async ({ pageIndex }) =>
        pageIndex === 1 ? [{ ...first, currentBidCents: 250 }, second] : [],
      clock: clock('2026-07-13T01:00:00.000Z', '2026-07-13T01:01:00.000Z'),
    });

    expect(initial).toEqual({
      provider: 'dynadot',
      status: 'succeeded',
      pagesFetched: 2,
      recordsFetched: 2,
      recordsUpserted: 2,
      recordsInactivated: 0,
    });
    expect(repeated).toEqual(initial);
    expect(storage.domains).toHaveLength(2);
    expect(storage.listings).toHaveLength(2);
    expect(storage.listings.get('first')).toMatchObject({
      currentBidCents: 250,
      firstSeenAt: originalFirstSeen,
      lastSeenAt: new Date('2026-07-13T01:00:00.000Z'),
      status: 'active',
    });
  });

  it('does not reconcile after a partial failure, then reconciles after success', async () => {
    const storage = new MemoryStorage();
    const first = listing('first', 'first.example');
    const second = listing('second', 'second.example');

    await syncDynadotWithStorage(storage, {
      pageSize: 2,
      fetchPage: async ({ pageIndex }) =>
        pageIndex === 1 ? [first, second] : [],
      clock: clock('2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z'),
    });

    await expect(
      syncDynadotWithStorage(storage, {
        pageSize: 1,
        fetchPage: async ({ pageIndex }) => {
          if (pageIndex === 1) return [first];
          throw new Error('raw provider details');
        },
        clock: clock('2026-07-13T01:00:00.000Z', '2026-07-13T01:01:00.000Z'),
      }),
    ).rejects.toEqual(new DynadotSyncError('dynadot_sync_failed'));

    expect(storage.listings.get('second')?.status).toBe('active');
    expect(storage.completions.at(-1)).toMatchObject({
      status: 'failed',
      errorCode: 'dynadot_sync_failed',
      pagesFetched: 1,
      recordsFetched: 1,
      recordsUpserted: 1,
      recordsInactivated: 0,
    });

    const recovered = await syncDynadotWithStorage(storage, {
      pageSize: 2,
      fetchPage: async () => [first],
      clock: clock('2026-07-13T02:00:00.000Z', '2026-07-13T02:01:00.000Z'),
    });

    expect(recovered.recordsInactivated).toBe(1);
    expect(storage.listings.get('second')?.status).toBe('inactive');
  });

  it('fails without reconciliation when the page safeguard is exhausted', async () => {
    const storage = new MemoryStorage();

    await expect(
      syncDynadotWithStorage(storage, {
        pageSize: 1,
        maxPages: 1,
        fetchPage: async () => [listing('first', 'first.example')],
        clock: clock('2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'dynadot_page_limit_exceeded',
      message: 'dynadot_page_limit_exceeded',
    });

    expect(storage.completions).toEqual([
      expect.objectContaining({
        status: 'failed',
        errorCode: 'dynadot_page_limit_exceeded',
        pagesFetched: 1,
      }),
    ]);
  });

  it.each([
    { pageSize: 0, maxPages: 1 },
    { pageSize: 1001, maxPages: 1 },
    { pageSize: 1, maxPages: 0 },
    { pageSize: 1, maxPages: 1001 },
  ])(
    'rejects invalid service bounds before starting a run: %o',
    async (input) => {
      const storage = new MemoryStorage();
      await expect(
        syncDynadotWithStorage(storage, {
          ...input,
          fetchPage: async () => [],
        }),
      ).rejects.toMatchObject({ code: 'dynadot_sync_invalid_request' });
      expect(storage.runCount).toBe(0);
    },
  );

  it('uses default bounds and clock', async () => {
    const storage = new MemoryStorage();
    const summary = await syncDynadotWithStorage(storage, {
      fetchPage: async ({ pageIndex, pageSize }) => {
        expect({ pageIndex, pageSize }).toEqual({
          pageIndex: 1,
          pageSize: 1000,
        });
        return [];
      },
    });

    expect(summary.pagesFetched).toBe(1);
  });

  it('accepts maxPages 1000', async () => {
    const storage = new MemoryStorage();
    await expect(
      syncDynadotWithStorage(storage, {
        maxPages: 1000,
        fetchPage: async () => [],
      }),
    ).resolves.toMatchObject({ status: 'succeeded', pagesFetched: 1 });
  });

  it('continues the full-service wrapper across internal segments', async () => {
    const storage = new MemoryStorage();
    const summary = await syncDynadotWithStorage(storage, {
      pageSize: 1,
      maxPages: 25,
      fetchPage: async ({ pageIndex }) =>
        pageIndex <= 20 ? [listing('current', 'current.example')] : [],
    });

    expect(summary).toMatchObject({
      status: 'succeeded',
      pagesFetched: 21,
      recordsFetched: 20,
    });
    expect(storage.progress).toHaveLength(1);
  });

  it('keeps the outward error sanitized if failure recording also fails', async () => {
    const storage = new MemoryStorage();
    storage.completeRun = async () => {
      throw new Error('database internals');
    };

    await expect(
      syncDynadotWithStorage(storage, {
        fetchPage: async () => {
          throw new Error('provider internals');
        },
      }),
    ).rejects.toEqual(new DynadotSyncError('dynadot_sync_failed'));
  });
});
