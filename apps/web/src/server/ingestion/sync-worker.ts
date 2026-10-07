// Ingestion Worker entry (`wrangler.ingestion.jsonc`). Kept thin: the
// runtime-only Workflow class and Cron Trigger handler delegate to
// `provider-sync-workflow.ts`, which is unit-tested without the runtime.
// The Worker has no fetch handler, so it serves no HTTP routes.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from '../db/schema'
import { fetchDomainRatings } from '../enrichment/ahrefs'
import {
  type BackfillStepRunner,
  type DomainRatingBackfillParams,
  PROVIDER_SYNC_HEAD_START_MS,
  runDomainRatingBackfill
} from '../enrichment/domain-rating-backfill'
import { createD1DomainRatingStore } from '../enrichment/domain-rating-store'
import {
  type ProviderSyncParams,
  runProviderSync,
  type StepRunner,
  type SyncWorkerEnv,
  scheduleProviderSyncs
} from './provider-sync-workflow'

export class ProviderSyncWorkflow extends WorkflowEntrypoint<SyncWorkerEnv, ProviderSyncParams> {
  async run(event: Readonly<WorkflowEvent<ProviderSyncParams>>, step: WorkflowStep) {
    // Step results here are plain JSON objects, which Workflows persists.
    const runner: StepRunner = {
      do: (name, config, callback) =>
        step.do(name, config as never, callback as never) as Promise<never>,
      sleep: (name, milliseconds) => step.sleep(name, milliseconds)
    }
    return runProviderSync({
      provider: String(event.payload?.provider ?? ''),
      runKey: event.instanceId,
      env: this.env,
      step: runner,
      nonRetryable: code => new NonRetryableError(code)
    })
  }
}

export class DomainRatingWorkflow extends WorkflowEntrypoint<
  SyncWorkerEnv,
  DomainRatingBackfillParams
> {
  async run(event: Readonly<WorkflowEvent<DomainRatingBackfillParams>>, step: WorkflowStep) {
    const apiKey = this.env.AHREFS_API_KEY
    if (!apiKey) throw new NonRetryableError('ahrefs_missing_credentials')
    const runner: BackfillStepRunner = {
      do: (name, config, callback) =>
        step.do(name, config as never, callback as never) as Promise<never>,
      sleep: (name, milliseconds) => step.sleep(name, milliseconds)
    }
    return runDomainRatingBackfill({
      step: runner,
      store: createD1DomainRatingStore(drizzle(this.env.DB, { schema })),
      fetchRatings: domains => fetchDomainRatings({ apiKey, domains }),
      nonRetryable: code => new NonRetryableError(code),
      startDelayMs: event.payload?.startDelayMs ?? 0
    })
  }
}

const worker = {
  // The daily Cron Trigger starts one Workflow instance per provider, and the
  // DR backfill, which waits for them.
  async scheduled(controller: ScheduledController, env: SyncWorkerEnv) {
    const scheduledTime = new Date(controller.scheduledTime)
    const [syncs, backfill] = await Promise.allSettled([
      scheduleProviderSyncs(env.PROVIDER_SYNC, scheduledTime),
      // Scheduled the same way, so one failure cannot stop the other.
      Promise.resolve().then(() =>
        env.DOMAIN_RATING.create({
          id: `domain-rating-${scheduledTime.toISOString().replace(/[-:]/g, '').slice(0, 13)}`,
          params: { startDelayMs: PROVIDER_SYNC_HEAD_START_MS }
        })
      )
    ])
    if (syncs.status === 'rejected') throw syncs.reason
    if (backfill.status === 'rejected') throw new Error('domain_rating_schedule_failed')
  }
} satisfies ExportedHandler<SyncWorkerEnv>

export default worker
