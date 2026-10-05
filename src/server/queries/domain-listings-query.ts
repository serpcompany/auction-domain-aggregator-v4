import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  max,
  not,
  type AnyColumn,
  sql,
  type SQL,
} from 'drizzle-orm';

import type {
  DomainTableEndingWindow,
  DomainTableFilters,
} from '@/domain/domain-table';
import {
  DOMAIN_TABLE_AUCTION_SOURCES,
  DOMAIN_TABLE_AUCTION_TYPES,
} from '@/domain/domain-table';
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
  bidderCount: number;
  startsAt: Date | null;
  endsAt: Date;
  ageYears: number | null;
  inboundLinks: number | null;
  visitors: number | null;
  dynadotAppraisalCents: number | null;
  renewalPriceCents: number | null;
  domainLength: number;
  tld: string;
  hasHyphen: boolean;
  hasDigit: boolean;
}

export interface DomainListingsResult {
  rows: DomainListingRow[];
  total: number;
  page: number;
  sources: string[];
  auctionTypes: string[];
  tlds: string[];
  latestSuccessfulSync: Date | null;
}

const TLD_FACET_LIMIT = 250;
const ENDING_WINDOW_MILLISECONDS: Record<DomainTableEndingWindow, number> = {
  '1h': 60 * 60 * 1_000,
  '6h': 6 * 60 * 60 * 1_000,
  '24h': 24 * 60 * 60 * 1_000,
  '3d': 3 * 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000,
};

