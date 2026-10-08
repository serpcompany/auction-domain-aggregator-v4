import { and, count, eq, exists, gt, inArray, isNull, or, type SQLWrapper, sql } from 'drizzle-orm'

import { refreshListingFacetsQueries } from '../db/listing-facets'
import { auctionListings, ingestionRunSeenPages, ingestionRuns } from '../db/schema'
import type { AppDatabase } from '../db/types'
import type { AuctionProvider, NormalizedListing } from '../providers/types'
import { errorMessage, type IngestionStorage, type RunState, SyncError } from './sync'

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

// Every write is billed per row, plus a row per index it touches, so an
// unchanged listing is left alone: its seen-pages entry is what proves the
// run saw it. `last_seen_at` is therefore the start of the last run that
// changed the row.
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
  WHERE auction_listings.status <> 'active'
    OR auction_listings.domain_name IS NOT excluded.domain_name
    OR auction_listings.auction_url IS NOT excluded.auction_url
    OR auction_listings.auction_type IS NOT excluded.auction_type
    OR auction_listings.currency IS NOT excluded.currency
    OR auction_listings.current_bid_cents IS NOT excluded.current_bid_cents
    OR auction_listings.bid_count IS NOT excluded.bid_count
    OR auction_listings.bidder_count IS NOT excluded.bidder_count
    OR auction_listings.starts_at IS NOT excluded.starts_at
    OR auction_listings.ends_at IS NOT excluded.ends_at
    OR auction_listings.age_years IS NOT excluded.age_years
    OR auction_listings.inbound_links IS NOT excluded.inbound_links
    OR auction_listings.visitors IS NOT excluded.visitors
    OR auction_listings.appraisal_cents IS NOT excluded.appraisal_cents
    OR auction_listings.renewal_price_cents IS NOT excluded.renewal_price_cents
`

// Feed metrics are refreshed by every sync that carries them: latest wins.
// As with listings, `updated_at` moves only when a value changes.
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
  WHERE domain_seo_metrics.source IS NOT excluded.source
    OR domain_seo_metrics.majestic_tf IS NOT excluded.majestic_tf
    OR domain_seo_metrics.majestic_cf IS NOT excluded.majestic_cf
    OR domain_seo_metrics.majestic_backlinks IS NOT excluded.majestic_backlinks
    OR domain_seo_metrics.majestic_ref_domains IS NOT excluded.majestic_ref_domains
    OR domain_seo_metrics.semrush_as IS NOT excluded.semrush_as
    OR domain_seo_metrics.semrush_ref_domains IS NOT excluded.semrush_ref_domains
    OR domain_seo_metrics.semrush_backlinks IS NOT excluded.semrush_backlinks
`

// A listing goes a week after its auction ends, whatever its provider or
// status: by then the table has hidden it for a week, and a provider that is
// no longer synced (as on Staging) leaves its listings behind otherwise. The
// feed metrics and domains nothing else uses go with it, so storage stops
// growing with every day's ended auctions; a domain with a stored Ahrefs
// rating is kept, since rating it again would cost an Ahrefs call. There is
// no index on `ends_at`, so the table is read once in rowid order from a
// cursor, which costs reads but no index writes.
const DELETE_ENDED_LISTINGS_SQL = `
  DELETE FROM auction_listings WHERE rowid IN (
    SELECT rowid FROM auction_listings
    WHERE rowid > ? AND ends_at < ?
    ORDER BY rowid
    LIMIT ?
  )
  RETURNING rowid, domain_name
`

const DELETE_UNUSED_SEO_METRICS_SQL = `
  DELETE FROM domain_seo_metrics
  WHERE domain_name IN (SELECT value FROM json_each(?))
    AND NOT EXISTS (
      SELECT 1 FROM auction_listings AS l WHERE l.domain_name = domain_seo_metrics.domain_name
    )
`

const DELETE_UNUSED_DOMAINS_SQL = `
  DELETE FROM domains
  WHERE name IN (SELECT value FROM json_each(?))
    AND NOT EXISTS (SELECT 1 FROM auction_listings AS l WHERE l.domain_name = domains.name)
    AND NOT EXISTS (SELECT 1 FROM domain_seo_metrics AS s WHERE s.domain_name = domains.name)
    AND NOT EXISTS (SELECT 1 FROM domain_metrics AS m WHERE m.domain_name = domains.name)
`

