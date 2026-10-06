// The provider sync as Cloudflare Workflow steps. `sync-worker.ts` is the
// thin runtime entry (Workflow class and Cron Trigger); everything here takes
// its step runner and bindings as arguments so it is tested directly.
//
//   [stage feed]                  file feeds only: zip -> R2 page files
//   sync pages, segment 1..n      runSyncSegment over 20 pages per step
//   [delete staged pages]         file feeds only, also after a failure
//
// Each completed step's result is persisted by Workflows. A step interrupted
// by the platform is retried; a sync step resumes from the run's
// server-owned `next_page` in D1. A sync error has already marked the run
// failed, so it is not retried within the instance.
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import {
  implementedProvider,
  PROVIDER_REGISTRY,
  type ProviderSecrets,
} from '../providers/registry';
import type { AuctionProvider } from '../providers/types';
import { createD1IngestionStorage } from './d1-storage';
import {
  createR2PageSink,
  createR2PageSource,
  deleteFeedPages,
  feedPagesPrefix,
  type FeedPageBucket,
} from './feed-pages';
import { FeedError, stageZippedFeed } from './feed-stage';
import {
  runSyncSegment,
  SyncError,
  type IngestionStorage,
  type SyncSummary,
} from './sync';

export type ProviderSyncParams = { provider: string };

export type SyncWorkerEnv = ProviderSecrets & {
  DB: D1Database;
  FEED_PAGES: R2Bucket;
  PROVIDER_SYNC: Workflow<ProviderSyncParams>;
};

// The subset of a Workflow step's options used here.
export type StepConfig = {
  retries: {
    limit: number;
    delay: string;
    backoff: 'constant' | 'linear' | 'exponential';
  };
  timeout: string;
};

// The subset of Workflows' `step` used here.
export type StepRunner = {
  do<T>(
    name: string,
    config: StepConfig,
    callback: () => Promise<T>,
  ): Promise<T>;
};

export const STAGE_STEP: StepConfig = {
  retries: { limit: 2, delay: '1 minute', backoff: 'exponential' },
  timeout: '15 minutes',
};
export const SYNC_STEP: StepConfig = {
  retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' },
  timeout: '15 minutes',
};
export const CLEANUP_STEP: StepConfig = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '5 minutes',
};

const SEGMENT_PAGES = 20;
// GoDaddy's archive is about 37 MB zipped and 450 MB unzipped.
const FEED_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const FEED_ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
const FEED_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
// A truncated or failed download may succeed on retry; a malformed or
// oversized feed will not.
const RETRYABLE_FEED_ERRORS = new Set([
  'feed_download_failed',
  'feed_extract_failed',
]);

type SegmentOutcome =
  { done: true; summary: SyncSummary } | { done: false; runId: number };

export type ProviderSyncDependencies = {
  fetchImpl?: typeof fetch;
  createStorage?: (
    database: D1Database,
    provider: AuctionProvider,
  ) => IngestionStorage;
};

