import { and, count, eq, inArray, like, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import {
  auctionListings,
  domainMetrics,
  domainSeoMetrics,
  domains,
  ingestionRunSeenPages,
  ingestionRuns
} from '../db/schema'
import type { NormalizedSeoMetrics } from '../providers/types'
import { type TestDatabase, testDatabase } from '../test-database'
import {
  ACTIVE_LISTINGS,
  activeListingCount,
  godaddyListing,
  INITIAL_LISTINGS,
  listing,
  STARTED_AT,
  SUCCESSFUL_STARTED_AT,
  seedProofInventory
} from '../test-listings'
import { createD1IngestionStorage, vanishedListingsLimit } from './d1-storage'
import { SyncError } from './sync'

async function listingCount(database: TestDatabase) {
  const [row] = await database.select({ value: count() }).from(auctionListings)
  return row.value
}

async function listingRow(database: TestDatabase, externalId: string) {
  const [row] = await database
    .select()
    .from(auctionListings)
    .where(eq(auctionListings.externalId, externalId))
  return row
}

async function activeFor(database: TestDatabase, provider: string, prefix = '%') {
  const [row] = await database
    .select({ value: count() })
    .from(auctionListings)
    .where(
      and(
        eq(auctionListings.provider, provider),
        eq(auctionListings.status, 'active'),
        like(auctionListings.externalId, prefix)
      )
    )
  return row.value
}

function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof SyncError ? error.code : 'other')
  )
}

const finalization = (completedAt: Date, recordsFetched: number, recordsRejected = 0) => ({
  completedAt,
  pagesFetched: 1,
  recordsFetched,
  recordsUpserted: recordsFetched,
  recordsRejected
})

const failure = (completedAt: Date) => ({
  status: 'failed' as const,
  completedAt,
  pagesFetched: 0,
  recordsFetched: 0,
  recordsUpserted: 0,
  recordsInactivated: 0,
  recordsRejected: 0,
  errorCode: 'sync_failed',
  failedPage: null,
  rejectionReasons: null
})

