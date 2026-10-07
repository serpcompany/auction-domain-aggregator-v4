import { and, count, desc, eq, gt, inArray, max } from 'drizzle-orm'

import { auctionListings, ingestionRuns, listingFacets } from '@/server/db/schema'
import type { AppDatabase } from '@/server/db/types'

export type IngestionRun = typeof ingestionRuns.$inferSelect

export interface ProviderSyncSummary {
  provider: string
  activeListings: number
  latestRun: IngestionRun | null
  latestSuccess: IngestionRun | null
}

export interface SyncStatus {
  providers: ProviderSyncSummary[]
  recentRuns: IngestionRun[]
}

const RECENT_RUNS = 20

// Read-only: D1 only, never the provider registry or its networking. Reads
// stay sequential, as on the table page.
export async function querySyncStatusWithDatabase(
  database: AppDatabase,
  now = new Date()
): Promise<SyncStatus> {
  const recentRuns = await database
    .select()
    .from(ingestionRuns)
    .orderBy(desc(ingestionRuns.id))
    .limit(RECENT_RUNS)
  const latestRuns = await database
    .select()
    .from(ingestionRuns)
    .where(
      inArray(
        ingestionRuns.id,
        database
          .select({ id: max(ingestionRuns.id) })
          .from(ingestionRuns)
          .groupBy(ingestionRuns.provider)
      )
    )
  const latestSuccesses = await database
    .select()
    .from(ingestionRuns)
    .where(
      inArray(
        ingestionRuns.id,
        database
          .select({ id: max(ingestionRuns.id) })
          .from(ingestionRuns)
          .where(eq(ingestionRuns.status, 'succeeded'))
          .groupBy(ingestionRuns.provider)
      )
    )
  const activeCounts = await database
    .select({ provider: auctionListings.provider, value: count() })
    .from(auctionListings)
    .where(and(eq(auctionListings.status, 'active'), gt(auctionListings.endsAt, now)))
    .groupBy(auctionListings.provider)
  const facetSources = await database
    .select({ value: listingFacets.value })
    .from(listingFacets)
    .where(eq(listingFacets.facet, 'source'))

  const providers = [
    ...new Set([
      ...latestRuns.map(run => run.provider),
      ...facetSources.map(({ value }) => value),
      ...activeCounts.map(({ provider }) => provider)
    ])
  ].sort()

  return {
    recentRuns,
    providers: providers.map(provider => ({
      provider,
      activeListings: activeCounts.find(row => row.provider === provider)?.value ?? 0,
      latestRun: latestRuns.find(run => run.provider === provider) ?? null,
      latestSuccess: latestSuccesses.find(run => run.provider === provider) ?? null
    }))
  }
}

// How many providers' latest run failed: the sidebar's Sync status badge.
export async function queryFailedSyncCountWithDatabase(database: AppDatabase) {
  const latestRuns = await database
    .select({ status: ingestionRuns.status })
    .from(ingestionRuns)
    .where(
      inArray(
        ingestionRuns.id,
        database
          .select({ id: max(ingestionRuns.id) })
          .from(ingestionRuns)
          .groupBy(ingestionRuns.provider)
      )
    )
  return latestRuns.filter(run => run.status === 'failed').length
}
