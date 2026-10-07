// Invented listings and the shared D1 inventory for `*.workers.test.ts`.
import { count, eq } from 'drizzle-orm'

import { type DomainTableSearchParams, parseDomainTableFilters } from '../domain/domain-table'
import { auctionListings } from './db/schema'
import { createD1IngestionStorage } from './ingestion/d1-storage'
import type { NormalizedListing, NormalizedSeoMetrics } from './providers/types'
import { queryDomainListingsWithDatabase } from './queries/domain-listings-query'
import type { TestDatabase } from './test-database'

export const STARTED_AT = new Date('2026-07-13T00:00:00.000Z')
export const QUERY_NOW = new Date('2026-07-13T04:00:00.000Z')

export function listing(
  externalId: string,
  domainName: string,
  currentBidCents: number
): NormalizedListing {
  return {
    provider: 'dynadot',
    externalId,
    domainName,
    auctionUrl: `https://example.invalid/auction/${externalId}`,
    auctionType: 'expired',
    currency: 'USD',
    currentBidCents,
    bidCount: currentBidCents % 7,
    bidderCount: currentBidCents % 5,
    startsAt: null,
    endsAt: new Date('2026-07-20T00:00:00.000Z'),
    ageYears: 5,
    inboundLinks: 10,
    visitors: 20,
    appraisalCents: 10_000,
    renewalPriceCents: 1_200
  }
}

export function godaddyListing(
  externalId: string,
  domainName: string,
  seoMetrics?: NormalizedSeoMetrics
): NormalizedListing {
  return {
    ...listing(externalId, domainName, 1_000),
    provider: 'godaddy',
    auctionUrl: `https://example.invalid/godaddy/${externalId}`,
    auctionType: 'AUCTION',
    bidderCount: null,
    endsAt: new Date('2026-07-13T06:00:00.000Z'),
    inboundLinks: null,
    renewalPriceCents: null,
    ...(seoMetrics ? { seoMetrics } : {})
  }
}

export const INITIAL_LISTINGS = [
  listing('initial-a', 'initial-a.integration.test', 100),
  listing('initial-b', 'initial-b.integration.test', 200),
  listing('initial-c', 'initial-c.integration.test', 300)
]

const shapeFixture = {
  ...listing('shape-clean', 'garden.com', 2_500),
  auctionType: 'EXPIRED',
  bidCount: 10,
  bidderCount: 5,
  startsAt: new Date('2026-07-12T04:00:00.000Z'),
  endsAt: new Date('2026-07-13T05:00:00.000Z'),
  ageYears: 12,
  inboundLinks: 100,
  visitors: 50,
  appraisalCents: 50_000,
  renewalPriceCents: 1_200
}
const nullFixture = {
  ...listing('shape-null', 'past.org', 3_000),
  auctionType: 'EXPIRED',
  bidCount: 2,
  bidderCount: 1,
  endsAt: new Date('2026-07-13T04:30:00.000Z'),
  ageYears: null,
  inboundLinks: null,
  visitors: null,
  appraisalCents: null,
  renewalPriceCents: null
}
const digitFixture = {
  ...listing('shape-digit', 'garden2.net', 4_000),
  auctionType: 'EXPIRED',
  bidCount: 4,
  bidderCount: 2,
  endsAt: new Date('2026-07-14T04:00:00.000Z')
}
const hyphenFixture = {
  ...listing('shape-hyphen', 'garden-only-hyphen.net', 4_500),
  auctionType: 'EXPIRED',
  bidCount: 4,
  bidderCount: 2,
  endsAt: new Date('2026-07-15T04:00:00.000Z')
}

// The 51 listings of the successful run: initial-a at a new price, four
// listings with distinctive shapes, and 46 plain ones (one of them named
// filter-target), so a page of 50 leaves one for page 2.
export const ACTIVE_LISTINGS: NormalizedListing[] = [
  { ...INITIAL_LISTINGS[0], currentBidCents: 5_100 },
  ...Array.from({ length: 50 }, (_, index) =>
    index === 0
      ? shapeFixture
      : index === 1
        ? nullFixture
        : index === 2
          ? digitFixture
          : index === 3
            ? hyphenFixture
            : listing(
                `active-${index.toString().padStart(2, '0')}`,
                index === 17
                  ? 'filter-target.integration.test'
                  : `active-${index.toString().padStart(2, '0')}.integration.test`,
                100 + index
              )
  )
]

export const SUCCESSFUL_STARTED_AT = new Date('2026-07-13T02:00:00.000Z')
export const REPEATED_COMPLETED_AT = new Date('2026-07-13T03:30:00.000Z')

export async function activeListingCount(database: TestDatabase) {
  const [row] = await database
    .select({ value: count() })
    .from(auctionListings)
    .where(eq(auctionListings.status, 'active'))
  return row.value
}

// The Dynadot inventory the read-model and storage tests start from: a first run of three
// listings, an interrupted run that failed, a successful run that reconciled two of them away,
// and an identical repeat.
export async function seedProofInventory(database: TestDatabase) {
  const storage = createD1IngestionStorage(database, 'dynadot')
  const firstRun = await storage.startRun(STARTED_AT)
  await storage.upsertListings(firstRun, INITIAL_LISTINGS)

  const failedRun = await storage.startRun(new Date('2026-07-13T01:00:00.000Z'))
  await storage.upsertListings(failedRun, [{ ...INITIAL_LISTINGS[0], currentBidCents: 250 }])
  await storage.completeRun(failedRun, {
    status: 'failed',
    completedAt: new Date('2026-07-13T01:30:00.000Z'),
    pagesFetched: 1,
    recordsFetched: 1,
    recordsUpserted: 1,
    recordsInactivated: 0,
    recordsRejected: 0,
    errorCode: 'sync_failed',
    failedPage: null,
    rejectionReasons: null
  })

  const successfulRun = await storage.startRun(SUCCESSFUL_STARTED_AT)
  await storage.upsertListings(successfulRun, ACTIVE_LISTINGS)
  const successfulReconciled = await storage.finalizeSuccessfulRun(successfulRun, {
    completedAt: new Date('2026-07-13T02:30:00.000Z'),
    pagesFetched: 1,
    recordsFetched: ACTIVE_LISTINGS.length,
    recordsUpserted: ACTIVE_LISTINGS.length,
    recordsRejected: 0
  })

  const repeatedRun = await storage.startRun(new Date('2026-07-13T03:00:00.000Z'))
  await storage.upsertListings(repeatedRun, ACTIVE_LISTINGS)
  const repeatedReconciled = await storage.finalizeSuccessfulRun(repeatedRun, {
    completedAt: REPEATED_COMPLETED_AT,
    pagesFetched: 1,
    recordsFetched: ACTIVE_LISTINGS.length,
    recordsUpserted: ACTIVE_LISTINGS.length,
    recordsRejected: 0
  })
  return { storage, successfulReconciled, repeatedReconciled }
}

export function queryAt(database: TestDatabase, now = QUERY_NOW) {
  return (searchParams: DomainTableSearchParams) =>
    queryDomainListingsWithDatabase(parseDomainTableFilters(searchParams), database, now)
}
