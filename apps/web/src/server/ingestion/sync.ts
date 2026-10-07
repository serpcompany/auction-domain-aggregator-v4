import {
  type AuctionProvider,
  type NormalizedListing,
  type ProviderAdapter,
  ProviderError,
  type RejectionReasons
} from '../providers/types'

export type SyncErrorCode =
  | 'sync_invalid_request'
  | 'sync_failed'
  | 'sync_page_limit_exceeded'
  | 'sync_interrupted'
  | 'sync_stale_continuation'
  | 'sync_reconciliation_guard'

// Non-secret codes persisted on a failed run: a sync code or a
// provider-prefixed adapter code such as `dynadot_http_error`.
export type RunErrorCode = Exclude<SyncErrorCode, 'sync_interrupted'> | string

// `transient` marks a segment that failed in a way a retry may not repeat.
// Its run is left running, so the retry resumes it. `retryAfterMs` carries
// the provider's requested wait, if it gave one.
export class SyncError extends Error {
  readonly code: RunErrorCode
  readonly transient: boolean
  readonly retryAfterMs: number | null

  constructor(
    code: RunErrorCode,
    {
      transient = false,
      retryAfterMs = null
    }: { transient?: boolean; retryAfterMs?: number | null } = {}
  ) {
    super(code)
    this.name = 'SyncError'
    this.code = code
    this.transient = transient
    this.retryAfterMs = retryAfterMs
  }
}

export type RunCounters = {
  pagesFetched: number
  recordsFetched: number
  recordsUpserted: number
  recordsInactivated: number
  recordsRejected: number
}

export type RunState = RunCounters & {
  runId: number
  startedAt: Date
  nextPage: number
}

export type RunCompletion = RunCounters & {
  status: 'failed'
  completedAt: Date
  errorCode: RunErrorCode
  failedPage: number | null
  // Why the failing page's records were rejected, for a `*_too_many_rejected`
  // failure.
  rejectionReasons: RejectionReasons | null
}

export type SuccessfulRunFinalization = Omit<RunCounters, 'recordsInactivated'> & {
  completedAt: Date
}

// Storage bound to a single provider. Every write is guarded by the matching
// running run, so a stale continuation cannot mutate state.
export type IngestionStorage = {
  provider: AuctionProvider
  startRun(startedAt: Date): Promise<RunState>
  loadRunningRun(runId: number): Promise<RunState>
  upsertListings(run: RunState, listings: NormalizedListing[]): Promise<void>
  finalizeSuccessfulRun(run: RunState, finalization: SuccessfulRunFinalization): Promise<number>
  updateRunProgress(run: RunState): Promise<void>
  completeRun(run: RunState, completion: RunCompletion): Promise<void>
}

export type SyncSummary = RunCounters & {
  provider: AuctionProvider
  status: 'succeeded'
}

export type SyncSegmentOptions = {
  clock?: () => Date
  maxPages?: number
  runId?: number
  segmentPages?: number
}

export type SyncSegmentResult =
  | { done: false; run: RunState }
  | { done: true; summary: SyncSummary }

const MAX_PAGES_LIMIT = 10_000

function positiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

function validateOptions(maxPages: number, segmentPages: number, runId?: number) {
  if (
    !positiveInteger(maxPages) ||
    maxPages > MAX_PAGES_LIMIT ||
    !positiveInteger(segmentPages) ||
    (runId !== undefined && !positiveInteger(runId))
  ) {
    throw new SyncError('sync_invalid_request')
  }
}

function validateRun(run: RunState, maxPages: number) {
  if (
    !positiveInteger(run.runId) ||
    Number.isNaN(run.startedAt.getTime()) ||
    !positiveInteger(run.nextPage) ||
    run.nextPage > maxPages ||
    [
      run.pagesFetched,
      run.recordsFetched,
      run.recordsUpserted,
      run.recordsInactivated,
      run.recordsRejected
    ].some(counter => !Number.isSafeInteger(counter) || counter < 0)
  ) {
    throw new SyncError('sync_stale_continuation')
  }
}

function runErrorCode(error: unknown): RunErrorCode {
  if (error instanceof ProviderError) return error.code
  if (error instanceof SyncError && error.code !== 'sync_interrupted') {
    return error.code
  }
  return 'sync_failed'
}

// An unexpected error raised by storage: a D1 batch failing, typically.
class StorageFailure extends Error {
  constructor() {
    super('sync_failed')
    this.name = 'StorageFailure'
  }
}

// Runs a storage call, marking an unexpected error as a storage failure. A
// SyncError from storage (a stale run, the reconciliation guard) is a
// deliberate verdict and passes through.
async function stored<T>(call: () => Promise<T>) {
  try {
    return await call()
  } catch (error) {
    if (error instanceof SyncError) throw error
    throw new StorageFailure()
  }
}

// A provider failure marked transient, or a storage failure, may succeed
// when the segment runs again. Anything else is final: a SyncError is a
// deliberate verdict (the guard, the page limit, an invalid request), and an
// unexpected adapter error is a bug that a retry would only repeat.
function isTransient(error: unknown) {
  if (error instanceof ProviderError) return error.transient
  return error instanceof StorageFailure
}

