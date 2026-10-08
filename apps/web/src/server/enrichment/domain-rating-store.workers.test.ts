import { count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { ahrefsRequests, auctionListings, domainMetrics, domains } from '../db/schema'
import { createD1IngestionStorage } from '../ingestion/d1-storage'
import { type TestDatabase, testDatabase, testEnv } from '../test-database'
import { listing, queryAt } from '../test-listings'
import { AhrefsError } from './ahrefs'
import {
  DOMAIN_RATING_CLAIM_MS,
  DOMAIN_RATING_OMITTED_RETRY_MS,
  DOMAIN_RATING_REQUEST_LIMIT,
  DomainRatingCoolDown,
  enrichDomainRatings,
  type FetchDomainRatings
} from './domain-rating'
import { createD1DomainRatingStore, DOMAINS_TO_RATE_SQL } from './domain-rating-store'

describe('on-demand Domain Rating enrichment on D1', () => {
  // Stores ratings only for domains with an active listing, never overwrites a stored rating,
  // and surfaces it in the table read.
  it('rates active listings once and shows the ratings in the table', async () => {
    const database = testDatabase()
    const storage = createD1IngestionStorage(database, 'dynadot')
    const run = await storage.startRun(new Date('2026-07-16T00:00:00.000Z'))
    await storage.upsertListings(
      run,
      ['dr-rated', 'dr-unrated', 'dr-inactive'].map(name =>
        listing(name, `${name}.integration.test`, 100)
      )
    )
    await database
      .update(auctionListings)
      .set({ status: 'inactive' })
      .where(eq(auctionListings.externalId, 'dr-inactive'))

    const calls: string[][] = []
    const fetchRatings = async (requested: string[]) => {
      calls.push(requested)
      return new Map<string, number | null>([
        ['dr-rated.integration.test', 55.5],
        ['dr-unrated.integration.test', null],
        ['dr-inactive.integration.test', 99]
      ])
    }
    const requested = [
      'dr-rated.integration.test',
      'dr-unrated.integration.test',
      'dr-inactive.integration.test',
      'dr-unknown.integration.test',
      'dr-rated.integration.test'
    ]
    const store = createD1DomainRatingStore(database)
    const options = {
      signal: new AbortController().signal,
      now: () => new Date('2026-07-16T00:01:00.000Z')
    }
    const first = await enrichDomainRatings(store, fetchRatings, requested, options)
    expect(first.stored).toBe(2)
    expect(calls).toHaveLength(1)
    expect([...(calls[0] ?? [])].sort()).toEqual([
      'dr-rated.integration.test',
      'dr-unrated.integration.test'
    ])

    const second = await enrichDomainRatings(store, fetchRatings, requested, options)
    expect(second).toMatchObject({ stored: 0, requested: 0 })
    expect(calls).toHaveLength(1)

    const table = await queryAt(database, new Date('2026-07-16T00:02:00.000Z'))({ q: 'dr-' })
    const byName = new Map(table.rows.map(row => [row.domainName, row]))
    expect(byName.get('dr-rated.integration.test')).toMatchObject({
      domainRating: 55.5,
      domainRatingFetched: true
    })
    expect(byName.get('dr-unrated.integration.test')).toMatchObject({
      domainRating: null,
      domainRatingFetched: true
    })
  })

  // The store's claims, omissions, cool-down, and request log, with a full page of domains and
  // an invented Ahrefs.
  describe('with a full page of domains', () => {
    const T0 = new Date('2026-07-17T00:00:00.000Z').getTime()
    const NAMES = Array.from(
      { length: DOMAIN_RATING_REQUEST_LIMIT },
      (_, index) => `limit-${String(index).padStart(2, '0')}.integration.test`
    )
    const OMITTED = NAMES.slice(40)
    const at = (offsetMs: number) => () => new Date(T0 + offsetMs)
    const signal = new AbortController().signal
    let database: TestDatabase
    let store: ReturnType<typeof createD1DomainRatingStore>
    let calls: string[][]
    // Ahrefs rates the first 40 and leaves the last 10 out of its answer.
    const fetchRatings: FetchDomainRatings = async requested => {
      calls.push(requested)
      return new Map(requested.slice(0, 40).map((name, index) => [name, index % 2 ? index : null]))
    }

    beforeEach(async () => {
      database = testDatabase()
      store = createD1DomainRatingStore(database)
      calls = []
      const seenAt = new Date(T0)
      await database.insert(domains).values(NAMES.map(name => ({ name, firstSeenAt: seenAt })))
      // About a dozen bound values per listing; five rows stay well below D1's 100 bound
      // parameters.
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
            endsAt: new Date('2026-08-01T00:00:00.000Z'),
            status: 'active' as const,
            firstSeenAt: seenAt,
            lastSeenAt: seenAt
          }))
        )
      }
    })

    it('lets one of two concurrent requests claim the page and call Ahrefs once', async () => {
      let called: () => void = () => {}
      const firstCalled = new Promise<void>(resolve => {
        called = resolve
      })
      let answer: () => void = () => {}
      const answered = new Promise<void>(resolve => {
        answer = resolve
      })
      const slowRatings: FetchDomainRatings = async requested => {
        called()
        await answered
        return fetchRatings(requested)
      }
      const first = enrichDomainRatings(store, slowRatings, NAMES, { signal, now: at(0) })
      await firstCalled
      const pending = await queryAt(database, new Date(T0 + 1))({ q: 'limit-' })
      expect(pending.rows).toHaveLength(NAMES.length)
      expect(pending.rows.every(row => !row.domainRatingFetched)).toBe(true)

      const second = await enrichDomainRatings(store, slowRatings, NAMES, { signal, now: at(1) })
      answer()
      const firstResult = await first
      expect(calls).toHaveLength(1)
      expect(calls[0]).toHaveLength(NAMES.length)
      expect(firstResult).toMatchObject({ requested: NAMES.length, stored: NAMES.length })
      expect(second.requested).toBe(0)
    })

    it('waits out omissions and 429 cool-downs, releases aborted claims, and logs every call', async () => {
      await enrichDomainRatings(store, fetchRatings, NAMES, { signal, now: at(0) })

      // Omitted domains read as "no rating" and are not asked for again until their retry time.
      const beforeRetry = await enrichDomainRatings(store, fetchRatings, NAMES, {
        signal,
        now: at(DOMAIN_RATING_OMITTED_RETRY_MS - 1)
      })
      const omittedRow = async (offsetMs: number) =>
        (await queryAt(database, new Date(T0 + offsetMs))({ q: 'limit-4' })).rows.find(
          row => row.domainName === OMITTED[0]
        )
      expect(beforeRetry.requested).toBe(0)
      expect(calls).toHaveLength(1)
      expect(await omittedRow(DOMAIN_RATING_OMITTED_RETRY_MS - 1)).toMatchObject({
        domainRatingFetched: true,
        domainRating: null
      })
      expect((await omittedRow(DOMAIN_RATING_OMITTED_RETRY_MS))?.domainRatingFetched).toBe(false)

      // After a 429 the call is logged with its cool-down, and nothing is asked until it ends.
      const retryAt = DOMAIN_RATING_OMITTED_RETRY_MS
      const limited = await enrichDomainRatings(
        store,
        async requested => {
          calls.push(requested)
          throw new AhrefsError('ahrefs_rate_limited', 90)
        },
        NAMES,
        { signal, now: at(retryAt) }
      ).catch((error: unknown) => error)
      const coolingDown = await enrichDomainRatings(store, fetchRatings, NAMES, {
        signal,
        now: at(retryAt + 89_000)
      }).catch((error: unknown) => error)
      expect(limited).toBeInstanceOf(AhrefsError)
      expect(coolingDown).toBeInstanceOf(DomainRatingCoolDown)
      expect((coolingDown as DomainRatingCoolDown).retryAfterSeconds).toBe(1)
      expect(calls).toHaveLength(2)
      expect(calls[1]).toEqual(OMITTED)

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
      }).catch((error: unknown) => error)
      const [held] = await database
        .select({ value: count() })
        .from(domainMetrics)
        .where(eq(domainMetrics.status, 'pending'))
      expect(aborted).toBeInstanceOf(Error)
      expect(calls).toHaveLength(2)
      expect(held.value).toBe(0)

      const retried = await enrichDomainRatings(store, fetchRatings, NAMES, {
        signal,
        now: at(afterCoolDown + 1)
      })
      const [logged] = await database.select({ value: count() }).from(ahrefsRequests)
      expect(retried.requested).toBe(OMITTED.length)
      expect(calls).toHaveLength(3)
      expect(logged.value).toBe(3)
    })

    it('never rewrites a stored rating', async () => {
      await enrichDomainRatings(store, fetchRatings, NAMES, { signal, now: at(0) })
      const rated = NAMES[1] ?? ''
      const rewritten = await store.record(
        { requestedAt: new Date(T0), domainCount: 1, outcome: 'ok', coolDownUntil: null },
        [{ domainName: rated, status: 'ok', value: 99, retryAfter: null }]
      )
      const [ratedRow] = await database
        .select({ value: domainMetrics.value })
        .from(domainMetrics)
        .where(eq(domainMetrics.domainName, rated))
      expect(rewritten).toBe(0)
      expect(ratedRow?.value).toBe(1)
    })
  })

  it('has no cool-down until a call sets one', async () => {
    const store = createD1DomainRatingStore(testDatabase())
    expect(await store.coolDownUntil(new Date())).toBeNull()
  })

  // The daily backfill's selection: open listings only, each domain once, in name order after a
  // cursor, skipping settled ratings and omissions or claims still waiting.
  it('lists the domains the backfill should rate next', async () => {
    const database = testDatabase()
    const storage = createD1IngestionStorage(database, 'dynadot')
    const run = await storage.startRun(new Date('2026-07-16T00:00:00.000Z'))
    const names = ['a-ok', 'b-missing', 'c-wait', 'd-retry', 'e-pending', 'f-ended', 'g-gone']
    await storage.upsertListings(run, [
      ...names.map(name => listing(name, `${name}.test`, 100)),
      // A second listing of the same domain is listed once.
      listing('b-missing-2', 'b-missing.test', 200),
      { ...listing('f-ended', 'f-ended.test', 100), endsAt: new Date('2026-07-14T00:00:00.000Z') }
    ])
    await database
      .update(auctionListings)
      .set({ status: 'inactive' })
      .where(eq(auctionListings.externalId, 'g-gone'))
    const now = new Date('2026-07-15T00:00:00.000Z')
    const later = new Date(now.getTime() + 60_000)
    const earlier = new Date(now.getTime() - 60_000)
    await database.insert(domainMetrics).values([
      { domainName: 'a-ok.test', metric: 'ahrefs_dr', status: 'ok', value: 3, fetchedAt: now },
      {
        domainName: 'c-wait.test',
        metric: 'ahrefs_dr',
        status: 'omitted',
        value: null,
        fetchedAt: now,
        retryAfter: later
      },
      {
        domainName: 'd-retry.test',
        metric: 'ahrefs_dr',
        status: 'omitted',
        value: null,
        fetchedAt: earlier,
        retryAfter: earlier
      },
      {
        domainName: 'e-pending.test',
        metric: 'ahrefs_dr',
        status: 'pending',
        value: null,
        fetchedAt: now,
        retryAfter: later
      }
    ])
    const store = createD1DomainRatingStore(database)

    expect(await store.domainsToRate('', now, 10)).toEqual(['b-missing.test', 'd-retry.test'])
    expect(await store.domainsToRate('b-missing.test', now, 10)).toEqual(['d-retry.test'])
    expect(await store.domainsToRate('', now, 1)).toEqual(['b-missing.test'])

    // It walks the domain-name index from the cursor, never sorting the open listings.
    const { results } = await testEnv.DB.prepare(`explain query plan ${DOMAINS_TO_RATE_SQL}`)
      .bind(now.getTime(), '', 1000)
      .all<{ detail: string }>()
    const plan = results.map(({ detail }) => detail).join('\n')
    expect(plan).toContain('USING INDEX auction_listings_domain_name_idx (domain_name>?)')
    expect(plan).not.toContain('TEMP B-TREE')
  })
})
