// The provider sync as Cloudflare Workflow steps. `sync-worker.ts` is the
// thin runtime entry (Workflow class and Cron Trigger); everything here takes
// its step runner and bindings as arguments so it is tested directly.
//
//   start run                     a new running row in D1
//   [stage feed]                  file feeds only: zip or CSV -> R2 page files
//   sync pages, segment 1..n      runSyncSegment over 20 pages per step
//   [delete staged pages]         file feeds only, also after a failure
//
// Each completed step's result is persisted by Workflows. A step may run
// again: after a retryable error, or when the platform interrupts it before
// its result is persisted. Re-staging rewrites the same page keys, starting
// again interrupts the earlier run, and a sync step resumes the run from its
// server-owned `next_page` in D1. A transient sync failure (a network error,
// a rate limit, a failed D1 batch or R2 read) leaves the run running and is
// retried the same way; when its retries run out, a further step marks the
// run failed. When the provider said how long to wait, the Workflow sleeps
// at least that long before the segment runs again. Any other sync error has
// already marked the run failed, so it is not retried within the instance.
import { drizzle } from 'drizzle-orm/d1'

import * as schema from '../db/schema'
import type { DomainRatingBackfillParams } from '../enrichment/domain-rating-backfill'
import { createPacer } from '../providers/rate-limit'
import { implementedProvider, PROVIDER_REGISTRY, type ProviderSecrets } from '../providers/registry'
import type { AuctionProvider, ProviderAdapter } from '../providers/types'
import { createD1IngestionStorage } from './d1-storage'
import { stageCsvFeed } from './feed-csv'
import {
  createR2PageSink,
  createR2PageSource,
  deleteFeedPages,
  type FeedPageBucket,
  feedPagesPrefix,
  timePageWrites
} from './feed-pages'
import { type FeedErrorCode, feedErrorCode, stageZippedFeed } from './feed-stage'
import { findNamesiloRecording, replayNamesiloRecording } from './namesilo-recording'
import {
  failSyncRun,
  type IngestionStorage,
  runSyncSegment,
  SyncError,
  type SyncSummary,
  startSyncRun
} from './sync'

export type ProviderSyncParams = { provider: string }

export type SyncWorkerEnv = ProviderSecrets & {
  DB: D1Database
  FEED_PAGES: R2Bucket
  PROVIDER_SYNC: Workflow<ProviderSyncParams>
  DOMAIN_RATING: Workflow<DomainRatingBackfillParams>
  // The DR backfill's key; without it, its daily instance fails at once.
  AHREFS_API_KEY?: string
}

// The subset of a Workflow step's options used here.
export type StepConfig = {
  retries: {
    limit: number
    delay: string
    backoff: 'constant' | 'linear' | 'exponential'
  }
  timeout: string
}

// The subset of Workflows' `step` used here.
export type StepRunner = {
  do<T>(name: string, config: StepConfig, callback: () => Promise<T>): Promise<T>
  sleep(name: string, milliseconds: number): Promise<void>
}

export const STAGE_STEP: StepConfig = {
  retries: { limit: 2, delay: '1 minute', backoff: 'exponential' },
  timeout: '15 minutes'
}
// Dynadot's rate limit asks for a minute before the next request, so the
// first retry waits that long (then 2 and 4 minutes).
export const SYNC_STEP: StepConfig = {
  retries: { limit: 3, delay: '1 minute', backoff: 'exponential' },
  timeout: '15 minutes'
}
// SYNC_STEP's retry delays in milliseconds: 1, 2, then 4 minutes.
const syncRetryDelayMs = (retry: number) => 60_000 * 2 ** (retry - 1)
// A provider asking for a longer wait than this fails the run instead; the
// next daily sync tries again.
export const MAX_PROVIDER_WAIT_MS = 60 * 60_000
export const CLEANUP_STEP: StepConfig = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '5 minutes'
}

const SEGMENT_PAGES = 20
// GoDaddy's archive is about 37 MB zipped and 450 MB unzipped. The download
// is read while its pages are written, so it gets most of the stage step's
// 15 minutes.
const FEED_DOWNLOAD_TIMEOUT_MS = 14 * 60_000
const FEED_ARCHIVE_MAX_BYTES = 512 * 1024 * 1024
const FEED_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024 * 1024
// Namecheap's CSV is about 194 MB.
const FEED_CSV_MAX_BYTES = 1024 * 1024 * 1024
// A failed or truncated download, or a failed page write, may succeed on
// retry; an unsupported, malformed, or oversized feed will not.
const RETRYABLE_FEED_ERRORS = new Set<FeedErrorCode>([
  'feed_download_failed',
  'feed_extract_failed',
  'feed_page_write_failed'
])

// `wait` is a transient failure with the provider's requested delay. The step
// returns it rather than throwing, so the Workflow can sleep before the
// segment runs again.
type SegmentOutcome =
  | { done: true; summary: SyncSummary }
  | { done: false; runId: number }
  | { done: false; runId: number; wait: { code: string; milliseconds: number } }