export async function runProviderSync({
  provider: requested,
  runKey,
  env,
  step,
  nonRetryable,
  dependencies = {},
}: {
  provider: string;
  // Unique per Workflow instance (its ID); names the staged-page prefix.
  runKey: string;
  env: Omit<SyncWorkerEnv, 'PROVIDER_SYNC'>;
  step: StepRunner;
  // Builds an error that fails the instance without further retries.
  nonRetryable: (code: string) => Error;
  dependencies?: ProviderSyncDependencies;
}): Promise<SyncSummary> {
  // Errors thrown from `run` outside a step end the instance without retry,
  // and their message is the instance's reported error.
  const provider = implementedProvider(requested);
  if (!provider) throw new Error('sync_unknown_provider');
  const registration = PROVIDER_REGISTRY[provider]!;
  if (registration.secretNames.some((name) => !env[name])) {
    throw new Error(`${provider}_missing_credentials`);
  }
  const { fileFeed } = registration;
  const bucket: FeedPageBucket = env.FEED_PAGES;
  const prefix = fileFeed ? feedPagesPrefix(provider, runKey) : null;

  const adapter = registration.createAdapter({
    secrets: env,
    feedPages: prefix ? createR2PageSource(bucket, prefix) : undefined,
  });
  /* v8 ignore next 3 -- default wiring is exercised by the D1/R2 proof and local run */
  const storage = dependencies.createStorage
    ? dependencies.createStorage(env.DB, provider)
    : createD1IngestionStorage(drizzle(env.DB, { schema }), provider);

  const stageAndSync = async (): Promise<SyncSummary> => {
    if (fileFeed && prefix) {
      await step.do('stage feed', STAGE_STEP, async () => {
        try {
          return await stageZippedFeed({
            url: fileFeed.url,
            entry: fileFeed.entry,
            field: fileFeed.field,
            pageSize: fileFeed.pageSize,
            maxArchiveBytes: FEED_ARCHIVE_MAX_BYTES,
            maxDocumentBytes: FEED_DOCUMENT_MAX_BYTES,
            timeoutMs: FEED_DOWNLOAD_TIMEOUT_MS,
            sink: createR2PageSink(bucket, prefix),
            fetchImpl: dependencies.fetchImpl,
          });
        } catch (error) {
          const code =
            error instanceof FeedError ? error.code : 'feed_stage_failed';
          throw RETRYABLE_FEED_ERRORS.has(code)
            ? new Error(code)
            : nonRetryable(code);
        }
      });
    }

    let runId: number | undefined;
    for (let segment = 1; ; segment += 1) {
      const outcome = await step.do(
        `sync pages, segment ${segment}`,
        SYNC_STEP,
        async (): Promise<SegmentOutcome> => {
          try {
            const result = await runSyncSegment(adapter, storage, {
              runId,
              segmentPages: SEGMENT_PAGES,
            });
            return result.done
              ? { done: true, summary: result.summary }
              : { done: false, runId: result.run.runId };
          } catch (error) {
            // The run is already marked failed with this code.
            throw nonRetryable(
              error instanceof SyncError ? error.code : 'sync_failed',
            );
          }
        },
      );
      if (outcome.done) return outcome.summary;
      runId = outcome.runId;
    }
  };

  let result: { summary: SyncSummary } | { failure: unknown };
  try {
    result = { summary: await stageAndSync() };
  } catch (failure) {
    result = { failure };
  }
  // Staged pages are deleted after success and failure alike. A cleanup
  // failure is reported only when the sync itself succeeded.
  if (prefix) {
    try {
      await step.do('delete staged pages', CLEANUP_STEP, async () => ({
        deleted: await deleteFeedPages(bucket, prefix),
      }));
    } catch (cleanupFailure) {
      if ('summary' in result) result = { failure: cleanupFailure };
    }
  }
  // A failed step surfaces as a generic Workflows error unless its fixed
  // code is rethrown from `run`.
  if ('failure' in result) throw new Error(fixedErrorCode(result.failure));
  return result.summary;
}

// Workflows rejects `step.do` for a step that threw a NonRetryableError with
// the message `NonRetryableError: <message>`; a step that exhausted its
// retries keeps its own message.
const STEP_ERROR_CODE = /^(?:NonRetryableError: )?([a-z]+_[a-z_]+)$/;

// The instance error is a fixed, non-secret code such as
// `sync_reconciliation_guard` or `feed_download_failed`.
export function fixedErrorCode(error: unknown) {
  const match =
    error instanceof Error ? STEP_ERROR_CODE.exec(error.message) : null;
  return match ? match[1]! : 'sync_failed';
}

// One instance per implemented provider for a Cron Trigger firing. The
// instance ID is derived from the scheduled time, so a repeated delivery of
// the same firing cannot start a second instance.
export async function scheduleProviderSyncs(
  workflow: Pick<Workflow<ProviderSyncParams>, 'create'>,
  scheduledTime: Date,
) {
  const stamp = scheduledTime.toISOString().replace(/[-:]/g, '').slice(0, 13);
  const providers = Object.keys(PROVIDER_REGISTRY);
  const results = await Promise.allSettled(
    providers.map((provider) =>
      workflow.create({ id: `${provider}-${stamp}`, params: { provider } }),
    ),
  );
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('sync_schedule_failed');
  }
  return providers;
}
