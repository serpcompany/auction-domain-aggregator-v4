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

  readonly succeeded = new Map<number, RunCounters>()

  async loadSucceededRun(runId: number) {
    return this.succeeded.get(runId) ?? null
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
    const { completedAt: _, ...counters } = finalization
    this.succeeded.set(run.runId, { ...counters, recordsInactivated: targets.length })
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

  it("rejects a forged run id, and returns a succeeded run's result, without fetching", async () => {
    const storage = new MemoryStorage()
    const fetchPage = vi.fn(async () => [])

    await expect(runSegment(storage, { runId: 999, fetchPage })).rejects.toMatchObject({
      code: 'sync_stale_continuation'
    })

    const completed = await runSegment(storage, { fetchPage })
    expect(completed.done).toBe(true)
    await expect(runSegment(storage, { runId: 1, fetchPage })).resolves.toEqual(completed)
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

    // A failed D1 batch may succeed when the segment is retried. The final
    // page's progress is not committed: the retry must see it again to
    // know the run is complete.
    expect(storage.listings.get('old')?.status).toBe('active')
    expect(storage.completions).toEqual([])
    expect(storage.progress).toEqual([])
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

  it('returns the stored result when the final segment runs again after its run succeeded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = new MemoryStorage()
    const finalize = storage.finalizeSuccessfulRun.bind(storage)
    // D1 committed the finalization batch but reported an error.
    storage.finalizeSuccessfulRun = async (run, finalization) => {
      await finalize(run, finalization)
      throw new Error('D1 DB storage operation exceeded timeout which caused object to be reset.')
    }
    const fetchPage = async () => [listing('a', 'a.example')]
    await expect(runSegment(storage, { fetchPage })).rejects.toEqual(
      new SyncError('sync_failed', { transient: true })
    )
    await expect(runSegment(storage, { fetchPage, runId: 1 })).resolves.toEqual({
      done: true,
      summary: {
        provider: 'dynadot',
        status: 'succeeded',
        pagesFetched: 1,
        recordsFetched: 1,
        recordsUpserted: 1,
        recordsInactivated: 0,
        recordsRejected: 0
      }
    })

    // A run that was interrupted rather than finished is still stale.
    await storage.startRun(new Date())
    await storage.startRun(new Date())
    await expect(runSegment(storage, { fetchPage, runId: 2 })).rejects.toEqual(
      new SyncError('sync_stale_continuation')
    )
    warn.mockRestore()
  })

  it('logs why storage failed, whatever was thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const thrown of [
      new Error('D1 DB exceeded its CPU time limit and was reset.'),
      'D1 down'
    ]) {
      const storage = new MemoryStorage()
      storage.upsertListings = async () => {
        throw thrown
      }
      await expect(
        runSegment(storage, { fetchPage: async () => [listing('a', 'a.example')] })
      ).rejects.toEqual(new SyncError('sync_failed', { transient: true }))
    }
    expect(warn.mock.calls).toEqual([
      ['sync_storage_failed', { message: 'D1 DB exceeded its CPU time limit and was reset.' }],
      ['sync_storage_failed', { message: 'D1 down' }]
    ])
    warn.mockRestore()
  })

  it('commits the stored pages on a transient failure, so the retry resumes at the failing page', async () => {
    const storage = new MemoryStorage()
    const fetched: number[] = []
    const pages = (pageIndex: number) => [listing(`page-${pageIndex}`, `page-${pageIndex}.example`)]
    const upsertListings = storage.upsertListings.bind(storage)
    let failUpsertAt: number | null = 5
    storage.upsertListings = async (run, items) => {
      if (run.nextPage === failUpsertAt) {
        failUpsertAt = null
        throw new Error('D1 batch failed')
      }
      return upsertListings(run, items)
    }
    const segment = (runId: number | undefined, failFetchAt: number | null) =>
      runSegment(storage, {
        pageSize: 1,
        segmentPages: 10,
        runId,
        fetchPage: async ({ pageIndex }) => {
          fetched.push(pageIndex)
          if (pageIndex === failFetchAt) {
            throw new DynadotProviderError('dynadot_rate_limited', { transient: true })
          }
          return pageIndex <= 6 ? pages(pageIndex) : []
        }
      })

    // A rate limit on page 4 commits pages 1 to 3.
    await expect(segment(undefined, 4)).rejects.toEqual(
      new SyncError('dynadot_rate_limited', { transient: true })
    )
    expect(storage.progress.at(-1)).toMatchObject({
      nextPage: 4,
      pagesFetched: 3,
      recordsFetched: 3,
      recordsUpserted: 3
    })
    // A storage failure upserting page 5 commits page 4.
    await expect(segment(1, null)).rejects.toEqual(
      new SyncError('sync_failed', { transient: true })
    )
    expect(storage.progress.at(-1)).toMatchObject({ nextPage: 5, pagesFetched: 4 })
    expect(storage.completions).toEqual([])

    // Each retry starts at the failing page, and every page is counted once.
    await expect(segment(1, null)).resolves.toMatchObject({
      done: true,
      summary: { pagesFetched: 7, recordsFetched: 6, recordsUpserted: 6 }
    })
    expect(fetched).toEqual([1, 2, 3, 4, 4, 5, 5, 6, 7])
  })

  it('still retries when committing progress fails, but not a run that went stale', async () => {
    const failOnPage2 = async ({ pageIndex }: { pageIndex: number }) => {
      if (pageIndex === 2)
        throw new DynadotProviderError('dynadot_network_error', { transient: true })
      return [listing(`page-${pageIndex}`, `page-${pageIndex}.example`)]
    }
    const unavailable = new MemoryStorage()
    unavailable.updateRunProgress = async () => {
      throw new Error('D1 unavailable')
    }
    await expect(
      runSegment(unavailable, { pageSize: 1, fetchPage: failOnPage2 })
    ).rejects.toMatchObject({ code: 'dynadot_network_error', transient: true })

    const stale = new MemoryStorage()
    stale.updateRunProgress = async () => {
      throw new SyncError('sync_stale_continuation')
    }
    await expect(runSegment(stale, { pageSize: 1, fetchPage: failOnPage2 })).rejects.toEqual(
      new SyncError('sync_stale_continuation')
    )
    expect(stale.completions).toEqual([])
  })

  it('fails at once on an unexpected adapter error', async () => {
    const storage = new MemoryStorage()
    const fetchPage = vi.fn(async () => {
      throw new TypeError('adapter bug')
    })
    await expect(runSegment(storage, { fetchPage })).rejects.toEqual(new SyncError('sync_failed'))
    expect(fetchPage).toHaveBeenCalledOnce()
    expect(storage.completions).toEqual([
      expect.objectContaining({ status: 'failed', errorCode: 'sync_failed', failedPage: 1 })
    ])
  })

  it('records why a page had too many rejected records on the failed run', async () => {
    const storage = new MemoryStorage()
    const rejections = { 'renewal_price: invalid_decimal': 117 }
    await expect(
      runSegment(storage, {
        fetchPage: async () => {
          throw new DynadotProviderError('dynadot_too_many_rejected', { rejections })
        }
      })
    ).rejects.toEqual(new SyncError('dynadot_too_many_rejected'))
    expect(storage.completions).toEqual([
      expect.objectContaining({
        errorCode: 'dynadot_too_many_rejected',
        failedPage: 1,
        rejectionReasons: rejections
      })
    ])
  })

  it("passes on the provider's requested wait with a transient failure", async () => {
    for (const [failure, retryAfterMs] of [
      [
        new DynadotProviderError('dynadot_rate_limited', { transient: true, retryAfterMs: 60_000 }),
        60_000
      ],
      [new DynadotProviderError('dynadot_network_error', { transient: true }), null]
    ] as const) {
      const storage = new MemoryStorage()
      await expect(
        runSegment(storage, {
          fetchPage: async () => {
            throw failure
          }
        })
      ).rejects.toMatchObject({ transient: true, retryAfterMs })
      // Nothing was stored before page 1, so there is nothing to commit.
      expect(storage.progress).toEqual([])
    }
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
