import { describe, expect, it } from 'vitest'

import { listingFacets } from '../db/schema'
import { createD1IngestionStorage } from '../ingestion/d1-storage'
import { testDatabase } from '../test-database'
import { godaddyListing, QUERY_NOW, seedProofInventory } from '../test-listings'
import { queryFailedSyncCountWithDatabase, querySyncStatusWithDatabase } from './sync-status-query'

describe('sync status on D1', () => {
  it('reads the runs the syncs recorded, newest first, with each provider’s latest', async () => {
    const database = testDatabase()
    await seedProofInventory(database)
    // GoDaddy's only run failed, after its listing was written.
    const godaddy = createD1IngestionStorage(database, 'godaddy')
    const run = await godaddy.startRun(new Date('2026-07-13T03:40:00.000Z'))
    await godaddy.upsertListings(run, [godaddyListing('900001', 'seo-feed.integration.test')])
    await godaddy.completeRun(run, {
      status: 'failed',
      completedAt: new Date('2026-07-13T03:45:00.000Z'),
      pagesFetched: 0,
      recordsFetched: 0,
      recordsUpserted: 0,
      recordsInactivated: 0,
      recordsRejected: 0,
      errorCode: 'sync_failed',
      failedPage: null,
      rejectionReasons: null
    })
    // A source the facets still offer, with no run and no open auction.
    await database.insert(listingFacets).values({
      facet: 'source',
      value: 'namecheap',
      latestEndsAt: new Date('2026-07-13T05:00:00Z')
    })

    const status = await querySyncStatusWithDatabase(database, QUERY_NOW)
    expect(status.recentRuns.length).toBeGreaterThan(0)
    expect(status.recentRuns.map(item => item.id)).toEqual(
      [...status.recentRuns.map(item => item.id)].sort((a, b) => b - a)
    )
    for (const summary of status.providers) {
      const runs = status.recentRuns.filter(item => item.provider === summary.provider)
      if (runs.length > 0)
        expect(summary.latestRun?.id).toBe(Math.max(...runs.map(item => item.id)))
      if (summary.latestSuccess) expect(summary.latestSuccess.status).toBe('succeeded')
    }
    expect(
      status.providers.map(({ provider, activeListings, latestRun, latestSuccess }) => ({
        provider,
        activeListings,
        latestRun: latestRun?.status ?? null,
        latestSuccess: latestSuccess?.status ?? null
      }))
    ).toEqual([
      {
        provider: 'dynadot',
        activeListings: 51,
        latestRun: 'succeeded',
        latestSuccess: 'succeeded'
      },
      { provider: 'godaddy', activeListings: 1, latestRun: 'failed', latestSuccess: null },
      { provider: 'namecheap', activeListings: 0, latestRun: null, latestSuccess: null }
    ])
    expect(await queryFailedSyncCountWithDatabase(database)).toBe(
      status.providers.filter(item => item.latestRun?.status === 'failed').length
    )
    expect(await queryFailedSyncCountWithDatabase(database)).toBe(1)
  })

  it('counts only auctions still open now by default', async () => {
    const database = testDatabase()
    await seedProofInventory(database)
    const [dynadot] = (await querySyncStatusWithDatabase(database)).providers
    expect(dynadot).toMatchObject({ provider: 'dynadot', activeListings: 0 })
  })

  it('reads nothing from an empty D1', async () => {
    const database = testDatabase()
    expect(await querySyncStatusWithDatabase(database)).toEqual({ providers: [], recentRuns: [] })
    expect(await queryFailedSyncCountWithDatabase(database)).toBe(0)
  })
})
