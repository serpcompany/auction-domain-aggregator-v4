import { describe, expect, it, vi } from 'vitest'

import { type DynadotListing, DynadotProviderError } from '../providers/dynadot'
import type { NormalizedListing, ProviderAdapter, ProviderPage } from '../providers/types'
import {
  failSyncRun,
  type IngestionStorage,
  type RunCompletion,
  type RunCounters,
  type RunState,
  runSyncSegment,
  type SuccessfulRunFinalization,
  SyncError,
  type SyncSegmentOptions,
  type SyncSummary
} from './sync'

// Test fixtures describe pages as bare arrays or counted pages for a given
// page size; this adapter derives `isLastPage` the way Dynadot does.
type TestFetchPage = (input: {
  pageIndex: number
  pageSize: number
}) => Promise<Omit<ProviderPage, 'isLastPage'> | NormalizedListing[]>

type TestSyncOptions = SyncSegmentOptions & {
  fetchPage: TestFetchPage
  pageSize?: number
}

function testAdapter(fetchPage: TestFetchPage, pageSize = 1000): ProviderAdapter {
  return {
    provider: 'dynadot',
    async fetchPage({ pageIndex }) {
      const result = await fetchPage({ pageIndex, pageSize })
      const page = Array.isArray(result)
        ? { listings: result, received: result.length, rejected: 0 }
        : result
      return { ...page, isLastPage: page.received < pageSize }
    }
  }
}

function runSegment(
  storage: IngestionStorage,
  { fetchPage, pageSize, ...options }: TestSyncOptions
) {
  return runSyncSegment(testAdapter(fetchPage, pageSize), storage, options)
}

async function syncWithStorage(
  storage: IngestionStorage,
  options: TestSyncOptions
): Promise<SyncSummary> {
  let runId: number | undefined
  while (true) {
    const result = await runSegment(storage, {
      ...options,
      runId,
      segmentPages: Math.min(options.maxPages ?? 1000, 20)
    })
    if (result.done) return result.summary
    runId = result.run.runId
  }
}

function listing(externalId: string, domainName: string, currentBidCents = 100): DynadotListing {
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
    appraisalCents: null,
    renewalPriceCents: null
  }
}

type StoredListing = DynadotListing & {
  firstSeenAt: Date
  lastSeenAt: Date
  status: 'active' | 'inactive'
}

class MemoryStorage implements IngestionStorage {
  readonly provider = 'dynadot' as const
  readonly domains = new Map<string, Date>()
  readonly listings = new Map<string, StoredListing>()
  readonly completions: Array<
    RunCounters & {
      status: 'succeeded' | 'failed'
      completedAt: Date
      errorCode: string | null
    }
  > = []
  readonly progress: RunCounters[] = []
  readonly running = new Map<number, RunState>()
  runCount = 0
  staleRunningRuns = 0
  interruptedRuns = 0

  async startRun(startedAt: Date) {
    this.interruptedRuns += this.staleRunningRuns + this.running.size
    this.staleRunningRuns = 0
    this.running.clear()
    this.runCount += 1
    const run = {
      runId: this.runCount,
      startedAt,
      nextPage: 1,
      pagesFetched: 0,
      recordsFetched: 0,
      recordsUpserted: 0,
      recordsInactivated: 0,
      recordsRejected: 0
    }
    this.running.set(run.runId, run)
    return { ...run }
  }

  async loadRunningRun(runId: number) {
    const run = this.running.get(runId)
    if (!run) throw new SyncError('sync_stale_continuation')
    return { ...run }
  }

  async upsertListings(run: RunState, items: DynadotListing[]) {
    if (!this.running.has(run.runId)) {
      throw new SyncError('sync_stale_continuation')
    }
    for (const item of items) {
      if (!this.domains.has(item.domainName)) {
        this.domains.set(item.domainName, run.startedAt)
      }
      const previous = this.listings.get(item.externalId)
      this.listings.set(item.externalId, {
        ...item,
        firstSeenAt: previous?.firstSeenAt ?? run.startedAt,
        lastSeenAt: run.startedAt,
        status: 'active'
      })
    }
  }

  async finalizeSuccessfulRun(run: RunState, finalization: SuccessfulRunFinalization) {
    if (!this.running.has(run.runId)) {
      throw new SyncError('sync_stale_continuation')
    }
    const targets = [...this.listings].filter(
      ([, item]) => item.status === 'active' && item.lastSeenAt < run.startedAt
    )
    for (const [id, item] of targets) {
      this.listings.set(id, { ...item, status: 'inactive' })
    }
    this.completions.push({
      ...finalization,
      recordsInactivated: targets.length,
      status: 'succeeded',
      errorCode: null
    })
    this.running.delete(run.runId)
    return targets.length
  }