// Inserts nothing once the run has stopped running, which is how a stale
// continuation is detected now that unchanged listings write nothing.
const INSERT_SEEN_PAGE_SQL = `
  INSERT INTO ingestion_run_seen_pages (run_id, external_ids)
  SELECT ?, ?
  WHERE EXISTS (
    SELECT 1 FROM ingestion_runs
    WHERE id = ? AND provider = ? AND status = 'running' AND started_at = ?
  )
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

function deleteSeenPages(db: AppDatabase, runIds: number[] | SQLWrapper) {
  return db.delete(ingestionRunSeenPages).where(inArray(ingestionRunSeenPages.runId, runIds))
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
      const [, , inserted] = await db.batch([
        // Leftovers of runs that crashed before finishing.
        deleteSeenPages(
          db,
          db
            .select({ id: ingestionRuns.id })
            .from(ingestionRuns)
            .where(eq(ingestionRuns.provider, provider))
        ),
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
      const seenStatement = db.$client
        .prepare(INSERT_SEEN_PAGE_SQL)
        .bind(
          run.runId,
          JSON.stringify([...new Set(listings.map(listing => listing.externalId))]),
          run.runId,
          provider,
          run.startedAt.getTime()
        )
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
      const [seen] = await db.$client.batch([
        seenStatement,
        ...domainStatements,
        ...listingStatements,
        ...metricStatements
      ])
      if (!seen?.meta.changes) {
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
        sql`${auctionListings.externalId} not in (
          select json_each.value from ingestion_run_seen_pages as seen, json_each(seen.external_ids)
          where seen.run_id = ${run.runId}
        )`,
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
      if (vanished.value > vanishedListingsLimit(finalization.recordsFetched)) {
        throw new SyncError('sync_reconciliation_guard')
      }

      // One atomic batch: inactivate exactly those rows while the run is
      // still running, and mark the run succeeded with that count, which
      // `changes()` takes from the inactivation. D1 resets a request that runs
      // too long: on Staging's 1.1-million-listing Namecheap inventory the
      // reconciliation pass alone takes 12 to 18 seconds, so the batch holds
      // nothing else.
      const [, completed] = await db.batch([
        db.update(auctionListings).set({ status: 'inactive' }).where(reconciliationFilter),
        db
          .update(ingestionRuns)
          .set({
            recordsInactivated: sql`changes()`,
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
          .returning({ recordsInactivated: ingestionRuns.recordsInactivated })
      ])
      if (!completed[0]) {
        throw new SyncError('sync_stale_continuation')
      }
      // Then, in their own request, delete the run's seen pages (about 17 MB
      // of IDs for Namecheap) and rebuild the facet values from the reconciled
      // active inventory. Both are idempotent and the run has succeeded, so a
      // failure is only logged: the provider's next run deletes leftover pages
      // when it starts, and the next successful run rebuilds the facets.
      await db
        .batch([deleteSeenPages(db, [run.runId]), ...refreshListingFacetsQueries(db)])
        .catch((error: unknown) =>
          console.warn('sync_cleanup_failed', { message: errorMessage(error) })
        )
      return completed[0].recordsInactivated
    },

    async deleteEndedListings(before, afterRowid, limit) {
      const { results } = await db.$client
        .prepare(DELETE_ENDED_LISTINGS_SQL)
        .bind(afterRowid, before.getTime(), limit)
        .all<{ rowid: number; domain_name: string }>()
      if (results.length === 0) {
        return { listings: 0, seoMetrics: 0, domains: 0, lastRowid: afterRowid }
      }
      const names = JSON.stringify([...new Set(results.map(row => row.domain_name))])
      const [seoMetrics, unusedDomains] = await db.$client.batch([
        db.$client.prepare(DELETE_UNUSED_SEO_METRICS_SQL).bind(names),
        db.$client.prepare(DELETE_UNUSED_DOMAINS_SQL).bind(names)
      ])
      return {
        listings: results.length,
        seoMetrics: seoMetrics.meta.changes,
        domains: unusedDomains.meta.changes,
        lastRowid: Math.max(...results.map(row => row.rowid))
      }
    },

    async loadSucceededRun(runId) {
      const [run] = await db
        .select({
          pagesFetched: ingestionRuns.pagesFetched,
          recordsFetched: ingestionRuns.recordsFetched,
          recordsUpserted: ingestionRuns.recordsUpserted,
          recordsInactivated: ingestionRuns.recordsInactivated,
          recordsRejected: ingestionRuns.recordsRejected
        })
        .from(ingestionRuns)
        .where(
          and(
            eq(ingestionRuns.id, runId),
            eq(ingestionRuns.provider, provider),
            eq(ingestionRuns.status, 'succeeded')
          )
        )
        .limit(1)
      return run ?? null
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
      const [completed] = await db.batch([
        db
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
            failedPage: completion.failedPage,
            rejectionReasons: completion.rejectionReasons
          })
          .where(runningRunFilter(provider, run))
          .returning({ id: ingestionRuns.id }),
        deleteSeenPages(db, [run.runId])
      ])
      if (!completed[0]) {
        throw new SyncError('sync_stale_continuation')
      }
    }
  }
}
