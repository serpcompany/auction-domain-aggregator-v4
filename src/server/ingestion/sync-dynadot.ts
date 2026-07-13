import type { DynadotListing } from '../providers/dynadot';

export type FetchDynadotListingsPage = (input: {
  pageIndex: number;
  pageSize: number;
}) => Promise<DynadotListing[]>;

export type DynadotSyncErrorCode =
  | 'dynadot_sync_invalid_request'
  | 'dynadot_sync_failed'
  | 'dynadot_page_limit_exceeded'
  | 'dynadot_sync_interrupted'
  | 'dynadot_stale_continuation';

export class DynadotSyncError extends Error {
  readonly code: DynadotSyncErrorCode;

  constructor(code: DynadotSyncErrorCode) {
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
};

export type DynadotRunState = RunCounters & {
  runId: number;
  startedAt: Date;
  nextPage: number;
};

export type DynadotRunCompletion = RunCounters & {
  status: 'failed';
  completedAt: Date;
  errorCode: Exclude<DynadotSyncErrorCode, 'dynadot_sync_interrupted'>;
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
      const listings = await fetchPage({ pageIndex, pageSize });
      run.pagesFetched += 1;
      run.recordsFetched += listings.length;
      await storage.upsertListings(run, listings);
      run.recordsUpserted += listings.length;
      run.nextPage = pageIndex + 1;

      if (listings.length < pageSize) {
        run.recordsInactivated = await storage.finalizeSuccessfulRun(run, {
          pagesFetched: run.pagesFetched,
          recordsFetched: run.recordsFetched,
          recordsUpserted: run.recordsUpserted,
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
          },
        };
      }

      if (pageIndex === maxPages) {
        throw new DynadotSyncError('dynadot_page_limit_exceeded');
      }
    }

    await storage.updateRunProgress(run);
    return { done: false, run };
  } catch (error) {
    if (
      error instanceof DynadotSyncError &&
      error.code === 'dynadot_stale_continuation'
    ) {
      throw error;
    }
    const errorCode =
      error instanceof DynadotSyncError &&
      error.code === 'dynadot_page_limit_exceeded'
        ? error.code
        : 'dynadot_sync_failed';
    try {
      await storage.completeRun(run, {
        pagesFetched: run.pagesFetched,
        recordsFetched: run.recordsFetched,
        recordsUpserted: run.recordsUpserted,
        recordsInactivated: run.recordsInactivated,
        status: 'failed',
        completedAt: clock(),
        errorCode,
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
