// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GODADDY_FEED_ENTRY, GODADDY_FEED_URL } from '../providers/godaddy';
import type { AuctionProvider, NormalizedListing } from '../providers/types';
import type { FeedPageBucket } from './feed-pages';
import {
  CLEANUP_STEP,
  fixedErrorCode,
  runProviderSync,
  scheduleProviderSyncs,
  STAGE_STEP,
  SYNC_STEP,
  type StepConfig,
  type SyncWorkerEnv,
} from './provider-sync-workflow';
import type { IngestionStorage, RunState } from './sync';
import { buildZipFixture } from './zip-fixture';

afterEach(() => {
  vi.unstubAllGlobals();
});

function nonRetryableError(code: string) {
  return Object.assign(new Error(code), { name: 'NonRetryableError' });
}

// Runs each step once, recording its name and configuration. Like local
// Workflows (observed with Wrangler 4.110), a step that throws a
// NonRetryableError rejects with `NonRetryableError: <message>`.
function stepRunner() {
  const steps: { name: string; config: StepConfig }[] = [];
  return {
    steps,
    names: () => steps.map((step) => step.name),
    runner: {
      async do<T>(
        name: string,
        config: StepConfig,
        callback: () => Promise<T>,
      ) {
        steps.push({ name, config });
        try {
          return await callback();
        } catch (error) {
          if (error instanceof Error && error.name === 'NonRetryableError') {
            throw new Error(`NonRetryableError: ${error.message}`);
          }
          throw error;
        }
      },
    },
  };
}

function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket: FeedPageBucket = {
    async put(key, value) {
      objects.set(key, value.slice());
    },
    async get(key) {
      const value = objects.get(key);
      return value
        ? {
            size: value.byteLength,
            text: async () => new TextDecoder().decode(value),
            body: new ReadableStream(),
          }
        : null;
    },
    async list({ prefix, limit }) {
      return {
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .slice(0, limit)
          .map((key) => ({ key })),
      };
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
  return { bucket, objects };
}

// Minimal storage that keeps one provider's run and listings in memory.
function memoryStorage(provider: AuctionProvider) {
  const listings = new Map<string, NormalizedListing>();
  let run: RunState | null = null;
  const failures: string[] = [];
  const storage: IngestionStorage = {
    provider,
    async startRun(startedAt) {
      run = {
        runId: (run?.runId ?? 0) + 1,
        startedAt,
        nextPage: 1,
        pagesFetched: 0,
        recordsFetched: 0,
        recordsUpserted: 0,
        recordsInactivated: 0,
        recordsRejected: 0,
      };
      return { ...run };
    },
    async loadRunningRun(runId) {
      if (!run || run.runId !== runId) throw new Error('no run');
      return { ...run };
    },
    async upsertListings(_run, page) {
      for (const listing of page) listings.set(listing.externalId, listing);
    },
    async finalizeSuccessfulRun() {
      return 0;
    },
    async updateRunProgress(next) {
      run = { ...next };
    },
    async completeRun(_run, completion) {
      failures.push(completion.errorCode);
    },
  };
  return { storage, listings, failures };
}

function godaddyRecord(index: number) {
  return {
    domainName: `invented-${index}.example`,
    link: `https://www.godaddy.com/domain-auctions/invented-${index}-example-${index + 1}`,
    auctionType: 'Bid',
    auctionEndTime: '2026-10-09T16:00:00Z',
    price: '$12',
    numberOfBids: 1,
  };
}

async function feedZip(records: unknown[]) {
  return buildZipFixture(JSON.stringify({ meta: {}, data: records }), {
    entry: GODADDY_FEED_ENTRY,
  });
}

function setup({
  zip,
  env = {},
  bucket = memoryBucket(),
}: {
  zip?: Uint8Array;
  env?: Partial<SyncWorkerEnv>;
  bucket?: ReturnType<typeof memoryBucket>;
}) {
  const steps = stepRunner();
  const stores = new Map<AuctionProvider, ReturnType<typeof memoryStorage>>();
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    zip ? new Response(zip as BodyInit) : new Response(null, { status: 403 }),
  );
  const nonRetryable = vi.fn(nonRetryableError);
  const run = (provider: string, runKey = 'godaddy-test-1') =>
    runProviderSync({
      provider,
      runKey,
      env: {
        DB: {} as D1Database,
        FEED_PAGES: bucket.bucket as unknown as R2Bucket,
        ...env,
      },
      step: steps.runner,
      nonRetryable,
      dependencies: {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createStorage: (_database, provider) => {
          const store = memoryStorage(provider);
          stores.set(provider, store);
          return store.storage;
        },
      },
    });
  return { run, steps, stores, fetchImpl, nonRetryable, bucket };
}

