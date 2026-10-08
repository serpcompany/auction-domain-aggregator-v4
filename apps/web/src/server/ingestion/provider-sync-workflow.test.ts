// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GODADDY_FEED_ENTRY, GODADDY_FEED_URL } from '../providers/godaddy'
import type { AuctionProvider, NormalizedListing } from '../providers/types'
import type { FeedPageBucket } from './feed-pages'
import { NAMESILO_RECORDING_MANIFEST } from './namesilo-recording'
import {
  CLEANUP_STEP,
  ENDED_LISTING_RETENTION_MS,
  fixedErrorCode,
  MAX_PROVIDER_WAIT_MS,
  runProviderSync,
  STAGE_STEP,
  type StepConfig,
  SYNC_STEP,
  type SyncWorkerEnv,
  scheduledProviders,
  scheduleProviderSyncs
} from './provider-sync-workflow'
import { type IngestionStorage, type RunState, SyncError } from './sync'
import { buildZipFixture } from './zip-fixture'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function nonRetryableError(code: string) {
  return Object.assign(new Error(code), { name: 'NonRetryableError' })
}

// Records each step attempt's name and configuration, and each sleep's name
// and duration, and retries a step that throws up to its retry limit without
// waiting. Like local Workflows (observed with Wrangler 4.110), a step that
// throws a NonRetryableError rejects with `NonRetryableError: <message>`. A
// step named in `rerun` runs once more after it first succeeds, as when the
// platform interrupts it before its result is persisted.
function stepRunner({ rerun = [] }: { rerun?: string[] } = {}) {
  const steps: { name: string; config?: StepConfig; sleepMs?: number }[] = []
  const pending = new Set(rerun)
  return {
    steps,
    names: () => steps.map(step => step.name),
    sleeps: () => steps.flatMap(step => (step.sleepMs === undefined ? [] : [step.sleepMs])),
    runner: {
      async sleep(name: string, milliseconds: number) {
        steps.push({ name, sleepMs: milliseconds })
      },
      async do<T>(name: string, config: StepConfig, callback: () => Promise<T>) {
        for (let attempt = 0; ; attempt += 1) {
          steps.push({ name, config })
          try {
            const result = await callback()
            if (pending.delete(name)) continue
            return result
          } catch (error) {
            if (error instanceof Error && error.name === 'NonRetryableError') {
              throw new Error(`NonRetryableError: ${error.message}`)
            }
            if (attempt >= config.retries.limit) throw error
          }
        }
      }
    }
  }
}

function memoryBucket() {
  const objects = new Map<string, Uint8Array>()
  const bucket: FeedPageBucket = {
    async put(key, value) {
      objects.set(key, value.slice())
    },
    async get(key) {
      const value = objects.get(key)
      return value
        ? {
            size: value.byteLength,
            text: async () => new TextDecoder().decode(value),
            body: new ReadableStream()
          }
        : null
    },
    async list({ prefix, limit }) {
      return {
        objects: [...objects.keys()]
          .filter(key => key.startsWith(prefix))
          .slice(0, limit)
          .map(key => ({ key }))
      }
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key)
    }
  }
  return { bucket, objects }
}

// Minimal storage that keeps one provider's run and listings in memory.
function memoryStorage(provider: AuctionProvider) {
  const listings = new Map<string, NormalizedListing>()
  let run: RunState | null = null
  const failures: string[] = []
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
        recordsRejected: 0
      }
      return { ...run }
    },
    async loadRunningRun(runId) {
      if (!run || run.runId !== runId) {
        throw new SyncError('sync_stale_continuation')
      }
      return { ...run }
    },
    async loadSucceededRun() {
      return null
    },
    async upsertListings(_run, page) {
      for (const listing of page) listings.set(listing.externalId, listing)
    },
    async finalizeSuccessfulRun() {
      return 0
    },
    async updateRunProgress(next) {
      run = { ...next }
    },
    async completeRun(_run, completion) {
      failures.push(completion.errorCode)
    },
    async deleteEndedListings(_before, afterRowid) {
      return { listings: 0, seoMetrics: 0, domains: 0, lastRowid: afterRowid }
    }
  }
  return { storage, listings, failures }
}

