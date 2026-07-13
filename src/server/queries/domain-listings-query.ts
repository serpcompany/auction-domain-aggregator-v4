import { and, asc, count, desc, eq, max, sql, type SQL } from 'drizzle-orm';

import type { DomainTableFilters } from '@/domain/domain-table';
import { auctionListings, ingestionRuns } from '@/server/db/schema';
import type { AppDatabase } from '@/server/db/types';

export interface DomainListingRow {
  provider: string;
  externalId: string;
  domainName: string;
  auctionUrl: string;
  auctionType: string;
  currency: string;
  currentBidCents: number;
  bidCount: number;
  endsAt: Date;
  ageYears: number | null;
}

export interface DomainListingsResult {
  rows: DomainListingRow[];
  total: number;
  page: number;
  sources: string[];
  latestSuccessfulSync: Date | null;
}

function escapeLike(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function activeListingWhere(filters: DomainTableFilters) {
  const conditions: SQL[] = [eq(auctionListings.status, 'active')];

  if (filters.query) {
    conditions.push(
      sql`lower(${auctionListings.domainName}) like ${`%${escapeLike(filters.query)}%`} escape '\\'`,
    );
  }
  if (filters.source) {
    conditions.push(eq(auctionListings.provider, filters.source));
  }

  return and(...conditions);
}

function listingOrder(filters: DomainTableFilters) {
  const columns = {
    domain: auctionListings.domainName,
    source: auctionListings.provider,
    price: auctionListings.currentBidCents,
    bids: auctionListings.bidCount,
    endsAt: auctionListings.endsAt,
    age: auctionListings.ageYears,
  } as const;
  const order = filters.direction === 'desc' ? desc : asc;

  return [
    order(columns[filters.sort]),
    asc(auctionListings.domainName),
    asc(auctionListings.provider),
    asc(auctionListings.externalId),
  ];
}

export async function queryDomainListingsWithDatabase(
  filters: DomainTableFilters,
  database: AppDatabase,
): Promise<DomainListingsResult> {
  const where = activeListingWhere(filters);

  // Keep these reads sequential. Concurrent statements against Wrangler's
  // local SQLite-backed D1 can race snapshots and fail with SQLITE_BUSY.
  const totalRows = await database
    .select({ value: count() })
    .from(auctionListings)
    .where(where);
  const total = totalRows[0]?.value ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, lastPage);

  const rows = await database
    .select({
      provider: auctionListings.provider,
      externalId: auctionListings.externalId,
      domainName: auctionListings.domainName,
      auctionUrl: auctionListings.auctionUrl,
      auctionType: auctionListings.auctionType,
      currency: auctionListings.currency,
      currentBidCents: auctionListings.currentBidCents,
      bidCount: auctionListings.bidCount,
      endsAt: auctionListings.endsAt,
      ageYears: auctionListings.ageYears,
    })
    .from(auctionListings)
    .where(where)
    .orderBy(...listingOrder(filters))
    .limit(filters.pageSize)
    .offset((page - 1) * filters.pageSize);

  const sourceRows = await database
    .select({ source: auctionListings.provider })
    .from(auctionListings)
    .where(eq(auctionListings.status, 'active'))
    .groupBy(auctionListings.provider)
    .orderBy(asc(auctionListings.provider));

  const latestSyncRows = await database
    .select({ value: max(ingestionRuns.completedAt) })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.status, 'succeeded'));

  return {
    rows,
    total,
    page,
    sources: sourceRows.map(({ source }) => source),
    latestSuccessfulSync: latestSyncRows[0]?.value ?? null,
  };
}