function escapeLike(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function domainLengthExpression() {
  return sql<number>`length(${auctionListings.domainName})`;
}

function tldExpression() {
  // Domain names are normalized before storage. JSON extraction provides the
  // final label correctly even for the small number of multi-dot names.
  return sql<string>`lower(json_extract('["' || replace(${auctionListings.domainName}, '.', '","') || '"]', '$[#-1]'))`;
}

function activeListingWhere(filters: DomainTableFilters, now: Date) {
  const conditions: SQL[] = [eq(auctionListings.status, 'active')];

  if (filters.query) {
    conditions.push(
      sql`lower(${auctionListings.domainName}) like ${`%${escapeLike(filters.query)}%`} escape '\\'`,
    );
  }
  if (filters.sources.length > 0) {
    conditions.push(inArray(auctionListings.provider, filters.sources));
  }
  if (filters.auctionTypes.length > 0) {
    conditions.push(
      inArray(
        sql<string>`lower(${auctionListings.auctionType})`,
        filters.auctionTypes,
      ),
    );
  }
  if (filters.tlds.length > 0) {
    conditions.push(inArray(tldExpression(), filters.tlds));
  }
  if (filters.domainLengthMin !== undefined) {
    conditions.push(gte(domainLengthExpression(), filters.domainLengthMin));
  }
  if (filters.domainLengthMax !== undefined) {
    conditions.push(lte(domainLengthExpression(), filters.domainLengthMax));
  }
  if (filters.noHyphens) {
    conditions.push(not(like(auctionListings.domainName, '%-%')));
  }
  if (filters.noDigits) {
    conditions.push(not(sql`${auctionListings.domainName} glob '*[0-9]*'`));
  }
  if (filters.priceMinCents !== undefined) {
    conditions.push(
      gte(auctionListings.currentBidCents, filters.priceMinCents),
    );
  }
  if (filters.priceMaxCents !== undefined) {
    conditions.push(
      lte(auctionListings.currentBidCents, filters.priceMaxCents),
    );
  }
  if (filters.bidsMin !== undefined) {
    conditions.push(gte(auctionListings.bidCount, filters.bidsMin));
  }
  if (filters.biddersMin !== undefined) {
    conditions.push(gte(auctionListings.bidderCount, filters.biddersMin));
  }
  if (filters.ageMin !== undefined) {
    conditions.push(gte(auctionListings.ageYears, filters.ageMin));
  }
  if (filters.ageMax !== undefined) {
    conditions.push(lte(auctionListings.ageYears, filters.ageMax));
  }
  if (filters.linksMin !== undefined) {
    conditions.push(gte(auctionListings.inboundLinks, filters.linksMin));
  }
  if (filters.visitorsMin !== undefined) {
    conditions.push(gte(auctionListings.visitors, filters.visitorsMin));
  }
  if (filters.appraisalMinCents !== undefined) {
    conditions.push(
      gte(auctionListings.dynadotAppraisalCents, filters.appraisalMinCents),
    );
  }
  if (filters.renewalMaxCents !== undefined) {
    conditions.push(
      lte(auctionListings.renewalPriceCents, filters.renewalMaxCents),
    );
  }
  if (filters.endingWithin) {
    conditions.push(
      lte(
        auctionListings.endsAt,
        new Date(
          now.getTime() + ENDING_WINDOW_MILLISECONDS[filters.endingWithin],
        ),
      ),
    );
  }

  return and(...conditions);
}

type SortableExpression = AnyColumn | SQL<number>;

function listingOrder(filters: DomainTableFilters) {
  const columns: Record<DomainTableFilters['sort'], SortableExpression> = {
    domain: auctionListings.domainName,
    source: auctionListings.provider,
    price: auctionListings.currentBidCents,
    bids: auctionListings.bidCount,
    bidders: auctionListings.bidderCount,
    endsAt: auctionListings.endsAt,
    age: auctionListings.ageYears,
    links: auctionListings.inboundLinks,
    visitors: auctionListings.visitors,
    appraisal: auctionListings.dynadotAppraisalCents,
    renewal: auctionListings.renewalPriceCents,
    domainLength: domainLengthExpression(),
  };
  const column = columns[filters.sort];
  const order = filters.direction === 'desc' ? desc : asc;
  const nullBearing = [
    'age',
    'links',
    'visitors',
    'appraisal',
    'renewal',
  ].includes(filters.sort);

  return [
    ...(nullBearing ? [asc(sql`${column} is null`)] : []),
    order(column),
    asc(auctionListings.domainName),
    asc(auctionListings.provider),
    asc(auctionListings.externalId),
  ];
}

export async function queryDomainListingsWithDatabase(
  filters: DomainTableFilters,
  database: AppDatabase,
  now = new Date(),
): Promise<DomainListingsResult> {
  const where = activeListingWhere(filters, now);

  // Keep these reads sequential. Concurrent statements against Wrangler's
  // local SQLite-backed D1 can race snapshots and fail with SQLITE_BUSY.
  const totalRows = await database
    .select({ value: count() })
    .from(auctionListings)
    .where(where);
  const total = totalRows[0]?.value ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, lastPage);

  const rawRows = await database
    .select({
      provider: auctionListings.provider,
      externalId: auctionListings.externalId,
      domainName: auctionListings.domainName,
      auctionUrl: auctionListings.auctionUrl,
      auctionType: auctionListings.auctionType,
      currency: auctionListings.currency,
      currentBidCents: auctionListings.currentBidCents,
      bidCount: auctionListings.bidCount,
      bidderCount: auctionListings.bidderCount,
      startsAt: auctionListings.startsAt,
      endsAt: auctionListings.endsAt,
      ageYears: auctionListings.ageYears,
      inboundLinks: auctionListings.inboundLinks,
      visitors: auctionListings.visitors,
      dynadotAppraisalCents: auctionListings.dynadotAppraisalCents,
      renewalPriceCents: auctionListings.renewalPriceCents,
      domainLength: domainLengthExpression(),
      tld: tldExpression(),
      hasHyphen: sql<number>`instr(${auctionListings.domainName}, '-') > 0`,
      hasDigit: sql<number>`${auctionListings.domainName} glob '*[0-9]*'`,
    })
    .from(auctionListings)
    .where(where)
    .orderBy(...listingOrder(filters))
    .limit(filters.pageSize)
    .offset((page - 1) * filters.pageSize);

  const sourceRows = await database
    .select({ source: auctionListings.provider })
    .from(auctionListings)
    .where(
      and(
        eq(auctionListings.status, 'active'),
        inArray(auctionListings.provider, DOMAIN_TABLE_AUCTION_SOURCES),
      ),
    )
    .groupBy(auctionListings.provider)
    .orderBy(asc(auctionListings.provider));

  const auctionType = sql<string>`lower(${auctionListings.auctionType})`;
  const auctionTypeRows = await database
    .select({ auctionType })
    .from(auctionListings)
    .where(
      and(
        eq(auctionListings.status, 'active'),
        inArray(auctionType, DOMAIN_TABLE_AUCTION_TYPES),
      ),
    )
    .groupBy(auctionType)
    .orderBy(asc(auctionType));

  const tld = tldExpression();
  const tldRows = await database
    .select({ tld, listings: count() })
    .from(auctionListings)
    .where(eq(auctionListings.status, 'active'))
    .groupBy(tld)
    .orderBy(desc(count()), asc(tld))
    .limit(TLD_FACET_LIMIT);

  const latestSyncRows = await database
    .select({ value: max(ingestionRuns.completedAt) })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.status, 'succeeded'));

  return {
    rows: rawRows.map((row) => ({
      ...row,
      hasHyphen: row.hasHyphen === 1,
      hasDigit: row.hasDigit === 1,
    })),
    total,
    page,
    sources: sourceRows.map(({ source }) => source),
    auctionTypes: auctionTypeRows.map(({ auctionType: value }) => value),
    tlds: tldRows.map(({ tld: value }) => value).sort(),
    latestSuccessfulSync: latestSyncRows[0]?.value ?? null,
  };
}