function godaddyRecord(index: number) {
  return {
    domainName: `invented-${index}.example`,
    link: `https://www.godaddy.com/domain-auctions/invented-${index}-example-${index + 1}`,
    auctionType: 'Bid',
    auctionEndTime: '2026-10-09T16:00:00Z',
    price: '$12',
    numberOfBids: 1
  }
}

async function feedZip(records: unknown[]) {
  return buildZipFixture(JSON.stringify({ meta: {}, data: records }), {
    entry: GODADDY_FEED_ENTRY
  })
}

const dynadotItem = {
  auction_id: 1,
  domain: 'invented-1.example',
  auction_type: 'expired',
  currency: 'usd',
  current_bid_price: '12',
  bids: 1,
  bidders: 1,
  end_time_stamp: 1760003600000
}

function setup({
  zip,
  env = {},
  bucket = memoryBucket(),
  rerun,
  wrapStorage = storage => storage
}: {
  zip?: Uint8Array
  env?: Partial<SyncWorkerEnv>
  bucket?: ReturnType<typeof memoryBucket>
  rerun?: string[]
  wrapStorage?: (storage: IngestionStorage) => IngestionStorage
}) {
  const steps = stepRunner({ rerun })
  const stores = new Map<AuctionProvider, ReturnType<typeof memoryStorage>>()
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    zip ? new Response(zip as BodyInit) : new Response(null, { status: 403 })
  )
  const nonRetryable = vi.fn(nonRetryableError)
  const run = (provider: string, runKey = 'godaddy-test-1') =>
    runProviderSync({
      provider,
      runKey,
      env: {
        DB: {} as D1Database,
        FEED_PAGES: bucket.bucket as unknown as R2Bucket,
        ...env
      },
      step: steps.runner,
      nonRetryable,
      dependencies: {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        wait: async () => undefined,
        createStorage: (_database, provider) => {
          const store = memoryStorage(provider)
          stores.set(provider, store)
          return wrapStorage(store.storage)
        }
      }
    })
  return { run, steps, stores, fetchImpl, nonRetryable, bucket }
}

const TWENTY_ONE_PAGES = {
  provider: 'godaddy',
  status: 'succeeded',
  pagesFetched: 21,
  recordsFetched: 20_500,
  recordsUpserted: 20_500,
  recordsInactivated: 0,
  recordsRejected: 0
}