  async updateRunProgress(run: RunState) {
    if (!this.running.has(run.runId)) {
      throw new SyncError('sync_stale_continuation')
    }
    this.running.set(run.runId, { ...run })
    this.progress.push({ ...run })
  }

  async completeRun(run: RunState, completion: RunCompletion) {
    if (!this.running.has(run.runId)) {
      throw new SyncError('sync_stale_continuation')
    }
    this.completions.push(completion)
    this.running.delete(run.runId)
  }
}

function clock(...dates: string[]) {
  let index = 0
  return () => new Date(dates[index++]!)
}

describe('syncDynadotWithStorage', () => {
  it('segments progress and reconciles only after the final short page', async () => {
    const storage = new MemoryStorage()
    const old = listing('old', 'old.example')
    storage.listings.set('old', {
      ...old,
      firstSeenAt: new Date('2026-07-12T00:00:00.000Z'),
      lastSeenAt: new Date('2026-07-12T00:00:00.000Z'),
      status: 'active'
    })
    storage.staleRunningRuns = 2

    const firstSegment = await runSegment(storage, {
      pageSize: 1,
      segmentPages: 1,
      fetchPage: async () => [listing('current', 'current.example')],
      clock: clock('2026-07-13T00:00:00.000Z')
    })

    expect(firstSegment.done).toBe(false)
    expect(storage.progress).toEqual([
      expect.objectContaining({ pagesFetched: 1, recordsFetched: 1 })
    ])
    expect(storage.completions).toHaveLength(0)
    expect(storage.listings.get('old')?.status).toBe('active')
    expect(storage.interruptedRuns).toBe(2)

    const run = (firstSegment as { done: false; run: RunState }).run
    const finalSegment = await runSegment(storage, {
      pageSize: 1,
      segmentPages: 1,
      runId: run.runId,
      fetchPage: async () => [],
      clock: clock('2026-07-13T00:01:00.000Z')
    })

    expect(finalSegment).toMatchObject({
      done: true,
      summary: {
        status: 'succeeded',
        pagesFetched: 2,
        recordsFetched: 1,
        recordsInactivated: 1,
        recordsRejected: 0
      }
    })
    expect(storage.listings.get('old')?.status).toBe('inactive')
  })

  it('marks a continued segment failed without reconciliation', async () => {
    const storage = new MemoryStorage()
    const firstSegment = await runSegment(storage, {
      pageSize: 1,
      segmentPages: 1,
      fetchPage: async () => [listing('current', 'current.example')],
      clock: clock('2026-07-13T00:00:00.000Z')
    })
    const run = (firstSegment as { done: false; run: RunState }).run

    await expect(
      runSegment(storage, {
        pageSize: 1,
        segmentPages: 1,
        runId: run.runId,
        fetchPage: async () => {
          throw new DynadotProviderError('dynadot_response_error')
        },
        clock: clock('2026-07-13T00:01:00.000Z')
      })
    ).rejects.toEqual(new SyncError('dynadot_response_error'))

    expect(storage.completions.at(-1)).toMatchObject({
      status: 'failed',
      pagesFetched: 1,
      recordsFetched: 1,
      recordsInactivated: 0,
      recordsRejected: 0
    })
  })

  it('rejects forged and completed run ids without fetching', async () => {
    const storage = new MemoryStorage()
    const fetchPage = vi.fn(async () => [])

    await expect(runSegment(storage, { runId: 999, fetchPage })).rejects.toMatchObject({
      code: 'sync_stale_continuation'
    })

    const completed = await runSegment(storage, { fetchPage })
    expect(completed.done).toBe(true)
    await expect(runSegment(storage, { runId: 1, fetchPage })).rejects.toMatchObject({
      code: 'sync_stale_continuation'
    })
    expect(fetchPage).toHaveBeenCalledOnce()
  })

  it('surfaces a stale zero-change progress transition', async () => {
    const storage = new MemoryStorage()
    storage.updateRunProgress = async () => {
      throw new SyncError('sync_stale_continuation')
    }

    await expect(
      runSegment(storage, {
        pageSize: 1,
        segmentPages: 1,
        fetchPage: async () => [listing('current', 'current.example')]
      })
    ).rejects.toMatchObject({ code: 'sync_stale_continuation' })
    expect(storage.completions).toHaveLength(0)
  })

  it('rejects stale in-flight writes when another run interrupts after fetch', async () => {
    const storage = new MemoryStorage()

    await expect(
      runSegment(storage, {
        pageSize: 1,
        fetchPage: async () => {
          storage.running.clear()
          return [listing('stale', 'stale.example', 999)]
        }
      })
    ).rejects.toMatchObject({ code: 'sync_stale_continuation' })

    expect(storage.domains).toHaveLength(0)
    expect(storage.listings).toHaveLength(0)
    expect(storage.completions).toHaveLength(0)
  })

  it('rejects malformed server-owned run state', async () => {
    const storage = new MemoryStorage()
    storage.loadRunningRun = vi.fn(async () => ({
      runId: 1,
      startedAt: new Date('2026-07-13T00:00:00.000Z'),
      nextPage: 0,
      pagesFetched: 0,
      recordsFetched: 0,
      recordsUpserted: 0,
      recordsInactivated: 0,
      recordsRejected: 0
    }))
    await expect(
      runSegment(storage, {
        runId: 1,
        fetchPage: async () => []
      })
    ).rejects.toMatchObject({ code: 'sync_stale_continuation' })
  })

  it('keeps listings active and the run running when atomic finalization fails', async () => {
    const storage = new MemoryStorage()
    const old = listing('old', 'old.example')
    storage.listings.set('old', {
      ...old,
      firstSeenAt: new Date('2026-07-12T00:00:00.000Z'),
      lastSeenAt: new Date('2026-07-12T00:00:00.000Z'),
      status: 'active'
    })
    storage.finalizeSuccessfulRun = async () => {
      throw new Error('atomic batch failed')
    }

    await expect(
      syncWithStorage(storage, {
        pageSize: 1,
        fetchPage: async () => [],
        clock: clock(
          '2026-07-13T00:00:00.000Z',
          '2026-07-13T00:01:00.000Z',
          '2026-07-13T00:02:00.000Z'
        )
      })
    ).rejects.toEqual(new SyncError('sync_failed', { transient: true }))

    // A failed D1 batch may succeed when the segment is retried.
    expect(storage.listings.get('old')?.status).toBe('active')
    expect(storage.completions).toEqual([])
  })

  it('uses the received count, not the valid count, to find the final page', async () => {
    const storage = new MemoryStorage()
    const fetchPage = vi.fn(async ({ pageIndex }: { pageIndex: number }) =>
      pageIndex === 1
        ? {
            listings: [listing('valid', 'valid.example')],
            received: 2,
            rejected: 1
          }
        : []
    )

    const summary = await syncWithStorage(storage, {
      pageSize: 2,
      fetchPage,
      clock: clock('2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z')
    })

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(summary).toMatchObject({
      pagesFetched: 2,
      recordsFetched: 2,
      recordsUpserted: 1,
      recordsRejected: 1
    })
    expect(storage.completions.at(-1)).toMatchObject({
      status: 'succeeded',
      recordsRejected: 1
    })
  })

  it('records the provider error code and the failing page', async () => {
    const storage = new MemoryStorage()

    await expect(
      syncWithStorage(storage, {
        pageSize: 1,
        fetchPage: async ({ pageIndex }) => {
          if (pageIndex === 2) {
            throw new DynadotProviderError('dynadot_http_error')
          }
          return [listing(`page-${pageIndex}`, `page-${pageIndex}.example`)]
        },
        clock: clock('2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z')
      })
    ).rejects.toEqual(new SyncError('dynadot_http_error'))

    expect(storage.completions.at(-1)).toMatchObject({
      status: 'failed',
      errorCode: 'dynadot_http_error',
      failedPage: 2,
      pagesFetched: 1
    })
  })

  it('fails the run without inactivating when the reconciliation guard trips', async () => {
    const storage = new MemoryStorage()
    storage.finalizeSuccessfulRun = async () => {
      throw new SyncError('sync_reconciliation_guard')
    }

    await expect(
      syncWithStorage(storage, {
        pageSize: 1,
        fetchPage: async () => [],
        clock: clock('2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z')
      })
    ).rejects.toEqual(new SyncError('sync_reconciliation_guard'))

    expect(storage.completions.at(-1)).toMatchObject({
      status: 'failed',
      errorCode: 'sync_reconciliation_guard',
      failedPage: null
    })
  })

  it('is idempotent, preserves first seen, and updates mutable fields', async () => {
    const storage = new MemoryStorage()
    const first = listing('first', 'first.example')
    const second = listing('second', 'second.example')

    const initial = await syncWithStorage(storage, {
      pageSize: 2,
      fetchPage: async ({ pageIndex }) => (pageIndex === 1 ? [first, second] : []),
      clock: clock('2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z')
    })
    const originalFirstSeen = storage.listings.get('first')?.firstSeenAt

    const repeated = await syncWithStorage(storage, {
      pageSize: 2,
      fetchPage: async ({ pageIndex }) =>
        pageIndex === 1 ? [{ ...first, currentBidCents: 250 }, second] : [],
      clock: clock('2026-07-13T01:00:00.000Z', '2026-07-13T01:01:00.000Z')
    })

    expect(initial).toEqual({
      provider: 'dynadot',
      status: 'succeeded',
      pagesFetched: 2,
      recordsFetched: 2,
      recordsUpserted: 2,
      recordsInactivated: 0,
      recordsRejected: 0
    })
    expect(repeated).toEqual(initial)
    expect(storage.domains).toHaveLength(2)
    expect(storage.listings).toHaveLength(2)
    expect(storage.listings.get('first')).toMatchObject({
      currentBidCents: 250,
      firstSeenAt: originalFirstSeen,
      lastSeenAt: new Date('2026-07-13T01:00:00.000Z'),
      status: 'active'
    })
  })

  it('does not reconcile after a partial failure, then reconciles after success', async () => {
    const storage = new MemoryStorage()
    const first = listing('first', 'first.example')
    const second = listing('second', 'second.example')

    await syncWithStorage(storage, {
      pageSize: 2,
      fetchPage: async ({ pageIndex }) => (pageIndex === 1 ? [first, second] : []),
      clock: clock('2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z')
    })

    await expect(
      syncWithStorage(storage, {
        pageSize: 1,
        fetchPage: async ({ pageIndex }) => {
          if (pageIndex === 1) return [first]
          throw new DynadotProviderError('dynadot_response_error')
        },
        clock: clock('2026-07-13T01:00:00.000Z', '2026-07-13T01:01:00.000Z')
      })
    ).rejects.toEqual(new SyncError('dynadot_response_error'))

    expect(storage.listings.get('second')?.status).toBe('active')
    expect(storage.completions.at(-1)).toMatchObject({
      status: 'failed',
      errorCode: 'dynadot_response_error',
      pagesFetched: 1,
      recordsFetched: 1,
      recordsUpserted: 1,
      recordsInactivated: 0,
      recordsRejected: 0
    })

    const recovered = await syncWithStorage(storage, {
      pageSize: 2,
      fetchPage: async () => [first],
      clock: clock('2026-07-13T02:00:00.000Z', '2026-07-13T02:01:00.000Z')
    })

    expect(recovered.recordsInactivated).toBe(1)
    expect(storage.listings.get('second')?.status).toBe('inactive')
  })

  it('fails without reconciliation when the page safeguard is exhausted', async () => {
    const storage = new MemoryStorage()

    await expect(
      syncWithStorage(storage, {
        pageSize: 1,
        maxPages: 1,
        fetchPage: async () => [listing('first', 'first.example')],
        clock: clock('2026-07-13T00:00:00.000Z', '2026-07-13T00:01:00.000Z')
      })
    ).rejects.toMatchObject({
      code: 'sync_page_limit_exceeded',
      message: 'sync_page_limit_exceeded'
    })

    expect(storage.completions).toEqual([
      expect.objectContaining({
        status: 'failed',
        errorCode: 'sync_page_limit_exceeded',
        pagesFetched: 1
      })
    ])
  })

  it.each([{ maxPages: 0 }, { maxPages: 10_001 }, { maxPages: 1, segmentPages: 0 }])(
    'rejects invalid service bounds before starting a run: %o',
    async input => {
      const storage = new MemoryStorage()
      await expect(
        runSegment(storage, {
          ...input,
          fetchPage: async () => []
        })
      ).rejects.toMatchObject({ code: 'sync_invalid_request' })
      expect(storage.runCount).toBe(0)
    }
  )

  it('rejects an adapter for a different provider than the storage', async () => {
    const storage = new MemoryStorage()
    const adapter: ProviderAdapter = {
      provider: 'dropcatch',
      fetchPage: vi.fn()
    }

    await expect(runSyncSegment(adapter, storage)).rejects.toMatchObject({
      code: 'sync_invalid_request'
    })
    expect(adapter.fetchPage).not.toHaveBeenCalled()
    expect(storage.runCount).toBe(0)
  })

  it('uses default bounds and clock', async () => {
    const storage = new MemoryStorage()
    const summary = await syncWithStorage(storage, {
      fetchPage: async ({ pageIndex, pageSize }) => {
        expect({ pageIndex, pageSize }).toEqual({
          pageIndex: 1,
          pageSize: 1000
        })
        return []
      }
    })

    expect(summary.pagesFetched).toBe(1)
  })

  it('accepts maxPages 1000', async () => {
    const storage = new MemoryStorage()
    await expect(
      syncWithStorage(storage, {
        maxPages: 1000,
        fetchPage: async () => []
      })
    ).resolves.toMatchObject({ status: 'succeeded', pagesFetched: 1 })
  })

  it('continues the full-service wrapper across internal segments', async () => {
    const storage = new MemoryStorage()
    const summary = await syncWithStorage(storage, {
      pageSize: 1,
      maxPages: 25,
      fetchPage: async ({ pageIndex }) =>
        pageIndex <= 20 ? [listing('current', 'current.example')] : []
    })

    expect(summary).toMatchObject({
      status: 'succeeded',
      pagesFetched: 21,
      recordsFetched: 20
    })
    expect(storage.progress).toHaveLength(1)
  })

  it('keeps the outward error sanitized if failure recording also fails', async () => {
    const storage = new MemoryStorage()
    storage.completeRun = async () => {
      throw new Error('database internals')
    }

    await expect(
      syncWithStorage(storage, {
        fetchPage: async () => {
          throw new DynadotProviderError('dynadot_response_error')
        }
      })
    ).rejects.toEqual(new SyncError('dynadot_response_error'))
  })

  it('leaves the run running on a transient failure, so a retry resumes it exactly', async () => {
    const storage = new MemoryStorage()
    const pages = (pageIndex: number) => [listing(`page-${pageIndex}`, `page-${pageIndex}.example`)]
    const first = await runSegment(storage, {
      pageSize: 1,
      segmentPages: 2,
      fetchPage: async ({ pageIndex }) => pages(pageIndex)
    })
    const { runId } = (first as { done: false; run: RunState }).run

    for (const failure of [
      new DynadotProviderError('dynadot_rate_limited', { transient: true }),
      new Error('D1 batch failed')
    ]) {
      await expect(
        runSegment(storage, {
          pageSize: 1,
          segmentPages: 2,
          runId,
          fetchPage: async ({ pageIndex }) => {
            if (pageIndex === 4) throw failure
            return pages(pageIndex)
          }
        })
      ).rejects.toMatchObject({ transient: true })
    }
    expect(storage.completions).toEqual([])

    // The retry resumes after the committed pages 1 and 2. Page 3 was
    // fetched three times and page 4 twice; each is counted once.
    const resumed = await runSegment(storage, {
      pageSize: 1,
      segmentPages: 10,
      runId,
      fetchPage: async ({ pageIndex }) => {
        if (pageIndex <= 2) throw new Error('committed page fetched again')
        return pageIndex <= 4 ? pages(pageIndex) : []
      }
    })
    expect(resumed).toMatchObject({
      done: true,
      summary: { pagesFetched: 5, recordsFetched: 4, recordsUpserted: 4 }
    })
  })

  it('records a run whose retries ran out as failed, with its committed counters', async () => {
    const storage = new MemoryStorage()
    const first = await runSegment(storage, {
      pageSize: 1,
      segmentPages: 1,
      fetchPage: async () => [listing('one', 'one.example')]
    })
    const { runId } = (first as { done: false; run: RunState }).run

    await expect(
      failSyncRun(storage, runId, 'dynadot_rate_limited', clock('2026-07-13T03:00:00.000Z'))
    ).resolves.toBe(true)
    expect(storage.completions).toEqual([
      expect.objectContaining({
        status: 'failed',
        errorCode: 'dynadot_rate_limited',
        failedPage: null,
        pagesFetched: 1,
        recordsUpserted: 1,
        completedAt: new Date('2026-07-13T03:00:00.000Z')
      })
    ])
    // Already completed: left alone.
    await expect(failSyncRun(storage, runId, 'dynadot_rate_limited')).resolves.toBe(false)
    expect(storage.completions).toHaveLength(1)

    storage.loadRunningRun = async () => {
      throw new Error('D1 unavailable')
    }
    await expect(failSyncRun(storage, runId, 'sync_failed')).rejects.toThrow('D1 unavailable')
  })
})
