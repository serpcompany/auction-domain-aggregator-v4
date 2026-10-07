// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GODADDY_FEED_ENTRY, GODADDY_FEED_URL } from '../providers/godaddy'
import type { AuctionProvider, NormalizedListing } from '../providers/types'
import type { FeedPageBucket } from './feed-pages'
import {
  CLEANUP_STEP,
  fixedErrorCode,
  runProviderSync,
  STAGE_STEP,
  type StepConfig,
  SYNC_STEP,
  type SyncWorkerEnv,
  scheduleProviderSyncs
} from './provider-sync-workflow'
import { type IngestionStorage, type RunState, SyncError } from './sync'
import { buildZipFixture } from './zip-fixture'

afterEach(() => {
  vi.unstubAllGlobals()
})

function nonRetryableError(code: string) {
  return Object.assign(new Error(code), { name: 'NonRetryableError' })
}

// Records each step attempt's name and configuration, and retries a step
// that throws up to its retry limit without waiting. Like local Workflows
// (observed with Wrangler 4.110), a step that throws a NonRetryableError
// rejects with `NonRetryableError: <message>`. A step named in `rerun` runs
// once more after it first succeeds, as when the platform interrupts it
// before its result is persisted.
function stepRunner({ rerun = [] }: { rerun?: string[] } = {}) {
  const steps: { name: string; config: StepConfig }[] = []
  const pending = new Set(rerun)
  return {
    steps,
    names: () => steps.map(step => step.name),
    runner: {
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
      'stage feed',
      'start run',
      'sync pages, segment 1',
      'sync pages, segment 2',
      'delete staged pages'
    ])
    expect(steps.steps.map(step => step.config)).toEqual([
      STAGE_STEP,
      SYNC_STEP,
      SYNC_STEP,
      SYNC_STEP,
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
    expect(steps.names()[0]).toBe('stage feed')
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
    expect(stores.get('dynadot')!.failures).toEqual(['dynadot_http_error'])
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
      'stage feed',
      'stage feed',
      'stage feed',
      'delete staged pages'
    ])

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
    expect(flaky.steps.names().slice(0, 2)).toEqual(['stage feed', 'stage feed'])
    expect(flaky.nonRetryable).not.toHaveBeenCalled()
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
    expect(renamed.steps.names()).toEqual(['stage feed', 'delete staged pages'])

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
      'stage feed',
      'stage feed',
      'start run',
      'start run',
      'sync pages, segment 1',
      'sync pages, segment 1',
      'delete staged pages'
    ])
    expect(stores.get('godaddy')!.listings.size).toBe(20_500)
    expect(bucket.objects.size).toBe(0)
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
      'stage feed',
      'start run',
      'sync pages, segment 1',
      'sync pages, segment 1',
      'delete staged pages'
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
    await expect(run('godaddy')).rejects.toThrow('godaddy_response_error')
    expect(nonRetryable).toHaveBeenCalledWith('godaddy_response_error')
    expect(stores.get('godaddy')!.failures).toEqual(['godaddy_response_error'])
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
    await expect(failed.run('godaddy')).rejects.toThrow('godaddy_response_error')
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
  it('starts one instance per provider, named by the scheduled time', async () => {
    const create = vi.fn(async () => ({}) as WorkflowInstance)
    await expect(
      scheduleProviderSyncs({ create }, new Date('2026-10-06T15:30:00.000Z'))
    ).resolves.toEqual(['dynadot', 'godaddy', 'namecheap'])
    expect(create.mock.calls).toEqual([
      [{ id: 'dynadot-20261006T1530', params: { provider: 'dynadot' } }],
      [{ id: 'godaddy-20261006T1530', params: { provider: 'godaddy' } }],
      [{ id: 'namecheap-20261006T1530', params: { provider: 'namecheap' } }]
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
    expect(create).toHaveBeenCalledTimes(3)
  })
})