describe('D1 ingestion storage', () => {
  it('upserts idempotently, updates mutable fields, and keeps the first-seen time', async () => {
    const database = testDatabase()
    const storage = createD1IngestionStorage(database, 'dynadot')
    const run = await storage.startRun(STARTED_AT)
    await storage.upsertListings(run, INITIAL_LISTINGS)
    expect(await listingCount(database)).toBe(3)

    await storage.upsertListings(run, [
      { ...INITIAL_LISTINGS[0], currentBidCents: 175 },
      INITIAL_LISTINGS[1],
      INITIAL_LISTINGS[2]
    ])
    expect(await listingCount(database)).toBe(3)
    const updated = await listingRow(database, 'initial-a')
    expect(updated?.currentBidCents).toBe(175)
    expect(updated?.firstSeenAt).toEqual(STARTED_AT)
  })

  it('rejects a stale continuation without changing the listing', async () => {
    const database = testDatabase()
    const storage = createD1IngestionStorage(database, 'dynadot')
    const firstRun = await storage.startRun(STARTED_AT)
    await storage.upsertListings(firstRun, [{ ...INITIAL_LISTINGS[0], currentBidCents: 175 }])
    await storage.startRun(new Date('2026-07-13T01:00:00.000Z'))

    expect(
      await rejection(
        storage.upsertListings(firstRun, [{ ...INITIAL_LISTINGS[0], currentBidCents: 999_999 }])
      )
    ).toBe('sync_stale_continuation')
    const afterStale = await listingRow(database, 'initial-a')
    expect(afterStale?.currentBidCents).toBe(175)
    expect(afterStale?.lastSeenAt).toEqual(STARTED_AT)
  })

  it('reconciles nothing for a failed run, and inactivates unseen listings for a successful one', async () => {
    const database = testDatabase()
    const { successfulReconciled, repeatedReconciled } = await seedProofInventory(database)
    // The failed run (seeded between the first and the successful run) left all three active;
    // the successful run then inactivated the two it did not see.
    expect(successfulReconciled).toBe(2)
    expect(repeatedReconciled).toBe(0)
    expect(await activeListingCount(database)).toBe(51)
    const [inactive] = await database
      .select({ value: count() })
      .from(auctionListings)
      .where(eq(auctionListings.status, 'inactive'))
    expect(inactive.value).toBe(2)
    const [succeeded] = await database
      .select({ value: count() })
      .from(ingestionRuns)
      .where(eq(ingestionRuns.status, 'succeeded'))
    expect(succeeded.value).toBe(2)
    // Unchanged listings are not rewritten: writes are billed per row.
    expect((await listingRow(database, 'active-05'))?.lastSeenAt).toEqual(SUCCESSFUL_STARTED_AT)
  })

  it('keeps every listing active when a run fails', async () => {
    const database = testDatabase()
    const storage = createD1IngestionStorage(database, 'dynadot')
    const firstRun = await storage.startRun(STARTED_AT)
    await storage.upsertListings(firstRun, INITIAL_LISTINGS)
    const failedRun = await storage.startRun(new Date('2026-07-13T01:00:00.000Z'))
    await storage.upsertListings(failedRun, [{ ...INITIAL_LISTINGS[0], currentBidCents: 250 }])
    await storage.completeRun(failedRun, {
      ...failure(new Date('2026-07-13T01:30:00.000Z')),
      pagesFetched: 1,
      recordsFetched: 1,
      recordsUpserted: 1
    })
    expect(await activeListingCount(database)).toBe(3)
    const [interrupted] = await database
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.id, firstRun.runId))
    expect(interrupted?.status).toBe('failed')
    expect(interrupted?.errorCode).toBe('sync_interrupted')
  })

  it('guards against a short run, records its diagnostics, and reconciles ended auctions', async () => {
    const database = testDatabase()
    const storage = createD1IngestionStorage(database, 'dynadot')
    const guardListings = Array.from({ length: 600 }, (_, index) => ({
      ...listing(`guard-${index}`, `guard-${index}.integration.test`, 100),
      endsAt: new Date('2026-09-01T00:00:00.000Z')
    }))

    const fullRun = await storage.startRun(new Date('2026-07-20T00:00:00.000Z'))
    await storage.upsertListings(fullRun, guardListings)
    await storage.finalizeSuccessfulRun(
      fullRun,
      finalization(new Date('2026-07-20T00:10:00.000Z'), guardListings.length)
    )
    expect(await activeFor(database, 'dynadot', 'guard-%')).toBe(600)

    // A short page mid-inventory: most still-running auctions go unseen.
    const shortRun = await storage.startRun(new Date('2026-07-21T00:00:00.000Z'))
    await storage.upsertListings(shortRun, guardListings.slice(0, 10))
    expect(
      await rejection(
        storage.finalizeSuccessfulRun(
          shortRun,
          finalization(new Date('2026-07-21T00:10:00.000Z'), 10)
        )
      )
    ).toBe('sync_reconciliation_guard')
    expect(await activeFor(database, 'dynadot', 'guard-%')).toBe(600)

    await storage.completeRun(shortRun, {
      ...failure(new Date('2026-07-21T00:11:00.000Z')),
      pagesFetched: 1,
      recordsFetched: 10,
      recordsUpserted: 10,
      recordsRejected: 3,
      errorCode: 'sync_reconciliation_guard',
      failedPage: 7
    })
    const [failedRun] = await database
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.id, shortRun.runId))
    expect(failedRun).toMatchObject({
      errorCode: 'sync_reconciliation_guard',
      failedPage: 7,
      recordsRejected: 3
    })

    // Once the auctions have ended, an empty run inactivates them as normal churn, and the
    // stored count matches the rows actually changed.
    const afterEndRun = await storage.startRun(new Date('2026-09-02T00:00:00.000Z'))
    const inactivated = await storage.finalizeSuccessfulRun(
      afterEndRun,
      finalization(new Date('2026-09-02T00:10:00.000Z'), 0, 2)
    )
    const [succeededRun] = await database
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.id, afterEndRun.runId))
    expect(inactivated).toBe(600)
    expect(succeededRun).toMatchObject({ recordsInactivated: 600, recordsRejected: 2 })
    expect(await activeFor(database, 'dynadot', 'guard-%')).toBe(0)

    // An inactive listing seen again comes back even though none of its fields changed, and
    // finishing a run, either way, clears its seen pages.
    const returnRun = await storage.startRun(new Date('2026-09-03T00:00:00.000Z'))
    await storage.upsertListings(returnRun, guardListings.slice(0, 1))
    expect(await activeFor(database, 'dynadot', 'guard-%')).toBe(1)
    await storage.finalizeSuccessfulRun(
      returnRun,
      finalization(new Date('2026-09-03T00:10:00.000Z'), 1)
    )
    const [seenPages] = await database
      .select({ value: count() })
      .from(ingestionRunSeenPages)
      .where(inArray(ingestionRunSeenPages.runId, [shortRun.runId, returnRun.runId]))
    expect(seenPages.value).toBe(0)
  })

  it('keeps one provider from reading, reconciling, or interrupting another', async () => {
    const database = testDatabase()
    await seedProofInventory(database)
    const dynadot = createD1IngestionStorage(database, 'dynadot')
    const dropcatch = createD1IngestionStorage(database, 'dropcatch')
    const dynadotActiveBefore = await activeFor(database, 'dynadot')

    const dynadotRun = await dynadot.startRun(new Date('2026-07-15T00:00:00.000Z'))
    const dropcatchRun = await dropcatch.startRun(new Date('2026-07-15T00:01:00.000Z'))
    // Starting a DropCatch run must not interrupt the running Dynadot run.
    expect((await dynadot.loadRunningRun(dynadotRun.runId)).runId).toBe(dynadotRun.runId)

    expect(
      await rejection(
        dropcatch.upsertListings(dropcatchRun, [
          listing('isolation-wrong', 'isolation-wrong.integration.test', 100)
        ])
      )
    ).toBe('sync_invalid_request')

    await dropcatch.upsertListings(
      dropcatchRun,
      ['a', 'b'].map(suffix => ({
        ...listing(`isolation-${suffix}`, `isolation-${suffix}.integration.test`, 100),
        provider: 'dropcatch' as const
      }))
    )
    // DropCatch saw none of Dynadot's listings, yet finalizing must neither inactivate them nor
    // count them toward its own guard.
    const inactivated = await dropcatch.finalizeSuccessfulRun(
      dropcatchRun,
      finalization(new Date('2026-07-15T00:02:00.000Z'), 2)
    )
    expect(inactivated).toBe(0)
    expect(await activeFor(database, 'dynadot')).toBe(dynadotActiveBefore)
    expect(await activeFor(database, 'dropcatch')).toBe(2)
  })

  it('stores GoDaddy feed metrics, latest wins, and guards them by the running run', async () => {
    const database = testDatabase()
    await seedProofInventory(database)
    const godaddy = createD1IngestionStorage(database, 'godaddy')
    const metrics = (majesticTf: number): NormalizedSeoMetrics => ({
      majesticTf,
      majesticCf: 20,
      majesticBacklinks: 900,
      majesticRefDomains: 40,
      semrushAs: 15,
      semrushRefDomains: null,
      semrushBacklinks: 120
    })
    const metricsFor = async (domainName: string) => {
      const [row] = await database
        .select()
        .from(domainSeoMetrics)
        .where(eq(domainSeoMetrics.domainName, domainName))
      return row
    }

    const firstStartedAt = new Date('2026-07-13T03:40:00.000Z')
    const first = await godaddy.startRun(firstStartedAt)
    await godaddy.upsertListings(first, [
      godaddyListing('900001', 'seo-feed.integration.test', metrics(10)),
      // The same domain as a Dynadot listing: metrics are domain-level.
      godaddyListing('900002', 'garden.com', metrics(30)),
      { ...godaddyListing('900003', 'seo-buy-now.integration.test'), auctionType: 'BUY_NOW' }
    ])
    expect(await metricsFor('seo-feed.integration.test')).toMatchObject({
      source: 'godaddy',
      majesticTf: 10,
      semrushRefDomains: null,
      updatedAt: firstStartedAt
    })
    expect(await metricsFor('seo-buy-now.integration.test')).toBeUndefined()
    expect((await listingRow(database, '900001'))?.bidderCount).toBeNull()

    const secondStartedAt = new Date('2026-07-13T03:50:00.000Z')
    const second = await godaddy.startRun(secondStartedAt)
    await godaddy.upsertListings(second, [
      godaddyListing('900001', 'seo-feed.integration.test', metrics(12)),
      // Without metrics, the stored ones stay as they are.
      godaddyListing('900002', 'garden.com')
    ])
    expect(await metricsFor('seo-feed.integration.test')).toMatchObject({
      majesticTf: 12,
      updatedAt: secondStartedAt
    })
    expect(await metricsFor('garden.com')).toMatchObject({
      majesticTf: 30,
      updatedAt: firstStartedAt
    })

    // The first run was interrupted by the second, so its writes are stale.
    expect(
      await rejection(
        godaddy.upsertListings(first, [
          godaddyListing('900001', 'seo-feed.integration.test', metrics(99))
        ])
      )
    ).toBe('sync_stale_continuation')
    expect((await metricsFor('seo-feed.integration.test'))?.majesticTf).toBe(12)
  })

  it('loads a succeeded run, which stays succeeded when the cleanup after it fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const database = testDatabase()
    const storage = createD1IngestionStorage(database, 'dynadot')
    const run = await storage.startRun(STARTED_AT)
    await storage.upsertListings(run, INITIAL_LISTINGS)
    expect(await storage.loadSucceededRun(run.runId)).toBeNull()

    // Without its table, the facet rebuild after the finalization batch fails.
    await database.run(sql`DROP TABLE listing_facets`)
    await storage.finalizeSuccessfulRun(run, finalization(new Date('2026-07-13T00:20:00.000Z'), 3))
    expect(warn).toHaveBeenCalledWith('sync_cleanup_failed', {
      message: expect.stringContaining('listing_facets')
    })
    expect(await storage.loadSucceededRun(run.runId)).toEqual({
      pagesFetched: 1,
      recordsFetched: 3,
      recordsUpserted: 3,
      recordsInactivated: 0,
      recordsRejected: 0
    })
    expect(
      await createD1IngestionStorage(database, 'godaddy').loadSucceededRun(run.runId)
    ).toBeNull()
    warn.mockRestore()
  })

  it('treats every write against a run that is no longer running as stale', async () => {
    const database = testDatabase()
    const storage = createD1IngestionStorage(database, 'dynadot')
    const run = await storage.startRun(STARTED_AT)
    // An empty page writes nothing and needs no running run.
    await storage.upsertListings(run, [])
    await storage.updateRunProgress({ ...run, nextPage: 2, pagesFetched: 1, recordsFetched: 3 })
    expect((await storage.loadRunningRun(run.runId)).nextPage).toBe(2)

    await storage.completeRun(run, failure(new Date('2026-07-13T00:10:00.000Z')))
    expect(await rejection(storage.loadRunningRun(run.runId))).toBe('sync_stale_continuation')
    expect(await rejection(storage.updateRunProgress(run))).toBe('sync_stale_continuation')
    expect(
      await rejection(storage.completeRun(run, failure(new Date('2026-07-13T00:20:00.000Z'))))
    ).toBe('sync_stale_continuation')
    expect(
      await rejection(
        storage.finalizeSuccessfulRun(run, finalization(new Date('2026-07-13T00:20:00.000Z'), 0))
      )
    ).toBe('sync_stale_continuation')
  })

  it('allows a tenth of the fetched records, and at least 500, to vanish', () => {
    expect(vanishedListingsLimit(0)).toBe(500)
    expect(vanishedListingsLimit(ACTIVE_LISTINGS.length)).toBe(500)
    expect(vanishedListingsLimit(12_345)).toBe(1_234)
  })

  // Inactive listings a week past their end go, with the feed metrics and domains nothing else
  // uses; a domain another listing or a stored Ahrefs rating still needs stays.
  it('deletes ended listings with the metrics and domains nothing else uses', async () => {
    const database = testDatabase()
    const now = new Date('2026-07-30T00:00:00.000Z')
    const before = new Date(now.getTime() - 7 * 86_400_000)
    const longEnded = new Date(now.getTime() - 10 * 86_400_000)
    const recentlyEnded = new Date(now.getTime() - 3 * 86_400_000)
    const row = (
      externalId: string,
      domainName: string,
      endsAt: Date,
      status: 'active' | 'inactive' = 'inactive',
      provider = 'dynadot'
    ) => ({
      ...listing(externalId, domainName, 100),
      provider,
      endsAt,
      status,
      firstSeenAt: STARTED_AT,
      lastSeenAt: STARTED_AT
    })
    const names = ['alone', 'shared', 'rated', 'recent', 'running', 'other']
    await database
      .insert(domains)
      .values(names.map(name => ({ name: `${name}.test`, firstSeenAt: STARTED_AT })))
    // One at a time: seven rows would pass D1's 100 bound parameters.
    for (const value of [
      row('alone', 'alone.test', longEnded),
      row('shared', 'shared.test', longEnded),
      row('shared-elsewhere', 'shared.test', longEnded, 'active', 'godaddy'),
      row('rated', 'rated.test', longEnded),
      row('recent', 'recent.test', recentlyEnded),
      // Still published, or another provider's: never this provider's to delete.
      row('running', 'running.test', longEnded, 'active'),
      row('other', 'other.test', longEnded, 'inactive', 'godaddy')
    ]) {
      await database.insert(auctionListings).values(value)
    }
    await database.insert(domainSeoMetrics).values(
      ['alone', 'shared', 'rated'].map(name => ({
        domainName: `${name}.test`,
        source: 'godaddy',
        majesticTf: 10,
        updatedAt: STARTED_AT
      }))
    )
    await database.insert(domainMetrics).values({
      domainName: 'rated.test',
      metric: 'ahrefs_dr',
      status: 'ok',
      value: 20,
      fetchedAt: STARTED_AT
    })
    const storage = createD1IngestionStorage(database, 'dynadot')

    expect(await storage.deleteEndedListings(before, 1)).toEqual({
      listings: 1,
      seoMetrics: 1,
      domains: 1
    })
    expect(await storage.deleteEndedListings(before, 10)).toEqual({
      listings: 2,
      seoMetrics: 1,
      domains: 0
    })
    expect(await storage.deleteEndedListings(before, 10)).toEqual({
      listings: 0,
      seoMetrics: 0,
      domains: 0
    })

    const left = await database
      .select({ externalId: auctionListings.externalId })
      .from(auctionListings)
      .orderBy(auctionListings.externalId)
    expect(left.map(({ externalId }) => externalId)).toEqual([
      'other',
      'recent',
      'running',
      'shared-elsewhere'
    ])
    const metrics = await database
      .select({ name: domainSeoMetrics.domainName })
      .from(domainSeoMetrics)
    expect(metrics.map(({ name }) => name)).toEqual(['shared.test'])
    const kept = await database.select({ name: domains.name }).from(domains).orderBy(domains.name)
    expect(kept.map(({ name }) => name)).toEqual([
      'other.test',
      'rated.test',
      'recent.test',
      'running.test',
      'shared.test'
    ])
  })
})
