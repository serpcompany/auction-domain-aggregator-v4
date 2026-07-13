import { describe, expect, it, vi } from 'vitest';

import type { DynadotIngestionStorage, DynadotRunState } from './sync-dynadot';
import worker, {
  handleLocalWorkerRequest,
  type IngestionEnv,
} from './local-worker';

function runState(runId = 1): DynadotRunState {
  return {
    runId,
    startedAt: new Date('2026-07-13T00:00:00.000Z'),
    nextPage: 1,
    pagesFetched: 0,
    recordsFetched: 0,
    recordsUpserted: 0,
    recordsInactivated: 0,
  };
}

function storage(): DynadotIngestionStorage {
  return {
    startRun: vi.fn(async () => runState()),
    loadRunningRun: vi.fn(async (runId) => runState(runId)),
    upsertListings: vi.fn(async () => undefined),
    finalizeSuccessfulRun: vi.fn(async () => 0),
    updateRunProgress: vi.fn(async () => undefined),
    completeRun: vi.fn(async () => undefined),
  };
}

const env = {
  DB: {} as D1Database,
  DYNADOT_API_PRODUCTION_KEY: 'invented-key',
} satisfies IngestionEnv;

describe('local ingestion worker', () => {
  it('limits the endpoint path and method', async () => {
    await expect(
      handleLocalWorkerRequest(new Request('http://local/other'), env),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      handleLocalWorkerRequest(new Request('http://local/sync-dynadot'), env),
    ).resolves.toMatchObject({ status: 405 });
    await expect(
      worker.fetch(new Request('http://local/other'), env),
    ).resolves.toMatchObject({ status: 404 });
  });

  it('rejects missing configuration and caller-owned continuation fields', async () => {
    const request = (body: unknown) =>
      new Request('http://local/sync-dynadot', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    await expect(
      handleLocalWorkerRequest(request({}), {
        ...env,
        DYNADOT_API_PRODUCTION_KEY: '',
      }),
    ).resolves.toMatchObject({ status: 500 });
    await expect(
      handleLocalWorkerRequest(request({ runId: 1, nextPage: 99 }), env),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      handleLocalWorkerRequest(request({ runId: 1.5 }), env),
    ).resolves.toMatchObject({ status: 400 });
  });

  it('resumes using only a server-loaded integer run id', async () => {
    const fakeStorage = storage();
    const response = await handleLocalWorkerRequest(
      new Request('http://local/sync-dynadot', {
        method: 'POST',
        body: JSON.stringify({ runId: 7 }),
      }),
      env,
      {
        createStorage: () => fakeStorage,
        fetchPage: async () => [],
      },
    );

    expect(fakeStorage.loadRunningRun).toHaveBeenCalledWith(7);
    expect(await response.json()).toMatchObject({
      provider: 'dynadot',
      status: 'succeeded',
    });
  });

  it('returns only a fixed failure for a stale or forged run', async () => {
    const fakeStorage = storage();
    fakeStorage.loadRunningRun = vi.fn(async () => {
      throw new Error('database details');
    });
    const response = await handleLocalWorkerRequest(
      new Request('http://local/sync-dynadot', {
        method: 'POST',
        body: JSON.stringify({ runId: 999 }),
      }),
      env,
      {
        createStorage: () => fakeStorage,
        fetchPage: async () => [],
      },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      status: 'failed',
      errorCode: 'dynadot_sync_failed',
    });
  });

  it('uses the default adapter and returns server-owned progress', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'success', auction_list: [] })),
    );
    const completed = await handleLocalWorkerRequest(
      new Request('http://local/sync-dynadot', {
        method: 'POST',
        body: '{}',
      }),
      env,
      { createStorage: () => storage() },
    );
    expect(completed.status).toBe(200);
    vi.unstubAllGlobals();

    const fullPage = Array.from({ length: 1000 }, (_, index) => ({
      provider: 'dynadot' as const,
      externalId: String(index),
      domainName: `fixture-${index}.example`,
      auctionUrl: `https://www.dynadot.com/market/auction/fixture-${index}.example`,
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
    }));
    const continued = await handleLocalWorkerRequest(
      new Request('http://local/sync-dynadot', {
        method: 'POST',
        body: '{}',
      }),
      env,
      {
        createStorage: () => storage(),
        fetchPage: async () => fullPage,
      },
    );
    expect(await continued.json()).toMatchObject({
      status: 'continue',
      runId: 1,
      nextPage: 21,
      pagesFetched: 20,
    });
  });

  it('sanitizes malformed request JSON', async () => {
    const response = await handleLocalWorkerRequest(
      new Request('http://local/sync-dynadot', {
        method: 'POST',
        body: '{',
      }),
      env,
    );
    expect(response.status).toBe(500);
  });
});
