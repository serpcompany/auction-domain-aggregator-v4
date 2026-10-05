import {
  DynadotProviderError,
  type DynadotListing,
  type DynadotPage,
  type DynadotProviderErrorCode,
} from '../providers/dynadot';

// A bare array means every auction the provider returned was valid.
export type FetchDynadotListingsPage = (input: {
  pageIndex: number;
  pageSize: number;
}) => Promise<DynadotPage | DynadotListing[]>;

export type DynadotSyncErrorCode =
  | 'dynadot_sync_invalid_request'
  | 'dynadot_sync_failed'
  | 'dynadot_page_limit_exceeded'
  | 'dynadot_sync_interrupted'
  | 'dynadot_stale_continuation'
  | 'dynadot_reconciliation_guard';

export class DynadotSyncError extends Error {
  readonly code: DynadotSyncErrorCode | DynadotProviderErrorCode;

  constructor(code: DynadotSyncErrorCode | DynadotProviderErrorCode) {
    super(code);
    this.name = 'DynadotSyncError';
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

// Non-secret codes persisted on a failed run.
export type DynadotRunErrorCode =
  | Exclude<DynadotSyncErrorCode, 'dynadot_sync_interrupted'>
  | DynadotProviderErrorCode;

export type DynadotRunState = RunCounters & {
  runId: number;
  startedAt: Date;
  nextPage: number;
};

export type DynadotRunCompletion = RunCounters & {
  status: 'failed';
  completedAt: Date;
  errorCode: DynadotRunErrorCode;
  failedPage: number | null;
};

export type DynadotSuccessfulRunFinalization = Omit<
  RunCounters,
  'recordsInactivated'
> & {
  completedAt: Date;
};

export type DynadotIngestionStorage = {
  startRun(startedAt: Date): Promise<DynadotRunState>;
  loadRunningRun(runId: number): Promise<DynadotRunState>;
  upsertListings(
    run: DynadotRunState,
    listings: DynadotListing[],
  ): Promise<void>;
  finalizeSuccessfulRun(
    run: DynadotRunState,
    finalization: DynadotSuccessfulRunFinalization,
  ): Promise<number>;
  updateRunProgress(run: DynadotRunState): Promise<void>;
  completeRun(
    run: DynadotRunState,
    completion: DynadotRunCompletion,
  ): Promise<void>;
};

export type DynadotSyncSummary = RunCounters & {
  provider: 'dynadot';
  status: 'succeeded';
};

export type SyncDynadotOptions = {
  fetchPage: FetchDynadotListingsPage;
  clock?: () => Date;
  pageSize?: number;
  maxPages?: number;
};

type SegmentOptions = SyncDynadotOptions & {
  runId?: number;
  segmentPages?: number;
};

export type DynadotSegmentResult =
  | { done: false; run: DynadotRunState }
  | { done: true; summary: DynadotSyncSummary };

function toPage(result: DynadotPage | DynadotListing[]): DynadotPage {
  return Array.isArray(result)
    ? { listings: result, received: result.length, rejected: 0 }
    : result;
}

function runErrorCode(error: unknown): DynadotRunErrorCode {
  if (error instanceof DynadotProviderError) return error.code;
  if (
    error instanceof DynadotSyncError &&
    error.code !== 'dynadot_sync_interrupted'
  ) {
    return error.code;
  }
  return 'dynadot_sync_failed';
}

function positiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateOptions(
  pageSize: number,
  maxPages: number,
  segmentPages: number,
  runId?: number,
) {
  if (
    !positiveInteger(pageSize) ||
    pageSize > 1000 ||
    !positiveInteger(maxPages) ||
    maxPages > 1000 ||
    !positiveInteger(segmentPages) ||
    (runId !== undefined && !positiveInteger(runId))
  ) {
    throw new DynadotSyncError('dynadot_sync_invalid_request');
  }
}

function validateRun(run: DynadotRunState, maxPages: number) {
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
    throw new DynadotSyncError('dynadot_stale_continuation');
  }
}

export async function runDynadotSegment(
  storage: DynadotIngestionStorage,
  {
    fetchPage,
    clock = () => new Date(),
    pageSize = 1000,
    maxPages = 1000,
    segmentPages = 20,
    runId,
  }: SegmentOptions,
): Promise<DynadotSegmentResult> {
  validateOptions(pageSize, maxPages, segmentPages, runId);
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
      const page = toPage(await fetchPage({ pageIndex, pageSize }));
      run.pagesFetched += 1;
      run.recordsFetched += page.received;
      run.recordsRejected += page.rejected;
      await storage.upsertListings(run, page.listings);
      run.recordsUpserted += page.listings.length;
      run.nextPage = pageIndex + 1;

      // The final page is the first short one, counted before rejection so a
      // skipped record cannot end the run early.
      if (page.received < pageSize) {
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
            provider: 'dynadot',
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
        throw new DynadotSyncError('dynadot_page_limit_exceeded');
      }
    }
    failedPage = null;

    await storage.updateRunProgress(run);
    return { done: false, run };
  } catch (error) {
    if (
      error instanceof DynadotSyncError &&
      error.code === 'dynadot_stale_continuation'
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
    throw new DynadotSyncError(errorCode);
  }
}

export async function syncDynadotWithStorage(
  storage: DynadotIngestionStorage,
  options: SyncDynadotOptions,
): Promise<DynadotSyncSummary> {
  let runId: number | undefined;
  while (true) {
    const result = await runDynadotSegment(storage, {
      ...options,
      runId,
      segmentPages: Math.min(options.maxPages ?? 1000, 20),
    });
    if (result.done) return result.summary;
    runId = result.run.runId;
  }
}