describe('provider sync workflow', () => {
  it('stages a file feed, syncs it in segments, and deletes the pages', async () => {
    const records = Array.from({ length: 20_500 }, (_, index) => godaddyRecord(index))
    const { run, steps, stores, fetchImpl, bucket } = setup({
      zip: await feedZip(records)
    })

    await expect(run('godaddy')).resolves.toEqual(TWENTY_ONE_PAGES)
    expect(steps.names()).toEqual([
      'start run',
      'stage feed',
      'sync pages, segment 1',
      'sync pages, segment 2',
      'delete staged pages',
      'delete ended listings, step 1'
    ])
    expect(steps.steps.map(step => step.config)).toEqual([
      SYNC_STEP,
      STAGE_STEP,
      SYNC_STEP,
      SYNC_STEP,
      CLEANUP_STEP,
      CLEANUP_STEP
    ])
    expect(fetchImpl.mock.calls[0]![0]).toBe(GODADDY_FEED_URL)
    expect(stores.get('godaddy')!.listings.size).toBe(20_500)
    expect(bucket.objects.size).toBe(0)
  })

  it('stages a CSV feed the same way', async () => {
    const rows = Array.from(
      { length: 2_001 },
      (_, index) =>
        `https://www.namecheap.com/market/sale/Sale${index}/,invented-${index}.example,2026-10-09T15:00:00Z,12.00,0`
    )
    const csv = ['url,name,endDate,price,bidCount', ...rows].join('\n')
    const { run, steps, stores, fetchImpl, bucket } = setup({})
    fetchImpl.mockImplementation(async () => new Response(csv))
    await expect(run('namecheap', 'namecheap-test-1')).resolves.toEqual({
      provider: 'namecheap',
      status: 'succeeded',
      pagesFetched: 2,
      recordsFetched: 2_001,
      recordsUpserted: 2_001,
      recordsInactivated: 0,
      recordsRejected: 0
    })
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://d3ry1h4w5036x1.cloudfront.net/reports/Namecheap_Market_Sales.csv'
    )
    expect(steps.names().slice(0, 2)).toEqual(['start run', 'stage feed'])
    expect(stores.get('namecheap')!.listings.size).toBe(2_001)
    expect(bucket.objects.size).toBe(0)
  })

  it('fails unknown providers and missing credentials before any step', async () => {
    const { run, steps } = setup({})
    await expect(run('sedo')).rejects.toThrow('sync_unknown_provider')
    await expect(run('dynadot')).rejects.toThrow('dynadot_missing_credentials')
    expect(steps.names()).toEqual([])
  })

  it('runs an API provider without staging and reports its failure code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 }))
    )
    const { run, steps, stores, nonRetryable } = setup({
      env: { DYNADOT_API_PRODUCTION_KEY: 'invented-test-key' }
    })
    await expect(run('dynadot')).rejects.toThrow('dynadot_http_error')
    expect(steps.names()).toEqual(['start run', 'sync pages, segment 1'])
    expect(nonRetryable).toHaveBeenCalledWith('dynadot_http_error')
    expect(stores.get('dynadot')?.failures).toEqual(['dynadot_http_error'])
  })

  it('replays a fresh NameSilo recording instead of calling NameSilo', async () => {
    const live = vi.fn(async () => new Response('blocked', { status: 403 }))
    vi.stubGlobal('fetch', live)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bucket = memoryBucket()
    const put = (key: string, value: unknown) =>
      bucket.bucket.put(key, new TextEncoder().encode(JSON.stringify(value)))
    const prefix = 'feed-pages/namesilo-recording/20261007134500/'
    await put(NAMESILO_RECORDING_MANIFEST, { prefix, recordedAt: new Date().toISOString() })
    await put(`${prefix}1-9-1.json`, { reply: { code: 300, body: [] } })
    await put(`${prefix}3-2-1.json`, {
      reply: {
        code: 300,
        body: [
          {
            id: 9001,
            domain: 'invented-example.com',
            typeId: 3,
            openingBid: 1,
            currentBid: 12.5,
            bidsQuantity: 4,
            hasBids: true,
            domainCreatedOn: '2010-10-28 08:00:00',
            auctionEndsOnUtc: '2026-10-28 07:00:00',
            url: 'https://www.namesilo.com/auctions/invented-example.com',
            visits: 31
          }
        ]
      }
    })
    const recorded = setup({ env: { NAMESILO_API_KEY: 'invented-test-key' }, bucket })
    await expect(recorded.run('namesilo')).resolves.toMatchObject({
      status: 'succeeded',
      pagesFetched: 2,
      recordsFetched: 1,
      recordsUpserted: 1
    })
    expect(recorded.steps.names()).toEqual([
      'find recorded responses',
      'start run',
      'sync pages, segment 1',
      'delete ended listings, step 1'
    ])
    expect(live).not.toHaveBeenCalled()

    // Without a recording, as in local development, it calls NameSilo.
    const direct = setup({ env: { NAMESILO_API_KEY: 'invented-test-key' } })
    await expect(direct.run('namesilo')).rejects.toThrow('namesilo_http_error')
    expect(live).toHaveBeenCalledOnce()
  })

  it('waits as long as the provider asks before running the segment again', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('busy', { status: 429, headers: { 'retry-after': '300' } })
      )
      .mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'success', auction_list: [dynadotItem] }))
      )
    vi.stubGlobal('fetch', fetchImpl)
    const { run, steps, stores } = setup({
      env: { DYNADOT_API_PRODUCTION_KEY: 'invented-test-key' }
    })
    await expect(run('dynadot')).resolves.toMatchObject({ recordsUpserted: 1 })
    expect(steps.names()).toEqual([
      'start run',
      'sync pages, segment 1',
      'wait before segment 1, retry 1',
      'sync pages, segment 1, retry 1',
      'wait before segment 1, retry 2',
      'sync pages, segment 1, retry 2',
      'delete ended listings, step 1'
    ])
    // At least the requested wait, and at least the step's own backoff.
    expect(steps.sleeps()).toEqual([300_000, 120_000])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(stores.get('dynadot')?.failures).toEqual([])
  })

  it('records the run failed after as many waits as the step has retries', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            Response: {
              ResponseCode: '-1',
              Error: 'Too many requests. Please try again in 1 minute after.'
            }
          })
        )
    )
    vi.stubGlobal('fetch', fetchImpl)
    const { run, steps, stores, nonRetryable } = setup({
      env: { DYNADOT_API_PRODUCTION_KEY: 'invented-test-key' }
    })
    await expect(run('dynadot')).rejects.toThrow('dynadot_rate_limited')
    expect(steps.sleeps()).toEqual([60_000, 120_000, 240_000])
    expect(steps.names().slice(-2)).toEqual(['sync pages, segment 1, retry 3', 'record failed run'])
    expect(fetchImpl).toHaveBeenCalledTimes(SYNC_STEP.retries.limit + 1)
    expect(nonRetryable).not.toHaveBeenCalled()
    expect(stores.get('dynadot')?.failures).toEqual(['dynadot_rate_limited'])
  })

  it('fails the run at once when the provider asks for too long a wait', async () => {
    const retryAfter = String(MAX_PROVIDER_WAIT_MS / 1000 + 1)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('down', { status: 503, headers: { 'retry-after': retryAfter } })
      )
    )
    const { run, steps, stores } = setup({
      env: { DYNADOT_API_PRODUCTION_KEY: 'invented-test-key' }
    })
    await expect(run('dynadot')).rejects.toThrow('dynadot_http_error')
    expect(steps.names()).toEqual(['start run', 'sync pages, segment 1', 'record failed run'])
    expect(stores.get('dynadot')?.failures).toEqual(['dynadot_http_error'])
  })

  it('retries a transient failure mid-segment and completes with exact counters', async () => {
    const records = Array.from({ length: 2_500 }, (_, index) => godaddyRecord(index))
    const bucket = memoryBucket()
    const get = bucket.bucket.get
    let failures = 2
    bucket.bucket.get = async key => {
      if (key.endsWith('page-2.json') && failures-- > 0) throw new Error('R2 timeout')
      return get(key)
    }
    const { run, steps, stores } = setup({ zip: await feedZip(records), bucket })
    await expect(run('godaddy')).resolves.toMatchObject({
      pagesFetched: 3,
      recordsFetched: 2_500,
      recordsUpserted: 2_500
    })
    expect(steps.names().filter(name => name === 'sync pages, segment 1')).toHaveLength(3)
    expect(stores.get('godaddy')?.failures).toEqual([])
  })

  it('marks the run failed with its code when the retries run out', async () => {
    const bucket = memoryBucket()
    const get = bucket.bucket.get
    bucket.bucket.get = async key => {
      if (key.endsWith('page-1.json')) throw new Error('R2 down')
      return get(key)
    }
    const { run, steps, stores, nonRetryable } = setup({
      zip: await feedZip([godaddyRecord(1)]),
      bucket
    })
    await expect(run('godaddy')).rejects.toThrow('godaddy_page_read_error')
    expect(steps.names().filter(name => name === 'sync pages, segment 1')).toHaveLength(
      SYNC_STEP.retries.limit + 1
    )
    expect(steps.names().slice(-2)).toEqual(['record failed run', 'delete staged pages'])
    expect(nonRetryable).not.toHaveBeenCalledWith('godaddy_page_read_error')
    expect(stores.get('godaddy')?.failures).toEqual(['godaddy_page_read_error'])
    expect(bucket.objects.size).toBe(0)
  })

  it('still reports the step failure when recording the failed run fails too', async () => {
    const bucket = memoryBucket()
    bucket.bucket.get = async () => {
      throw new Error('R2 down')
    }
    const { run, stores } = setup({
      zip: await feedZip([godaddyRecord(1)]),
      bucket,
      wrapStorage: storage => ({
        ...storage,
        completeRun: async () => {
          throw new Error('D1 down')
        }
      })
    })
    await expect(run('godaddy')).rejects.toThrow('godaddy_page_read_error')
    expect(stores.get('godaddy')?.failures).toEqual([])
  })

  it('retries download and page-write failures but not malformed feeds, and still cleans up', async () => {
    const failed = setup({})
    await expect(failed.run('godaddy')).rejects.toThrow('feed_download_failed')
    expect(failed.nonRetryable).not.toHaveBeenCalled()
    expect(failed.fetchImpl).toHaveBeenCalledTimes(3)
    expect(failed.steps.names()).toEqual([
      'start run',
      'stage feed',
      'stage feed',
      'stage feed',
      'record failed run',
      'delete staged pages'
    ])
    // The run was started first, so the failure shows on the Sync status page.
    expect(failed.stores.get('godaddy')?.failures).toEqual(['feed_download_failed'])

    const empty = setup({ zip: await feedZip([]) })
    await expect(empty.run('godaddy')).rejects.toThrow('feed_empty')
    expect(empty.nonRetryable).toHaveBeenCalledWith('feed_empty')
    expect(empty.fetchImpl).toHaveBeenCalledTimes(1)

    const bucket = memoryBucket()
    let failPuts = 1
    const put = bucket.bucket.put
    bucket.bucket.put = async (key, value) => {
      if (failPuts > 0) {
        failPuts -= 1
        throw new Error('R2 unavailable')
      }
      return put(key, value)
    }
    const flaky = setup({ zip: await feedZip([godaddyRecord(1)]), bucket })
    await expect(flaky.run('godaddy')).resolves.toMatchObject({
      recordsUpserted: 1
    })
    expect(flaky.steps.names().slice(0, 3)).toEqual(['start run', 'stage feed', 'stage feed'])
    expect(flaky.nonRetryable).not.toHaveBeenCalled()
  })

  it('logs how long staging took and how long page writes waited', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const staged = setup({ zip: await feedZip([godaddyRecord(1)]) })
    await expect(staged.run('godaddy')).resolves.toMatchObject({ recordsUpserted: 1 })
    expect(info).toHaveBeenCalledWith('feed_staged', {
      provider: 'godaddy',
      seconds: expect.any(Number),
      pagesWritten: 1,
      averageWriteMs: expect.any(Number),
      records: 1
    })

    const failed = setup({})
    await expect(failed.run('godaddy')).rejects.toThrow('feed_download_failed')
    expect(warn).toHaveBeenCalledWith('feed_stage_failed', {
      provider: 'godaddy',
      seconds: expect.any(Number),
      pagesWritten: 0,
      averageWriteMs: null,
      code: 'feed_download_failed'
    })
  })

  it('retries a download that drops while the zip header is read', async () => {
    const { run, fetchImpl, nonRetryable } = setup({
      zip: await feedZip([godaddyRecord(1)])
    })
    fetchImpl.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new TypeError('connection reset'))
            }
          })
        )
    )
    await expect(run('godaddy')).resolves.toMatchObject({
      recordsUpserted: 1
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(nonRetryable).not.toHaveBeenCalled()
  })

  it('fails an archive it cannot use, or a record beyond the page limit, without retrying', async () => {
    const renamed = setup({
      zip: await buildZipFixture(JSON.stringify({ data: [godaddyRecord(1)] }), {
        entry: 'renamed.json'
      })
    })
    await expect(renamed.run('godaddy')).rejects.toThrow('feed_unsupported_archive')
    expect(renamed.fetchImpl).toHaveBeenCalledTimes(1)
    expect(renamed.steps.names()).toEqual([
      'start run',
      'stage feed',
      'record failed run',
      'delete staged pages'
    ])
    expect(renamed.stores.get('godaddy')?.failures).toEqual(['feed_unsupported_archive'])

    // One record larger than the adapter's 10 MiB page limit.
    const huge = setup({
      zip: await feedZip([{ ...godaddyRecord(1), padding: 'x'.repeat(10 * 1024 * 1024) }])
    })
    await expect(huge.run('godaddy')).rejects.toThrow('feed_too_large')
    expect(huge.nonRetryable).toHaveBeenCalledWith('feed_too_large')
    expect(huge.bucket.objects.size).toBe(0)
  })

  it('does not retry an unexpected staging error', async () => {
    const { run, fetchImpl, nonRetryable } = setup({})
    fetchImpl.mockImplementation(
      async () =>
        ({
          ok: true,
          get body(): never {
            throw new Error('unexpected')
          }
        }) as unknown as Response
    )
    await expect(run('godaddy')).rejects.toThrow('feed_stage_failed')
    expect(nonRetryable).toHaveBeenCalledWith('feed_stage_failed')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('resumes the same run when the platform runs a step again', async () => {
    const records = Array.from({ length: 20_500 }, (_, index) => godaddyRecord(index))
    const { run, steps, stores, bucket } = setup({
      zip: await feedZip(records),
      rerun: ['stage feed', 'start run', 'sync pages, segment 1']
    })

    // The second segment-1 run resumes at page 21, where the first left the
    // run, so the result matches an uninterrupted sync.
    await expect(run('godaddy')).resolves.toEqual(TWENTY_ONE_PAGES)
    expect(steps.names()).toEqual([
      'start run',
      'start run',
      'stage feed',
      'stage feed',
      'sync pages, segment 1',
      'sync pages, segment 1',
      'delete staged pages',
      'delete ended listings, step 1'
    ])
    expect(stores.get('godaddy')!.listings.size).toBe(20_500)
    expect(bucket.objects.size).toBe(0)
  })

  it('deletes ended listings after a success, a step per 50,000, and only logs a failure', async () => {
    const records = [godaddyRecord(0)]
    // 25 full batches fill the first step; the second step ends on a short one. Each batch
    // continues from the rowid the previous one reached, across steps too.
    let batches = 0
    const deleteEndedListings = vi.fn(async (before: Date, afterRowid: number, limit: number) => {
      expect(Date.now() - before.getTime()).toBeGreaterThanOrEqual(ENDED_LISTING_RETENTION_MS)
      expect(limit).toBe(2_000)
      expect(afterRowid).toBe(batches * 10_000)
      batches += 1
      return batches <= 26
        ? { listings: 2_000, seoMetrics: 1_500, domains: 1_900, lastRowid: batches * 10_000 }
        : { listings: 300, seoMetrics: 100, domains: 250, lastRowid: batches * 10_000 }
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const deleting = setup({
      zip: await feedZip(records),
      wrapStorage: storage => ({ ...storage, deleteEndedListings })
    })
    await expect(deleting.run('godaddy')).resolves.toMatchObject({ status: 'succeeded' })
    expect(deleting.steps.names().slice(-2)).toEqual([
      'delete ended listings, step 1',
      'delete ended listings, step 2'
    ])
    expect(deleteEndedListings).toHaveBeenCalledTimes(27)
    expect(info).toHaveBeenCalledWith('ended_listings_deleted', {
      provider: 'godaddy',
      listings: 52_300,
      seoMetrics: 39_100,
      domains: 49_650
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = setup({
      zip: await feedZip(records),
      wrapStorage: storage => ({
        ...storage,
        deleteEndedListings: async () => {
          throw new Error('D1_ERROR: busy')
        }
      })
    })
    await expect(failing.run('godaddy')).resolves.toMatchObject({ status: 'succeeded' })
    expect(failing.steps.names().filter(name => name.startsWith('delete ended'))).toHaveLength(
      CLEANUP_STEP.retries.limit + 1
    )
    expect(warn).toHaveBeenCalledWith('ended_listings_delete_failed', {
      provider: 'godaddy',
      message: 'D1_ERROR: busy'
    })
    info.mockRestore()
    warn.mockRestore()
  })

  it('retries a segment whose run could not be loaded, but not a stale run', async () => {
    let loadFailures = 1
    const transient = setup({
      zip: await feedZip([godaddyRecord(1)]),
      wrapStorage: storage => ({
        ...storage,
        loadRunningRun: async runId => {
          if (loadFailures > 0) {
            loadFailures -= 1
            throw new Error('D1 unavailable')
          }
          return storage.loadRunningRun(runId)
        }
      })
    })
    await expect(transient.run('godaddy')).resolves.toMatchObject({
      recordsUpserted: 1
    })
    expect(transient.steps.names()).toEqual([
      'start run',
      'stage feed',
      'sync pages, segment 1',
      'sync pages, segment 1',
      'delete staged pages',
      'delete ended listings, step 1'
    ])

    const stale = setup({
      zip: await feedZip([godaddyRecord(1)]),
      wrapStorage: storage => ({
        ...storage,
        loadRunningRun: async () => {
          throw new SyncError('sync_stale_continuation')
        }
      })
    })
    await expect(stale.run('godaddy')).rejects.toThrow('sync_stale_continuation')
    expect(stale.nonRetryable).toHaveBeenCalledWith('sync_stale_continuation')
  })

  it('records a sync failure on the run and deletes the staged pages', async () => {
    const records = Array.from({ length: 10 }, (_, index) =>
      index < 3 ? { ...godaddyRecord(index), price: 'invalid' } : godaddyRecord(index)
    )
    const { run, steps, stores, nonRetryable, bucket } = setup({
      zip: await feedZip(records)
    })
    await expect(run('godaddy')).rejects.toThrow('godaddy_too_many_rejected')
    expect(nonRetryable).toHaveBeenCalledWith('godaddy_too_many_rejected')
    expect(stores.get('godaddy')!.failures).toEqual(['godaddy_too_many_rejected'])
    expect(steps.names().at(-1)).toBe('delete staged pages')
    expect(bucket.objects.size).toBe(0)
  })

  it('rejects a run key that could escape the staging prefix', async () => {
    const { run, nonRetryable } = setup({
      zip: await feedZip([godaddyRecord(1)])
    })
    await expect(run('godaddy', 'bad/key')).rejects.toThrow('feed_invalid_run_key')
    expect(nonRetryable).not.toHaveBeenCalled()
  })

  it('reports a cleanup failure only when the sync succeeded', async () => {
    const stuck = () => {
      const bucket = memoryBucket()
      bucket.bucket.delete = async () => undefined
      return bucket
    }
    const succeeded = setup({
      zip: await feedZip([godaddyRecord(1)]),
      bucket: stuck()
    })
    await expect(succeeded.run('godaddy')).rejects.toThrow('feed_cleanup_incomplete')

    const invalid = Array.from({ length: 3 }, (_, index) => ({
      ...godaddyRecord(index),
      price: 'invalid'
    }))
    const failed = setup({ zip: await feedZip(invalid), bucket: stuck() })
    await expect(failed.run('godaddy')).rejects.toThrow('godaddy_too_many_rejected')
  })

  it('retries a run that could not be started, then reports sync_failed', async () => {
    const steps = stepRunner()
    const nonRetryable = vi.fn(nonRetryableError)
    const result = runProviderSync({
      provider: 'godaddy',
      runKey: 'godaddy-test-2',
      env: {
        DB: {} as D1Database,
        FEED_PAGES: memoryBucket().bucket as unknown as R2Bucket
      },
      step: steps.runner,
      nonRetryable,
      dependencies: {
        fetchImpl: (async () =>
          new Response((await feedZip([godaddyRecord(1)])) as BodyInit)) as unknown as typeof fetch,
        createStorage: () => ({
          ...memoryStorage('godaddy').storage,
          startRun: async () => {
            throw new Error('D1 unavailable')
          }
        })
      }
    })
    await expect(result).rejects.toThrow('sync_failed')
    expect(nonRetryable).not.toHaveBeenCalled()
    expect(steps.names().filter(name => name === 'start run')).toHaveLength(
      SYNC_STEP.retries.limit + 1
    )
  })

  it('accepts only fixed codes as instance errors', () => {
    expect(fixedErrorCode(new Error('sync_reconciliation_guard'))).toBe('sync_reconciliation_guard')
    expect(fixedErrorCode(new Error('NonRetryableError: godaddy_response_error'))).toBe(
      'godaddy_response_error'
    )
    expect(fixedErrorCode(new Error('NonRetryableError: no such table: x_y'))).toBe('sync_failed')
    expect(fixedErrorCode(new Error('https://x.example/?key=secret'))).toBe('sync_failed')
    expect(fixedErrorCode('feed_empty')).toBe('sync_failed')
  })
})

describe('scheduled provider syncs', () => {
  it('schedules the listed providers in registry order, or every one when none are listed', () => {
    expect(scheduledProviders()).toEqual(['dynadot', 'godaddy', 'namecheap', 'namesilo'])
    expect(scheduledProviders('')).toEqual(['dynadot', 'godaddy', 'namecheap', 'namesilo'])
    expect(scheduledProviders(' namesilo, godaddy ')).toEqual(['godaddy', 'namesilo'])
    // A list that names no provider is a mistake, not an empty schedule.
    expect(() => scheduledProviders('godady')).toThrow('sync_schedule_invalid')
  })

  it('starts one instance per provider, named by the scheduled time', async () => {
    const create = vi.fn(async () => ({}) as WorkflowInstance)
    await expect(
      scheduleProviderSyncs({ create }, new Date('2026-10-06T15:30:00.000Z'))
    ).resolves.toEqual(['dynadot', 'godaddy', 'namecheap', 'namesilo'])
    expect(create.mock.calls).toEqual([
      [{ id: 'dynadot-20261006T1530', params: { provider: 'dynadot' } }],
      [{ id: 'godaddy-20261006T1530', params: { provider: 'godaddy' } }],
      [{ id: 'namecheap-20261006T1530', params: { provider: 'namecheap' } }],
      [{ id: 'namesilo-20261006T1530', params: { provider: 'namesilo' } }]
    ])
  })

  it('still starts the other providers when one creation fails', async () => {
    const create = vi.fn(async (options?: { id?: string }) => {
      if (options?.id?.startsWith('dynadot')) throw new Error('duplicate')
      return {} as WorkflowInstance
    })
    await expect(
      scheduleProviderSyncs({ create }, new Date('2026-10-06T15:30:00.000Z'))
    ).rejects.toThrow('sync_schedule_failed')
    expect(create).toHaveBeenCalledTimes(4)
  })
})