export type ProviderSyncDependencies = {
  fetchImpl?: typeof fetch
  createStorage?: (database: D1Database, provider: AuctionProvider) => IngestionStorage
  // Replaces the pacer's timer, so tests do not wait in real time.
  wait?: (milliseconds: number) => Promise<void>
}

export async function runProviderSync({
  provider: requested,
  runKey,
  env,
  step,
  nonRetryable,
  dependencies = {}
}: {
  provider: string
  // Unique per Workflow instance (its ID); names the staged-page prefix.
  runKey: string
  env: Omit<SyncWorkerEnv, 'PROVIDER_SYNC' | 'DOMAIN_RATING'>
  step: StepRunner
  // Builds an error that fails the instance without further retries.
  nonRetryable: (code: string) => Error
  dependencies?: ProviderSyncDependencies
}): Promise<SyncSummary> {
  // Errors thrown from `run` outside a step end the instance without retry,
  // and their message is the instance's reported error.
  const provider = implementedProvider(requested)
  if (!provider) throw new Error('sync_unknown_provider')
  const registration = PROVIDER_REGISTRY[provider]!
  if (registration.secretNames.some(name => !env[name])) {
    throw new Error(`${provider}_missing_credentials`)
  }
  const { fileFeed } = registration
  const bucket: FeedPageBucket = env.FEED_PAGES
  let prefix: string | null = null
  let adapter: ProviderAdapter
  if (registration.fileFeed) {
    prefix = feedPagesPrefix(provider, runKey)
    adapter = registration.createAdapter({
      secrets: env,
      feedPages: createR2PageSource(bucket, prefix)
    })
  } else {
    // Every request of an API provider waits for its declared rate limit.
    adapter = registration.createAdapter({
      secrets: env,
      pacer: createPacer(registration.rateLimit.intervalMs, { wait: dependencies.wait })
    })
  }
  const storage = dependencies.createStorage
    ? dependencies.createStorage(env.DB, provider)
    : createD1IngestionStorage(drizzle(env.DB, { schema }), provider)

  const stageAndSync = async (): Promise<SyncSummary> => {
    // NameSilo blocks Cloudflare Workers, so a deployed sync replays the
    // responses a GitHub Actions job recorded (`namesilo-recording.ts`). The
    // step pins the recording for the whole run; without a fresh one, as in
    // local development, the adapter calls NameSilo.
    if (provider === 'namesilo' && !registration.fileFeed) {
      const { recording } = await step.do('find recorded responses', SYNC_STEP, async () => ({
        recording: await findNamesiloRecording(bucket, new Date())
      }))
      if (recording) {
        adapter = registration.createAdapter({
          secrets: env,
          pacer: async () => undefined,
          fetchImpl: replayNamesiloRecording(bucket, recording)
        })
      }
    }
    // Started before staging, so the Sync status page shows a feed that is
    // downloading, and one that fails to stage. A failure here (a D1 error)
    // changed nothing that a retry would not replace, so it is retried.
    let runId = await step.do('start run', SYNC_STEP, async () => {
      try {
        return await startSyncRun(storage)
      } catch {
        throw new Error('sync_failed')
      }
    })
    const recordFailedRun = async (code: string) => {
      const failedRunId = runId
      // Best effort: if this fails too, the next sync interrupts the run.
      await step
        .do('record failed run', SYNC_STEP, async () => ({
          recorded: await failSyncRun(storage, failedRunId, code)
        }))
        .catch(() => undefined)
    }
    if (fileFeed && prefix) {
      try {
        await step.do('stage feed', STAGE_STEP, async () => {
          const writes = timePageWrites(createR2PageSink(bucket, prefix))
          const common = {
            url: fileFeed.url,
            pageSize: fileFeed.pageSize,
            limits: {
              maxPages: fileFeed.maxPages,
              maxPageBytes: fileFeed.maxPageBytes
            },
            timeoutMs: FEED_DOWNLOAD_TIMEOUT_MS,
            sink: writes.sink,
            fetchImpl: dependencies.fetchImpl
          }
          // Workers Logs shows how long staging took and how long each page
          // write waited, so a slow download and slow writes can be told apart.
          const started = Date.now()
          const timing = () => ({
            provider,
            seconds: Math.round((Date.now() - started) / 1000),
            ...writes.stats()
          })
          try {
            const staged =
              fileFeed.format === 'csv'
                ? await stageCsvFeed({ ...common, maxBytes: FEED_CSV_MAX_BYTES })
                : await stageZippedFeed({
                    ...common,
                    entry: fileFeed.entry,
                    field: fileFeed.field,
                    maxArchiveBytes: FEED_ARCHIVE_MAX_BYTES,
                    maxDocumentBytes: FEED_DOCUMENT_MAX_BYTES
                  })
            console.info('feed_staged', { ...timing(), records: staged.records })
            return staged
          } catch (error) {
            const code = feedErrorCode(error)
            console.warn('feed_stage_failed', { ...timing(), code: code ?? 'feed_stage_failed' })
            if (!code) throw nonRetryable('feed_stage_failed')
            throw RETRYABLE_FEED_ERRORS.has(code) ? new Error(code) : nonRetryable(code)
          }
        })
      } catch (error) {
        await recordFailedRun(fixedErrorCode(error))
        throw error
      }
    }
    // `waits` counts the provider-requested waits within the current segment.
    for (let segment = 1, waits = 0; ; ) {
      let outcome: SegmentOutcome
      try {
        outcome = await step.do(
          waits === 0
            ? `sync pages, segment ${segment}`
            : `sync pages, segment ${segment}, retry ${waits}`,
          SYNC_STEP,
          async (): Promise<SegmentOutcome> => {
            try {
              const result = await runSyncSegment(adapter, storage, {
                runId,
                segmentPages: SEGMENT_PAGES
              })
              return result.done
                ? { done: true, summary: result.summary }
                : { done: false, runId: result.run.runId }
            } catch (error) {
              // A transient SyncError left the run running, so it is
              // retried, after the provider's requested wait when it gave
              // one. Any other SyncError is final: the run is already
              // marked failed with its code, or is no longer running. Any
              // other error came from loading the run before a page was
              // read, so it is retried too.
              if (error instanceof SyncError) {
                if (error.transient && error.retryAfterMs !== null) {
                  return {
                    done: false,
                    runId,
                    wait: { code: error.code, milliseconds: error.retryAfterMs }
                  }
                }
                throw error.transient ? new Error(error.code) : nonRetryable(error.code)
              }
              throw new Error('sync_failed')
            }
          }
        )
      } catch (error) {
        if (!isNonRetryableFailure(error)) await recordFailedRun(fixedErrorCode(error))
        throw error
      }
      if (outcome.done) return outcome.summary
      if ('wait' in outcome) {
        // As many waits as the step has retries, each at least as long as
        // the provider asked and as the step's own backoff.
        const { code, milliseconds } = outcome.wait
        if (waits === SYNC_STEP.retries.limit || milliseconds > MAX_PROVIDER_WAIT_MS) {
          await recordFailedRun(code)
          throw new Error(code)
        }
        waits += 1
        await step.sleep(
          `wait before segment ${segment}, retry ${waits}`,
          Math.max(milliseconds, syncRetryDelayMs(waits))
        )
        continue
      }
      runId = outcome.runId
      segment += 1
      waits = 0
    }
  }

  let result: { summary: SyncSummary } | { failure: unknown }
  try {
    result = { summary: await stageAndSync() }
  } catch (failure) {
    result = { failure }
  }
  // Staged pages are deleted after success and failure alike. A cleanup
  // failure is reported only when the sync itself succeeded.
  if (prefix) {
    try {
      await step.do('delete staged pages', CLEANUP_STEP, async () => ({
        deleted: await deleteFeedPages(bucket, prefix)
      }))
    } catch (cleanupFailure) {
      if ('summary' in result) result = { failure: cleanupFailure }
    }
  }
  // A failed step surfaces as a generic Workflows error unless its fixed
  // code is rethrown from `run`.
  if ('failure' in result) throw new Error(fixedErrorCode(result.failure))
  return result.summary
}