describe('provider sync workflow', () => {
  it('stages a file feed, syncs it in segments, and deletes the pages', async () => {
    const records = Array.from({ length: 20_500 }, (_, index) =>
      godaddyRecord(index),
    );
    const { run, steps, stores, fetchImpl, bucket } = setup({
      zip: await feedZip(records),
    });

    await expect(run('godaddy')).resolves.toEqual({
      provider: 'godaddy',
      status: 'succeeded',
      pagesFetched: 21,
      recordsFetched: 20_500,
      recordsUpserted: 20_500,
      recordsInactivated: 0,
      recordsRejected: 0,
    });
    expect(steps.names()).toEqual([
      'stage feed',
      'sync pages, segment 1',
      'sync pages, segment 2',
      'delete staged pages',
    ]);
    expect(steps.steps.map((step) => step.config)).toEqual([
      STAGE_STEP,
      SYNC_STEP,
      SYNC_STEP,
      CLEANUP_STEP,
    ]);
    expect(fetchImpl.mock.calls[0]![0]).toBe(GODADDY_FEED_URL);
    expect(stores.get('godaddy')!.listings.size).toBe(20_500);
    expect(bucket.objects.size).toBe(0);
  });

  it('fails unknown providers and missing credentials before any step', async () => {
    const { run, steps } = setup({});
    await expect(run('sedo')).rejects.toThrow('sync_unknown_provider');
    await expect(run('dynadot')).rejects.toThrow('dynadot_missing_credentials');
    expect(steps.names()).toEqual([]);
  });

  it('runs an API provider without staging and reports its failure code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { run, steps, stores, nonRetryable } = setup({
      env: { DYNADOT_API_PRODUCTION_KEY: 'invented-test-key' },
    });
    await expect(run('dynadot')).rejects.toThrow('dynadot_network_error');
    expect(steps.names()).toEqual(['sync pages, segment 1']);
    expect(nonRetryable).toHaveBeenCalledWith('dynadot_network_error');
    expect(stores.get('dynadot')!.failures).toEqual(['dynadot_network_error']);
  });

  it('retries download failures but not malformed feeds, and still cleans up', async () => {
    const failed = setup({});
    await expect(failed.run('godaddy')).rejects.toThrow('feed_download_failed');
    expect(failed.nonRetryable).not.toHaveBeenCalled();
    expect(failed.steps.names()).toEqual(['stage feed', 'delete staged pages']);

    const empty = setup({ zip: await feedZip([]) });
    await expect(empty.run('godaddy')).rejects.toThrow('feed_empty');
    expect(empty.nonRetryable).toHaveBeenCalledWith('feed_empty');

    const bucket = memoryBucket();
    bucket.bucket.put = async () => {
      throw new Error('R2 unavailable');
    };
    const unwritable = setup({
      zip: await feedZip([godaddyRecord(1)]),
      bucket,
    });
    await expect(unwritable.run('godaddy')).rejects.toThrow(
      'feed_stage_failed',
    );
  });

  it('records a sync failure on the run and deletes the staged pages', async () => {
    const records = Array.from({ length: 10 }, (_, index) =>
      index < 3
        ? { ...godaddyRecord(index), price: 'invalid' }
        : godaddyRecord(index),
    );
    const { run, steps, stores, nonRetryable, bucket } = setup({
      zip: await feedZip(records),
    });
    await expect(run('godaddy')).rejects.toThrow('godaddy_response_error');
    expect(nonRetryable).toHaveBeenCalledWith('godaddy_response_error');
    expect(stores.get('godaddy')!.failures).toEqual(['godaddy_response_error']);
    expect(steps.names().at(-1)).toBe('delete staged pages');
    expect(bucket.objects.size).toBe(0);
  });

  it('rejects a run key that could escape the staging prefix', async () => {
    const { run, nonRetryable } = setup({
      zip: await feedZip([godaddyRecord(1)]),
    });
    await expect(run('godaddy', 'bad/key')).rejects.toThrow(
      'feed_invalid_run_key',
    );
    expect(nonRetryable).not.toHaveBeenCalled();
  });

  it('reports a cleanup failure only when the sync succeeded', async () => {
    const stuck = () => {
      const bucket = memoryBucket();
      bucket.bucket.delete = async () => undefined;
      return bucket;
    };
    const succeeded = setup({
      zip: await feedZip([godaddyRecord(1)]),
      bucket: stuck(),
    });
    await expect(succeeded.run('godaddy')).rejects.toThrow(
      'feed_cleanup_incomplete',
    );

    const invalid = Array.from({ length: 3 }, (_, index) => ({
      ...godaddyRecord(index),
      price: 'invalid',
    }));
    const failed = setup({ zip: await feedZip(invalid), bucket: stuck() });
    await expect(failed.run('godaddy')).rejects.toThrow(
      'godaddy_response_error',
    );
  });

  it('maps an unexpected storage failure to sync_failed', async () => {
    const steps = stepRunner();
    const nonRetryable = vi.fn(nonRetryableError);
    const result = runProviderSync({
      provider: 'godaddy',
      runKey: 'godaddy-test-2',
      env: {
        DB: {} as D1Database,
        FEED_PAGES: memoryBucket().bucket as unknown as R2Bucket,
      },
      step: steps.runner,
      nonRetryable,
      dependencies: {
        fetchImpl: (async () =>
          new Response(
            (await feedZip([godaddyRecord(1)])) as BodyInit,
          )) as unknown as typeof fetch,
        createStorage: () => ({
          ...memoryStorage('godaddy').storage,
          startRun: async () => {
            throw new Error('D1 unavailable');
          },
        }),
      },
    });
    await expect(result).rejects.toThrow('sync_failed');
    expect(nonRetryable).toHaveBeenCalledWith('sync_failed');
  });

  it('accepts only fixed codes as instance errors', () => {
    expect(fixedErrorCode(new Error('sync_reconciliation_guard'))).toBe(
      'sync_reconciliation_guard',
    );
    expect(
      fixedErrorCode(new Error('NonRetryableError: godaddy_response_error')),
    ).toBe('godaddy_response_error');
    expect(
      fixedErrorCode(new Error('NonRetryableError: no such table: x_y')),
    ).toBe('sync_failed');
    expect(fixedErrorCode(new Error('https://x.example/?key=secret'))).toBe(
      'sync_failed',
    );
    expect(fixedErrorCode('feed_empty')).toBe('sync_failed');
  });
});

describe('scheduled provider syncs', () => {
  it('starts one instance per provider, named by the scheduled time', async () => {
    const create = vi.fn(async () => ({}) as WorkflowInstance);
    await expect(
      scheduleProviderSyncs({ create }, new Date('2026-10-06T15:30:00.000Z')),
    ).resolves.toEqual(['dynadot', 'godaddy']);
    expect(create.mock.calls).toEqual([
      [{ id: 'dynadot-20261006T1530', params: { provider: 'dynadot' } }],
      [{ id: 'godaddy-20261006T1530', params: { provider: 'godaddy' } }],
    ]);
  });

  it('still starts the other providers when one creation fails', async () => {
    const create = vi.fn(async (options?: { id?: string }) => {
      if (options?.id?.startsWith('dynadot')) throw new Error('duplicate');
      return {} as WorkflowInstance;
    });
    await expect(
      scheduleProviderSyncs({ create }, new Date('2026-10-06T15:30:00.000Z')),
    ).rejects.toThrow('sync_schedule_failed');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
