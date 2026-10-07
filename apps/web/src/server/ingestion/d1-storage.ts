import { and, count, eq, exists, gt, isNull, lt, or, sql } from 'drizzle-orm'

import { refreshListingFacetsQueries } from '../db/listing-facets'
import { auctionListings, ingestionRuns } from '../db/schema'
import type { AppDatabase } from '../db/types'
import type { AuctionProvider, NormalizedListing } from '../providers/types'
import { type IngestionStorage, type RunState, SyncError } from './sync'

const DOMAIN_BATCH_SIZE = 100
const LISTING_BATCH_SIZE = 25
const METRICS_BATCH_SIZE = 100

// Unseen listings whose auction has ended are expected churn. Unseen listings
// that were still scheduled to run usually mean the provider returned a short
// or empty page mid-inventory, so a run that would remove many of them fails
// instead of emptying the table.
const VANISHED_LISTINGS_MINIMUM = 500
const VANISHED_LISTINGS_RATIO = 0.1

export function vanishedListingsLimit(recordsFetched: number) {
  return Math.max(VANISHED_LISTINGS_MINIMUM, Math.floor(recordsFetched * VANISHED_LISTINGS_RATIO))
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function listingValues(listing: NormalizedListing, seenAt: Date) {
  return {
    provider: listing.provider,
    externalId: listing.externalId,
    domainName: listing.domainName,
    auctionUrl: listing.auctionUrl,
    auctionType: listing.auctionType,
    currency: listing.currency,
    currentBidCents: listing.currentBidCents,
    bidCount: listing.bidCount,
    bidderCount: listing.bidderCount,
    startsAt: listing.startsAt?.getTime() ?? null,
    endsAt: listing.endsAt.getTime(),
    ageYears: listing.ageYears,
    inboundLinks: listing.inboundLinks,
    visitors: listing.visitors,
    appraisalCents: listing.appraisalCents,
    renewalPriceCents: listing.renewalPriceCents,
    status: 'active' as const,
    firstSeenAt: seenAt.getTime(),
    lastSeenAt: seenAt.getTime()
  }
}

const INSERT_DOMAINS_SQL = `
  INSERT INTO domains (name, first_seen_at)
  SELECT json_extract(value, '$.name'), ?
  FROM json_each(?)
  WHERE EXISTS (
    SELECT 1 FROM ingestion_runs
    WHERE id = ? AND provider = ? AND status = 'running' AND started_at = ?
  )
  ON CONFLICT(name) DO NOTHING
`

const UPSERT_LISTINGS_SQL = `
  INSERT INTO auction_listings (
    provider, external_id, domain_name, auction_url, auction_type, currency,
    current_bid_cents, bid_count, bidder_count, starts_at, ends_at, age_years,
    inbound_links, visitors, appraisal_cents, renewal_price_cents,
    status, first_seen_at, last_seen_at
  )
  SELECT
    json_extract(value, '$.provider'), json_extract(value, '$.externalId'),
    json_extract(value, '$.domainName'), json_extract(value, '$.auctionUrl'),
    json_extract(value, '$.auctionType'), json_extract(value, '$.currency'),
    json_extract(value, '$.currentBidCents'), json_extract(value, '$.bidCount'),
    json_extract(value, '$.bidderCount'), json_extract(value, '$.startsAt'),
    json_extract(value, '$.endsAt'), json_extract(value, '$.ageYears'),
    json_extract(value, '$.inboundLinks'), json_extract(value, '$.visitors'),
    json_extract(value, '$.appraisalCents'), json_extract(value, '$.renewalPriceCents'),
    'active', json_extract(value, '$.firstSeenAt'), json_extract(value, '$.lastSeenAt')
  FROM json_each(?)
  WHERE EXISTS (
    SELECT 1 FROM ingestion_runs
    WHERE id = ? AND provider = ? AND status = 'running' AND started_at = ?
  )
  ON CONFLICT(provider, external_id) DO UPDATE SET
    domain_name = excluded.domain_name, auction_url = excluded.auction_url,
    auction_type = excluded.auction_type, currency = excluded.currency,
    current_bid_cents = excluded.current_bid_cents, bid_count = excluded.bid_count,
    bidder_count = excluded.bidder_count, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, age_years = excluded.age_years,
    inbound_links = excluded.inbound_links, visitors = excluded.visitors,
    appraisal_cents = excluded.appraisal_cents,
    renewal_price_cents = excluded.renewal_price_cents,
    status = 'active', last_seen_at = excluded.last_seen_at
`

// Feed metrics are refreshed by every sync that carries them: latest wins.
const UPSERT_SEO_METRICS_SQL = `
  INSERT INTO domain_seo_metrics (
    domain_name, source, majestic_tf, majestic_cf, majestic_backlinks,
    majestic_ref_domains, semrush_as, semrush_ref_domains, semrush_backlinks,
    updated_at
  )
  SELECT
    json_extract(value, '$.domainName'), ?,
    json_extract(value, '$.majesticTf'), json_extract(value, '$.majesticCf'),
    json_extract(value, '$.majesticBacklinks'),
    json_extract(value, '$.majesticRefDomains'),
    json_extract(value, '$.semrushAs'),
    json_extract(value, '$.semrushRefDomains'),
    json_extract(value, '$.semrushBacklinks'), ?
  FROM json_each(?)
  WHERE EXISTS (
    SELECT 1 FROM ingestion_runs
    WHERE id = ? AND provider = ? AND status = 'running' AND started_at = ?
  )
  ON CONFLICT(domain_name) DO UPDATE SET
    source = excluded.source, majestic_tf = excluded.majestic_tf,
    majestic_cf = excluded.majestic_cf,
    majestic_backlinks = excluded.majestic_backlinks,
    majestic_ref_domains = excluded.majestic_ref_domains,
    semrush_as = excluded.semrush_as,
    semrush_ref_domains = excluded.semrush_ref_domains,
    semrush_backlinks = excluded.semrush_backlinks,
    updated_at = excluded.updated_at
`

function runningRunFilter(provider: AuctionProvider, run: Pick<RunState, 'runId' | 'startedAt'>) {
  return and(
    eq(ingestionRuns.id, run.runId),
    eq(ingestionRuns.provider, provider),
    eq(ingestionRuns.status, 'running'),
    eq(ingestionRuns.startedAt, run.startedAt)
  )
}

function runSelection() {
  return {
    runId: ingestionRuns.id,
    startedAt: ingestionRuns.startedAt,
    nextPage: ingestionRuns.nextPage,
    pagesFetched: ingestionRuns.pagesFetched,
    recordsFetched: ingestionRuns.recordsFetched,
    recordsUpserted: ingestionRuns.recordsUpserted,
    recordsInactivated: ingestionRuns.recordsInactivated,
    recordsRejected: ingestionRuns.recordsRejected
  }
}

function requireRun(run: RunState | undefined) {
  if (!run) throw new SyncError('sync_stale_continuation')
  return run
}

export function createD1IngestionStorage(
  db: AppDatabase,
  provider: AuctionProvider
): IngestionStorage {
  return {
    provider,

    async startRun(startedAt) {
      const [, inserted] = await db.batch([
        db
          .update(ingestionRuns)
          .set({
            status: 'failed',
            completedAt: startedAt,
            errorCode: 'sync_interrupted'
          })
          .where(and(eq(ingestionRuns.provider, provider), eq(ingestionRuns.status, 'running'))),
        db
          .insert(ingestionRuns)
          .values({ provider, status: 'running', startedAt })
          .returning(runSelection())
      ])

      return requireRun(inserted[0])
    },

    async loadRunningRun(runId) {
      const [run] = await db
        .select(runSelection())
        .from(ingestionRuns)
        .where(
          and(
            eq(ingestionRuns.id, runId),
            eq(ingestionRuns.provider, provider),
            eq(ingestionRuns.status, 'running')
          )
        )
        .limit(1)
      return requireRun(run)
    },

    async upsertListings(run, listings) {
      if (listings.length === 0) return
      if (listings.some(listing => listing.provider !== provider)) {
        throw new SyncError('sync_invalid_request')
      }
      const uniqueDomains = [...new Set(listings.map(listing => listing.domainName))]
      const domainStatements = chunks(uniqueDomains, DOMAIN_BATCH_SIZE).map(batch =>
        db.$client
          .prepare(INSERT_DOMAINS_SQL)
          .bind(
            run.startedAt.getTime(),
            JSON.stringify(batch.map(name => ({ name }))),
            run.runId,
            provider,
            run.startedAt.getTime()
          )
      )
      const listingStatements = chunks(listings, LISTING_BATCH_SIZE).map(batch =>
        db.$client
          .prepare(UPSERT_LISTINGS_SQL)
          .bind(
            JSON.stringify(batch.map(listing => listingValues(listing, run.startedAt))),
            run.runId,
            provider,
            run.startedAt.getTime()
          )
      )
      const metrics = listings.flatMap(listing =>
        listing.seoMetrics ? [{ domainName: listing.domainName, ...listing.seoMetrics }] : []
      )
      const metricStatements = chunks(metrics, METRICS_BATCH_SIZE).map(batch =>
        db.$client
          .prepare(UPSERT_SEO_METRICS_SQL)
          .bind(
            provider,
            run.startedAt.getTime(),
            JSON.stringify(batch),
            run.runId,
            provider,
            run.startedAt.getTime()
          )
      )
      const results = await db.$client.batch([
        ...domainStatements,
        ...listingStatements,
        ...metricStatements
      ])
      const listingChanges = results
        .slice(domainStatements.length, domainStatements.length + listingStatements.length)
        .reduce((total, result) => total + (result.meta.changes ?? 0), 0)
      if (listingChanges === 0) {
        throw new SyncError('sync_stale_continuation')
      }
    },

    async finalizeSuccessfulRun(run, finalization) {
      const runFilter = runningRunFilter(provider, run)
      const guardedRunningRun = db
        .select({ id: ingestionRuns.id })
        .from(ingestionRuns)
        .where(runFilter)
      const reconciliationFilter = and(
        eq(auctionListings.provider, provider),
        eq(auctionListings.status, 'active'),
        lt(auctionListings.lastSeenAt, run.startedAt),
        exists(guardedRunningRun)
      )!

      const [vanished] = await db
        .select({ value: count() })
        .from(auctionListings)
        .where(
          and(
            reconciliationFilter,
            or(isNull(auctionListings.endsAt), gt(auctionListings.endsAt, finalization.completedAt))
          )
        )
      if ((vanished?.value ?? 0) > vanishedListingsLimit(finalization.recordsFetched)) {
        throw new SyncError('sync_reconciliation_guard')
      }

      // One atomic batch: record the count, inactivate exactly those rows
      // while the run is still running, mark the run succeeded, then rebuild
      // the facet values from the reconciled active inventory.
      const [, , completed] = await db.batch([
        db
          .update(ingestionRuns)
          .set({
            recordsInactivated: sql`(select count(*) from ${auctionListings} where ${reconciliationFilter})`
          })
          .where(runFilter),
        db.update(auctionListings).set({ status: 'inactive' }).where(reconciliationFilter),
        db
          .update(ingestionRuns)
          .set({
            status: 'succeeded',
            completedAt: finalization.completedAt,
            pagesFetched: finalization.pagesFetched,
            recordsFetched: finalization.recordsFetched,
            recordsUpserted: finalization.recordsUpserted,
            recordsRejected: finalization.recordsRejected,
            errorCode: null,
            failedPage: null
          })
          .where(runFilter)
          .returning({ recordsInactivated: ingestionRuns.recordsInactivated }),
        ...refreshListingFacetsQueries(db)
      ])
      if (!completed[0]) {
        throw new SyncError('sync_stale_continuation')
      }
      return completed[0].recordsInactivated
    },

    async updateRunProgress(run) {
      const updated = await db
        .update(ingestionRuns)
        .set({
          nextPage: run.nextPage,
          pagesFetched: run.pagesFetched,
          recordsFetched: run.recordsFetched,
          recordsUpserted: run.recordsUpserted,
          recordsInactivated: run.recordsInactivated,
          recordsRejected: run.recordsRejected
        })
        .where(runningRunFilter(provider, run))
        .returning({ id: ingestionRuns.id })
      if (!updated[0]) {
        throw new SyncError('sync_stale_continuation')
      }
    },

    async completeRun(run, completion) {
      const completed = await db
        .update(ingestionRuns)
        .set({
          status: completion.status,
          completedAt: completion.completedAt,
          pagesFetched: completion.pagesFetched,
          recordsFetched: completion.recordsFetched,
          recordsUpserted: completion.recordsUpserted,
          recordsInactivated: completion.recordsInactivated,
          recordsRejected: completion.recordsRejected,
          errorCode: completion.errorCode,
          failedPage: completion.failedPage
        })
        .where(runningRunFilter(provider, run))
        .returning({ id: ingestionRuns.id })
      if (!completed[0]) {
        throw new SyncError('sync_stale_continuation')
      }
    }
  }
}
