import { and, count, eq, exists, lt } from 'drizzle-orm';

import { auctionListings, ingestionRuns } from '../db/schema';
import type { AppDatabase } from '../db/types';
import type { DynadotListing } from '../providers/dynadot';
import {
  syncDynadotWithStorage,
  type DynadotIngestionStorage,
  type DynadotRunState,
  type DynadotSyncSummary,
  type SyncDynadotOptions,
} from './sync-dynadot';
import { DynadotSyncError } from './sync-dynadot';

const DOMAIN_BATCH_SIZE = 100;
const LISTING_BATCH_SIZE = 25;

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function listingValues(listing: DynadotListing, seenAt: Date) {
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
    dynadotAppraisalCents: listing.dynadotAppraisalCents,
    renewalPriceCents: listing.renewalPriceCents,
    status: 'active' as const,
    firstSeenAt: seenAt.getTime(),
    lastSeenAt: seenAt.getTime(),
  };
}

const INSERT_DOMAINS_SQL = `
  INSERT INTO domains (name, first_seen_at)
  SELECT json_extract(value, '$.name'), ?
  FROM json_each(?)
  WHERE EXISTS (
    SELECT 1 FROM ingestion_runs
    WHERE id = ? AND provider = 'dynadot' AND status = 'running' AND started_at = ?
  )
  ON CONFLICT(name) DO NOTHING
`;

const UPSERT_LISTINGS_SQL = `
  INSERT INTO auction_listings (
    provider, external_id, domain_name, auction_url, auction_type, currency,
    current_bid_cents, bid_count, bidder_count, starts_at, ends_at, age_years,
    inbound_links, visitors, dynadot_appraisal_cents, renewal_price_cents,
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
    json_extract(value, '$.dynadotAppraisalCents'), json_extract(value, '$.renewalPriceCents'),
    'active', json_extract(value, '$.firstSeenAt'), json_extract(value, '$.lastSeenAt')
  FROM json_each(?)
  WHERE EXISTS (
    SELECT 1 FROM ingestion_runs
    WHERE id = ? AND provider = 'dynadot' AND status = 'running' AND started_at = ?
  )
  ON CONFLICT(provider, external_id) DO UPDATE SET
    domain_name = excluded.domain_name, auction_url = excluded.auction_url,
    auction_type = excluded.auction_type, currency = excluded.currency,
    current_bid_cents = excluded.current_bid_cents, bid_count = excluded.bid_count,
    bidder_count = excluded.bidder_count, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, age_years = excluded.age_years,
    inbound_links = excluded.inbound_links, visitors = excluded.visitors,
    dynadot_appraisal_cents = excluded.dynadot_appraisal_cents,
    renewal_price_cents = excluded.renewal_price_cents,
    status = 'active', last_seen_at = excluded.last_seen_at
`;

function runningRunFilter(run: Pick<DynadotRunState, 'runId' | 'startedAt'>) {
  return and(
    eq(ingestionRuns.id, run.runId),
    eq(ingestionRuns.provider, 'dynadot'),
    eq(ingestionRuns.status, 'running'),
    eq(ingestionRuns.startedAt, run.startedAt),
  );
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
  };
}

function requireRun(run: DynadotRunState | undefined) {
  if (!run) throw new DynadotSyncError('dynadot_stale_continuation');
  return run;
}

export function createDynadotD1Storage(
  db: AppDatabase,
): DynadotIngestionStorage {
  return {
    async startRun(startedAt) {
      const [, inserted] = await db.batch([
        db
          .update(ingestionRuns)
          .set({
            status: 'failed',
            completedAt: startedAt,
            errorCode: 'dynadot_sync_interrupted',
          })
          .where(
            and(
              eq(ingestionRuns.provider, 'dynadot'),
              eq(ingestionRuns.status, 'running'),
            ),
          ),
        db
          .insert(ingestionRuns)
          .values({ provider: 'dynadot', status: 'running', startedAt })
          .returning(runSelection()),
      ]);

      return requireRun(inserted[0]);
    },

    async loadRunningRun(runId) {
      const [run] = await db
        .select(runSelection())
        .from(ingestionRuns)
        .where(
          and(
            eq(ingestionRuns.id, runId),
            eq(ingestionRuns.provider, 'dynadot'),
            eq(ingestionRuns.status, 'running'),
          ),
        )
        .limit(1);
      return requireRun(run);
    },

    async upsertListings(run, listings) {
      if (listings.length === 0) return;
      const uniqueDomains = [
        ...new Set(listings.map((listing) => listing.domainName)),
      ];
      const domainStatements = chunks(uniqueDomains, DOMAIN_BATCH_SIZE).map(
        (batch) =>
          db.$client
            .prepare(INSERT_DOMAINS_SQL)
            .bind(
              run.startedAt.getTime(),
              JSON.stringify(batch.map((name) => ({ name }))),
              run.runId,
              run.startedAt.getTime(),
            ),
      );
      const listingStatements = chunks(listings, LISTING_BATCH_SIZE).map(
        (batch) =>
          db.$client
            .prepare(UPSERT_LISTINGS_SQL)
            .bind(
              JSON.stringify(
                batch.map((listing) => listingValues(listing, run.startedAt)),
              ),
              run.runId,
              run.startedAt.getTime(),
            ),
      );
      const results = await db.$client.batch([
        ...domainStatements,
        ...listingStatements,
      ]);
      const listingChanges = results
        .slice(domainStatements.length)
        .reduce((total, result) => total + (result.meta.changes ?? 0), 0);
      if (listingChanges === 0) {
        throw new DynadotSyncError('dynadot_stale_continuation');
      }
    },

    async finalizeSuccessfulRun(run, finalization) {
      const runFilter = runningRunFilter(run);
      const guardedRunningRun = db
        .select({ id: ingestionRuns.id })
        .from(ingestionRuns)
        .where(runFilter);
      const reconciliationFilter = and(
        eq(auctionListings.provider, 'dynadot'),
        eq(auctionListings.status, 'active'),
        lt(auctionListings.lastSeenAt, run.startedAt),
        exists(guardedRunningRun),
      );
      const [result] = await db
        .select({ value: count() })
        .from(auctionListings)
        .where(reconciliationFilter);
      const recordsInactivated = result?.value ?? 0;

      const [, completed] = await db.batch([
        db
          .update(auctionListings)
          .set({ status: 'inactive' })
          .where(reconciliationFilter),
        db
          .update(ingestionRuns)
          .set({
            status: 'succeeded',
            completedAt: finalization.completedAt,
            pagesFetched: finalization.pagesFetched,
            recordsFetched: finalization.recordsFetched,
            recordsUpserted: finalization.recordsUpserted,
            recordsInactivated,
            errorCode: null,
          })
          .where(runFilter)
          .returning({ id: ingestionRuns.id }),
      ]);
      if (!completed[0]) {
        throw new DynadotSyncError('dynadot_stale_continuation');
      }
      return recordsInactivated;
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
        })
        .where(runningRunFilter(run))
        .returning({ id: ingestionRuns.id });
      if (!updated[0]) {
        throw new DynadotSyncError('dynadot_stale_continuation');
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
          errorCode: completion.errorCode,
        })
        .where(runningRunFilter(run))
        .returning({ id: ingestionRuns.id });
      if (!completed[0]) {
        throw new DynadotSyncError('dynadot_stale_continuation');
      }
    },
  };
}

export function syncDynadot(
  db: AppDatabase,
  options: SyncDynadotOptions,
): Promise<DynadotSyncSummary> {
  return syncDynadotWithStorage(createDynadotD1Storage(db), options);
}
