import { count, eq, gte, inArray, like } from 'drizzle-orm'

import { parseDomainTableFilters } from '../../domain/domain-table'
import { ahrefsRequests, auctionListings, domainMetrics, domains } from '../db/schema'
import type { AppDatabase } from '../db/types'
import { queryDomainListingsWithDatabase } from '../queries/domain-listings-query'
import { AhrefsError } from './ahrefs'
import {
  DOMAIN_RATING_CLAIM_MS,
  DOMAIN_RATING_OMITTED_RETRY_MS,
  DOMAIN_RATING_REQUEST_LIMIT,
  DomainRatingCoolDown,
  enrichDomainRatings,
  type FetchDomainRatings
} from './domain-rating'
import { createD1DomainRatingStore } from './domain-rating-store'

const T0 = new Date('2026-07-17T00:00:00.000Z').getTime()
const ENDS_AT = new Date('2026-08-01T00:00:00.000Z')
const NAMES = Array.from(
  { length: DOMAIN_RATING_REQUEST_LIMIT },
  (_, index) => `limit-${String(index).padStart(2, '0')}.integration.test`
)

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code)
}

function at(offsetMs: number) {
  return () => new Date(T0 + offsetMs)
}

// The D1 store's claims, omissions, cool-down, and request log, proved against
// real D1 with a full page of domains and an invented Ahrefs. Run by the
// integration Worker; it removes its rows afterwards.
export async function proveDomainRatingLimits(database: AppDatabase) {
  const store = createD1DomainRatingStore(database)
  const signal = new AbortController().signal
  const seenAt = new Date(T0)
  await database
    .insert(domains)
    .values(NAMES.map(name => ({ name, firstSeenAt: seenAt })))
    .onConflictDoNothing()
  // About a dozen bound values per listing; five rows stay well below D1's
  // 100 bound parameters.
  for (let index = 0; index < NAMES.length; index += 5) {
    await database.insert(auctionListings).values(
      NAMES.slice(index, index + 5).map(name => ({
        provider: 'dynadot',
        externalId: name,
        domainName: name,
        auctionUrl: `https://example.invalid/auction/${name}`,
        auctionType: 'expired',
        currency: 'USD',
        currentBidCents: 100,
        endsAt: ENDS_AT,
        status: 'active' as const,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt
      }))
    )
  }

  // Concurrent requests for the same page: one claims every domain in a single
  // statement, the other finds them held and makes no call.
  const calls: string[][] = []
  // A function, so an assertion on one count does not narrow the next.
  const callCount = () => calls.length
  let called: () => void = () => {}
  const firstCalled = new Promise<void>(resolve => {
    called = resolve
  })
  let answer: () => void = () => {}
  const answered = new Promise<void>(resolve => {
    answer = resolve
  })
  // Ahrefs rates the first 40 and leaves the last 10 out of its answer.
  const fetchRatings: FetchDomainRatings = async requested => {
    calls.push(requested)
    called()
    await answered
    return new Map(requested.slice(0, 40).map((name, index) => [name, index % 2 ? index : null]))
  }
  const first = enrichDomainRatings(store, fetchRatings, NAMES, { signal, now: at(0) })
  await firstCalled
  const pending = await queryDomainListingsWithDatabase(
    parseDomainTableFilters({ q: 'limit-' }),
    database,
    new Date(T0 + 1)
  )
  check(
    pending.rows.length === NAMES.length && pending.rows.every(row => !row.domainRatingFetched),
    'dr_pending_not_fetched'
  )
  const second = await enrichDomainRatings(store, fetchRatings, NAMES, { signal, now: at(1) })
  answer()
  const firstResult = await first
  check(
    callCount() === 1 &&
      calls[0]?.length === NAMES.length &&
      firstResult.requested === NAMES.length &&
      firstResult.stored === NAMES.length &&
      second.requested === 0,
    'dr_concurrent_single_call'
  )

  // Omitted domains read as "no rating" and are not asked for again until
  // their retry time; then they are.
  const omitted = NAMES.slice(40)
  const beforeRetry = await enrichDomainRatings(store, fetchRatings, NAMES, {
    signal,
    now: at(DOMAIN_RATING_OMITTED_RETRY_MS - 1)
  })
  const waiting = await queryDomainListingsWithDatabase(
    parseDomainTableFilters({ q: 'limit-4' }),
    database,
    new Date(T0 + DOMAIN_RATING_OMITTED_RETRY_MS - 1)
  )
  const due = await queryDomainListingsWithDatabase(
    parseDomainTableFilters({ q: 'limit-4' }),
    database,
    new Date(T0 + DOMAIN_RATING_OMITTED_RETRY_MS)
  )
  const omittedRow = (rows: typeof waiting.rows) => rows.find(row => row.domainName === omitted[0])
  check(
    beforeRetry.requested === 0 &&
      callCount() === 1 &&
      omittedRow(waiting.rows)?.domainRatingFetched === true &&
      omittedRow(waiting.rows)?.domainRating === null &&
      omittedRow(due.rows)?.domainRatingFetched === false,
    'dr_omitted_waits'
  )

  // After a 429 the call is logged with its cool-down, and nothing is asked
  // until it ends. The omitted domains' claims lapse in the meantime.
  const retryAt = DOMAIN_RATING_OMITTED_RETRY_MS
  const limited = await enrichDomainRatings(
    store,
    async requested => {
      calls.push(requested)
      throw new AhrefsError('ahrefs_rate_limited', 90)
    },
    NAMES,
    { signal, now: at(retryAt) }
  ).catch(error => error)
  const coolingDown = await enrichDomainRatings(store, fetchRatings, NAMES, {
    signal,
    now: at(retryAt + 89_000)
  }).catch(error => error)
  check(
    limited instanceof AhrefsError &&
      coolingDown instanceof DomainRatingCoolDown &&
      coolingDown.retryAfterSeconds === 1 &&
      callCount() === 2 &&
      calls[1]?.join() === omitted.join(),
    'dr_cool_down'
  )

  // An aborted request gives its claims back at once.
  const controller = new AbortController()
  const claim = store.claim
  const abortingStore = {
    ...store,
    claim: async (...args: Parameters<typeof claim>) => {
      const claimed = await claim(...args)
      controller.abort()
      return claimed
    }
  }
  const afterCoolDown = retryAt + 90_000 + DOMAIN_RATING_CLAIM_MS
  const aborted = await enrichDomainRatings(abortingStore, fetchRatings, NAMES, {
    signal: controller.signal,
    now: at(afterCoolDown)
  }).catch(error => error)
  const [held] = await database
    .select({ value: count() })
    .from(domainMetrics)
    .where(eq(domainMetrics.status, 'pending'))
  check(aborted instanceof Error && callCount() === 2 && held?.value === 0, 'dr_abort_releases')

  const retried = await enrichDomainRatings(store, fetchRatings, NAMES, {
    signal,
    now: at(afterCoolDown + 1)
  })
  const ownRequests = gte(ahrefsRequests.requestedAt, new Date(T0))
  const [logged] = await database.select({ value: count() }).from(ahrefsRequests).where(ownRequests)
  check(
    retried.requested === omitted.length && callCount() === 3 && logged?.value === 3,
    'dr_every_call_logged'
  )

  // A stored rating is write-once; a later result for it is ignored.
  const rated = NAMES[1] ?? ''
  const rewritten = await store.record(
    { requestedAt: new Date(T0), domainCount: 1, outcome: 'ok', coolDownUntil: null },
    [{ domainName: rated, status: 'ok', value: 99, retryAfter: null }]
  )
  const [ratedRow] = await database
    .select({ value: domainMetrics.value })
    .from(domainMetrics)
    .where(eq(domainMetrics.domainName, rated))
  check(rewritten === 0 && ratedRow?.value === 1, 'dr_result_write_once')

  await database.delete(ahrefsRequests).where(ownRequests)
  await database.delete(domainMetrics).where(inArray(domainMetrics.domainName, NAMES))
  await database.delete(auctionListings).where(like(auctionListings.externalId, 'limit-%'))
  await database.delete(domains).where(inArray(domains.name, NAMES))
}
