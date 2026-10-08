// The daily Ahrefs DR backfill as Cloudflare Workflow steps. It rates every
// domain with an open listing that has no stored DR, so DR can be filtered
// and sorted across the whole inventory rather than only the rows someone
// has viewed. `sync-worker.ts` is the thin runtime entry.
//
//   [wait for the provider syncs]   cron runs only: today's new listings first
//   rate domains, step 1..n         one Ahrefs call for up to 1,000 domains
//   pace after step n               between calls
//   wait for the Ahrefs cool-down   after a 429, as long as Ahrefs asked
//
// Each step walks the domain-name index from the last domain the previous
// step rated, so a run reads the inventory once. Results are written without
// the on-demand route's claims, which halves D1 writes: the selection skips
// domains that route has claimed, and stored ratings are write-once, so an
// overlap costs at most one extra Ahrefs lookup. A run that stops part way is
// safe to run again: everything rated so far is skipped.
import { AHREFS_DR_MAX_TARGETS, AhrefsError } from './ahrefs'
import { type DomainRatingStore, type FetchDomainRatings, rateDomains } from './domain-rating'
import { RATEABLE_DOMAIN } from './domain-rating-request'

export type DomainRatingBackfillParams = { startDelayMs?: number }

export type DomainRatingBackfillStore = Pick<DomainRatingStore, 'coolDownUntil' | 'record'> & {
  // Up to `limit` domains after `after`, in name order, that have a listing
  // open at `now` and need a rating.
  domainsToRate(after: string, now: Date, limit: number): Promise<string[]>
}

// The subset of a Workflow step's options and of Workflows' `step` used here,
// as in `provider-sync-workflow.ts`.
export type BackfillStepRunner = {
  do<T>(
    name: string,
    config: {
      retries: { limit: number; delay: string; backoff: 'constant' | 'linear' | 'exponential' }
      timeout: string
    },
    callback: () => Promise<T>
  ): Promise<T>
  sleep(name: string, milliseconds: number): Promise<void>
}

export type DomainRatingBackfillSummary = {
  status: 'succeeded'
  // Ahrefs calls made, domains asked about, and ratings written.
  calls: number
  requested: number
  stored: number
  // False when the run stopped at its call budget with domains left to rate.
  complete: boolean
}

// A failed call is retried after 1, 2, then 4 minutes; one call takes at most
// the client's 15-second timeout.
export const RATE_DOMAINS_STEP = {
  retries: { limit: 3, delay: '1 minute', backoff: 'exponential' },
  timeout: '5 minutes'
} as const
// Ahrefs publishes no limit for the free endpoint, so calls start at least
// two seconds apart (the providers' conservative default), and a 429 sets the
// shared cool-down that this run and the on-demand route both wait out.
export const RATE_DOMAINS_INTERVAL_MS = 2_000
// At most this many calls (1,000,000 domains) per daily run, which keeps one
// run to a few hours and its D1 writes bounded; the next run continues.
export const MAX_RATE_DOMAINS_CALLS = 1_000
// The cron run waits this long, so the provider syncs it shares a Cron
// Trigger with have stored the day's new listings.
export const PROVIDER_SYNC_HEAD_START_MS = 60 * 60_000

type StepOutcome =
  | { kind: 'done' }
  | { kind: 'rated'; cursor: string; requested: number; stored: number }
  // `called` when this step's own call was rate-limited.
  | { kind: 'wait'; milliseconds: number; called: boolean }
  // Ahrefs refused the key. Thrown outside the step, so the instance error
  // is the bare code (as `provider-sync-workflow.ts` does).
  | { kind: 'rejected'; code: string }

export async function runDomainRatingBackfill({
  step,
  store,
  fetchRatings,
  nonRetryable,
  startDelayMs = 0,
  maxCalls = MAX_RATE_DOMAINS_CALLS,
  now = () => new Date()
}: {
  step: BackfillStepRunner
  store: DomainRatingBackfillStore
  fetchRatings: FetchDomainRatings
  // Builds an error that fails the instance without further retries.
  nonRetryable: (code: string) => Error
  startDelayMs?: number
  maxCalls?: number
  now?: () => Date
}): Promise<DomainRatingBackfillSummary> {
  if (startDelayMs > 0) await step.sleep('wait for the provider syncs', startDelayMs)

  const summary: DomainRatingBackfillSummary = {
    status: 'succeeded',
    calls: 0,
    requested: 0,
    stored: 0,
    complete: false
  }
  let cursor = ''
  for (let stepNumber = 1; summary.calls < maxCalls; stepNumber += 1) {
    const outcome = await step.do<StepOutcome>(
      `rate domains, step ${stepNumber}`,
      RATE_DOMAINS_STEP,
      async () => {
        const startedAt = now()
        const coolDownUntil = await store.coolDownUntil(startedAt)
        if (coolDownUntil) {
          return {
            kind: 'wait',
            milliseconds: coolDownUntil.getTime() - startedAt.getTime(),
            called: false
          }
        }
        const candidates = await store.domainsToRate(cursor, startedAt, AHREFS_DR_MAX_TARGETS)
        if (candidates.length === 0) return { kind: 'done' }
        // A stored name Ahrefs cannot take is passed over, never sent.
        const domains = candidates.filter(domain => RATEABLE_DOMAIN.test(domain))
        const last = candidates[candidates.length - 1] as string
        if (domains.length === 0) return { kind: 'rated', cursor: last, requested: 0, stored: 0 }
        try {
          const stored = await rateDomains(store, fetchRatings, domains, { startedAt, now })
          return { kind: 'rated', cursor: last, requested: domains.length, stored }
        } catch (error) {
          if (error instanceof AhrefsError && error.code === 'ahrefs_rate_limited') {
            // `rateDomains` stored the cool-down; the next step reads it.
            return { kind: 'wait', milliseconds: 0, called: true }
          }
          if (error instanceof AhrefsError && error.code === 'ahrefs_unauthorized') {
            return { kind: 'rejected', code: error.code }
          }
          throw error
        }
      }
    )
    if (outcome.kind === 'rejected') throw nonRetryable(outcome.code)
    if (outcome.kind === 'done') {
      summary.complete = true
      break
    }
    if (outcome.kind === 'wait') {
      // A rate-limited call counts toward the budget, so a run that Ahrefs
      // keeps refusing still ends.
      if (outcome.called) summary.calls += 1
      if (outcome.milliseconds > 0) {
        await step.sleep(`wait for the Ahrefs cool-down, step ${stepNumber}`, outcome.milliseconds)
      }
      continue
    }
    cursor = outcome.cursor
    if (outcome.requested > 0) summary.calls += 1
    summary.requested += outcome.requested
    summary.stored += outcome.stored
    await step.sleep(`pace after step ${stepNumber}`, RATE_DOMAINS_INTERVAL_MS)
  }
  console.info('domain_rating_backfill', summary)
  return summary
}