// Workflows rejects `step.do` for a step that threw a NonRetryableError with
// the message `NonRetryableError: <message>`; a step that exhausted its
// retries keeps its own message.
const STEP_ERROR_CODE = /^(?:NonRetryableError: )?([a-z]+_[a-z_]+)$/

function isNonRetryableFailure(error: unknown) {
  return error instanceof Error && error.message.startsWith('NonRetryableError: ')
}

// The instance error is a fixed, non-secret code such as
// `sync_reconciliation_guard` or `feed_download_failed`.
export function fixedErrorCode(error: unknown) {
  const match = error instanceof Error ? STEP_ERROR_CODE.exec(error.message) : null
  return match ? match[1]! : 'sync_failed'
}

// One instance per implemented provider for a Cron Trigger firing. The
// instance ID is derived from the scheduled time, so a repeated delivery of
// the same firing cannot start a second instance.
export async function scheduleProviderSyncs(
  workflow: Pick<Workflow<ProviderSyncParams>, 'create'>,
  scheduledTime: Date
) {
  const stamp = scheduledTime.toISOString().replace(/[-:]/g, '').slice(0, 13)
  const providers = Object.keys(PROVIDER_REGISTRY)
  const results = await Promise.allSettled(
    providers.map(provider => workflow.create({ id: `${provider}-${stamp}`, params: { provider } }))
  )
  if (results.some(result => result.status === 'rejected')) {
    throw new Error('sync_schedule_failed')
  }
  return providers
}
