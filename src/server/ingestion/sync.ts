import {
  ProviderError,
  type AuctionProvider,
  type NormalizedListing,
  type ProviderAdapter,
} from '../providers/types';

export type SyncErrorCode =
  | 'sync_invalid_request'
  | 'sync_failed'
  | 'sync_page_limit_exceeded'
  | 'sync_interrupted'
  | 'sync_stale_continuation'
  | 'sync_reconciliation_guard';

// Non-secret codes persisted on a failed run: a sync code or a
// provider-prefixed adapter code such as `dynadot_http_error`.
export type RunErrorCode = Exclude<SyncErrorCode, 'sync_interrupted'> | string;

export class SyncError extends Error {
  readonly code: RunErrorCode;

  constructor(code: RunErrorCode) {
    super(code);
    this.name = 'SyncError';
    this.code = code;
  }
}

export type RunCounters = {
  pagesFetched: number;
  recordsFetched: number;
  recordsUpserted: number;
  recordsInactivated: number;
  recordsRejected: number;
};

export type RunState = RunCounters & {
  runId: number;
  startedAt: Date;
  nextPage: number;
};

export type RunCompletion = RunCounters & {
  status: 'failed';
  completedAt: Date;
  errorCode: RunErrorCode;
  failedPage: number | null;
};

export type SuccessfulRunFinalization = Omit<
  RunCounters,
  'recordsInactivated'
> & {
  completedAt: Date;
};

// Storage bound to a single provider. Every write is guarded by the matching
// running run, so a stale continuation cannot mutate state.
export type IngestionStorage = {
  provider: AuctionProvider;
  startRun(startedAt: Date): Promise<RunState>;
  loadRunningRun(runId: number): Promise<RunState>;
  upsertListings(run: RunState, listings: NormalizedListing[]): Promise<void>;
  finalizeSuccessfulRun(
    run: RunState,
    finalization: SuccessfulRunFinalization,
  ): Promise<number>;
  updateRunProgress(run: RunState): Promise<void>;
  completeRun(run: RunState, completion: RunCompletion): Promise<void>;
};

export type SyncSummary = RunCounters & {
  provider: AuctionProvider;
  status: 'succeeded';
};

export type SyncSegmentOptions = {
  clock?: () => Date;
  maxPages?: number;
  runId?: number;
  segmentPages?: number;
};

export type SyncSegmentResult =
  { done: false; run: RunState } | { done: true; summary: SyncSummary };

const MAX_PAGES_LIMIT = 10_000;

function positiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateOptions(
  maxPages: number,
  segmentPages: number,
  runId?: number,
) {
  if (
    !positiveInteger(maxPages) ||
    maxPages > MAX_PAGES_LIMIT ||
    !positiveInteger(segmentPages) ||
    (runId !== undefined && !positiveInteger(runId))
  ) {
    throw new SyncError('sync_invalid_request');
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
      run.recordsRejected,
    ].some((counter) => !Number.isSafeInteger(counter) || counter < 0)
  ) {
    throw new SyncError('sync_stale_continuation');
  }
}

function runErrorCode(error: unknown): RunErrorCode {
  if (error instanceof ProviderError) return error.code;
  if (error instanceof SyncError && error.code !== 'sync_interrupted') {
    return error.code;
  }
  return 'sync_failed';
}

export async function runSyncSegment(
  adapter: ProviderAdapter,
  storage: IngestionStorage,
  {
    clock = () => new Date(),
    maxPages = 1000,
    segmentPages = 20,
    runId,
  }: SyncSegmentOptions = {},
): Promise<SyncSegmentResult> {
  validateOptions(maxPages, segmentPages, runId);
  if (adapter.provider !== storage.provider) {
    throw new SyncError('sync_invalid_request');
  }
  const run = runId
    ? await storage.loadRunningRun(runId)
    : await storage.startRun(clock());
  validateRun(run, maxPages);

  let failedPage: number | null = null;
  try {
    const finalPageInSegment = Math.min(
      run.nextPage + segmentPages - 1,
      maxPages,
    );
    for (
      let pageIndex = run.nextPage;
      pageIndex <= finalPageInSegment;
      pageIndex += 1
    ) {
      failedPage = pageIndex;
      const page = await adapter.fetchPage({ pageIndex });
      run.pagesFetched += 1;
      run.recordsFetched += page.received;
      run.recordsRejected += page.rejected;
      await storage.upsertListings(run, page.listings);
      run.recordsUpserted += page.listings.length;
      run.nextPage = pageIndex + 1;

      if (page.isLastPage) {
        failedPage = null;
        run.recordsInactivated = await storage.finalizeSuccessfulRun(run, {
          pagesFetched: run.pagesFetched,
          recordsFetched: run.recordsFetched,
          recordsUpserted: run.recordsUpserted,
          recordsRejected: run.recordsRejected,
          completedAt: clock(),
        });
        return {
          done: true,
          summary: {
            provider: storage.provider,
            status: 'succeeded',
            pagesFetched: run.pagesFetched,
            recordsFetched: run.recordsFetched,
            recordsUpserted: run.recordsUpserted,
            recordsInactivated: run.recordsInactivated,
            recordsRejected: run.recordsRejected,
          },
        };
      }

      if (pageIndex === maxPages) {
        throw new SyncError('sync_page_limit_exceeded');
      }
    }
    failedPage = null;

    await storage.updateRunProgress(run);
    return { done: false, run };
  } catch (error) {
    if (
      error instanceof SyncError &&
      error.code === 'sync_stale_continuation'
    ) {
      throw error;
    }
    const errorCode = runErrorCode(error);
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
      });
    } catch {
      // The caller receives only the sanitized synchronization error.
    }
    throw new SyncError(errorCode);
  }
}