// Commits the pages a failing segment stored before the failing one, so the
// retry resumes at that page instead of fetching them again. Best effort: if
// the commit fails too, the retry resumes from the last committed page. A run
// that is no longer running is reported as stale.
async function commitProgress(storage: IngestionStorage, run: RunState) {
  try {
    await storage.updateRunProgress(run)
  } catch (error) {
    if (error instanceof SyncError && error.code === 'sync_stale_continuation') throw error
  }
}

// Starts a run of `storage`'s provider, interrupting any run of that provider
// still marked running, and returns its ID for `runSyncSegment`. Kept apart
// from the first segment so a segment that is run again resumes this run
// from its committed page instead of starting another.
export async function startSyncRun(
  storage: IngestionStorage,
  clock: () => Date = () => new Date()
) {
  const run = await storage.startRun(clock())
  return run.runId
}

export async function runSyncSegment(
  adapter: ProviderAdapter,
  storage: IngestionStorage,
  { clock = () => new Date(), maxPages = 1000, segmentPages = 20, runId }: SyncSegmentOptions = {}
): Promise<SyncSegmentResult> {
  validateOptions(maxPages, segmentPages, runId)
  if (adapter.provider !== storage.provider) {
    throw new SyncError('sync_invalid_request')
  }
  const run = runId ? await storage.loadRunningRun(runId) : await storage.startRun(clock())
  validateRun(run, maxPages)

  const segmentStart = run.nextPage
  let failedPage: number | null = null
  try {
    const finalPageInSegment = Math.min(run.nextPage + segmentPages - 1, maxPages)
    for (let pageIndex = run.nextPage; pageIndex <= finalPageInSegment; pageIndex += 1) {
      failedPage = pageIndex
      const page = await adapter.fetchPage({ pageIndex })
      await stored(() => storage.upsertListings(run, page.listings))
      // Counted only once the page is stored, so the progress committed
      // after a later failure is exact.
      run.pagesFetched += 1
      run.recordsFetched += page.received
      run.recordsRejected += page.rejected
      run.recordsUpserted += page.listings.length
      run.nextPage = pageIndex + 1

      if (page.isLastPage) {
        failedPage = null
        run.recordsInactivated = await stored(() =>
          storage.finalizeSuccessfulRun(run, {
            pagesFetched: run.pagesFetched,
            recordsFetched: run.recordsFetched,
            recordsUpserted: run.recordsUpserted,
            recordsRejected: run.recordsRejected,
            completedAt: clock()
          })
        )
        return {
          done: true,
          summary: {
            provider: storage.provider,
            status: 'succeeded',
            pagesFetched: run.pagesFetched,
            recordsFetched: run.recordsFetched,
            recordsUpserted: run.recordsUpserted,
            recordsInactivated: run.recordsInactivated,
            recordsRejected: run.recordsRejected
          }
        }
      }

      if (pageIndex === maxPages) {
        throw new SyncError('sync_page_limit_exceeded')
      }
    }
    failedPage = null

    await stored(() => storage.updateRunProgress(run))
    return { done: false, run }
  } catch (error) {
    if (error instanceof SyncError && error.code === 'sync_stale_continuation') {
      throw error
    }
    const errorCode = runErrorCode(error)
    // The run stays running. When a page failed after others of this segment
    // were stored, their progress is committed, so the retry resumes at the
    // failing page. A failure while finishing the segment commits nothing,
    // and the retry fetches and upserts the segment's pages again (upserts
    // are idempotent). Either way the counters stay exact.
    if (isTransient(error)) {
      if (failedPage !== null && run.nextPage > segmentStart) {
        await commitProgress(storage, run)
      }
      throw new SyncError(errorCode, {
        transient: true,
        retryAfterMs: error instanceof ProviderError ? error.retryAfterMs : null
      })
    }
    try {
      await storage.completeRun(run, {
        pagesFetched: run.pagesFetched,
        recordsFetched: run.recordsFetched,
        recordsUpserted: run.recordsUpserted,
        recordsInactivated: run.recordsInactivated,
        recordsRejected: run.recordsRejected,
        status: 'failed',
        completedAt: clock(),
        errorCode,
        failedPage,
        rejectionReasons: error instanceof ProviderError ? error.rejections : null
      })
    } catch {
      // The caller receives only the sanitized synchronization error.
    }
    throw new SyncError(errorCode)
  }
}

// Marks a run failed after its segment kept failing transiently until the
// retries ran out, so it does not stay running until the next sync interrupts
// it. Its counters are the last committed ones, through the page before the
// failing one; the failing page itself is not recorded. A run that is no longer
// running was completed or interrupted already and is left alone.
export async function failSyncRun(
  storage: IngestionStorage,
  runId: number,
  errorCode: RunErrorCode,
  clock: () => Date = () => new Date()
) {
  let run: RunState
  try {
    run = await storage.loadRunningRun(runId)
  } catch (error) {
    if (error instanceof SyncError && error.code === 'sync_stale_continuation') return false
    throw error
  }
  await storage.completeRun(run, {
    pagesFetched: run.pagesFetched,
    recordsFetched: run.recordsFetched,
    recordsUpserted: run.recordsUpserted,
    recordsInactivated: run.recordsInactivated,
    recordsRejected: run.recordsRejected,
    status: 'failed',
    completedAt: clock(),
    errorCode,
    failedPage: null,
    rejectionReasons: null
  })
  return true
}
