import {
  type AnyColumn,
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  like,
  lte,
  max,
  not,
  notExists,
  type SQL,
  sql
} from 'drizzle-orm'

import type { DomainTableEndingWindow, DomainTableFilters } from '@/domain/domain-table'
import {
  type AuctionSource,
  type AuctionType,
  DOMAIN_TABLE_AUCTION_SOURCES,
  DOMAIN_TABLE_AUCTION_TYPES
} from '@/domain/domain-table'
import {
  auctionListings,
  domainMetrics,
  domainSeoMetrics,
  ingestionRuns,
  listingFacets
} from '@/server/db/schema'
import type { AppDatabase } from '@/server/db/types'

// Third-party SEO metrics for a domain, as last published by an auction
// provider's feed (`source`, currently only `godaddy`). Each value is null
// when the feed omitted it.
export interface DomainSeoMetrics {
  source: string
  majesticTf: number | null
  majesticCf: number | null
  majesticBacklinks: number | null
  majesticRefDomains: number | null
  semrushAs: number | null
  semrushRefDomains: number | null
  semrushBacklinks: number | null
  updatedAt: Date
}

export interface DomainListingRow {
  provider: string
  externalId: string
  domainName: string
  auctionUrl: string
  auctionType: string
  currency: string
  currentBidCents: number
  bidCount: number
  // Null when the provider publishes no bidder count (GoDaddy).
  bidderCount: number | null
  startsAt: Date | null
  endsAt: Date
  ageYears: number | null
  inboundLinks: number | null
  visitors: number | null
  appraisalCents: number | null
  renewalPriceCents: number | null
  domainLength: number
  tld: string
  hasHyphen: boolean
  hasDigit: boolean
  // Ahrefs DR. `domainRatingFetched` distinguishes "Ahrefs has no rating"
  // (fetched, null) from "not requested yet" (not fetched, null).
  domainRating: number | null
  domainRatingFetched: boolean
  // Null when no feed has published metrics for this domain.
  seoMetrics: DomainSeoMetrics | null
}

// The page reads the facets and freshness once, through
// `queryInventoryStatusWithDatabase`; the listing query does not repeat them.
export interface DomainListingsResult {
  rows: DomainListingRow[]
  total: number
  page: number
}

const ENDING_WINDOW_MILLISECONDS: Record<DomainTableEndingWindow, number> = {
  '1h': 60 * 60 * 1_000,
  '6h': 6 * 60 * 60 * 1_000,
  '24h': 24 * 60 * 60 * 1_000,
  '3d': 3 * 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

// Status changes only when a sync reconciles, so an auction whose end time has
// passed is hidden at read time even if the inventory is stale. `ends_at` is
// never null; a plain range lets SQLite use it in the TLD index.
//
// With `pinned`, every column is written `+column`, which SQLite cannot use
// to choose an index; the results are the same. A metric sort's page walks
// `auction_listings_domain_name_idx` in order and stops after 50 rows, and
// without the `+` a filter (a TLD, a price range) would make SQLite read that
// filter's index and sort every match instead.
function activeListingWhere(filters: DomainTableFilters, now: Date, pinned = false) {
  const column = (target: AnyColumn) => (pinned ? sql`+${target}` : sql`${target}`)
  // Written as SQL, a column binds values unmapped, so times are milliseconds.
  const time = (date: Date) => date.getTime()
  const conditions: SQL[] = [
    eq(column(auctionListings.status), 'active'),
    gt(column(auctionListings.endsAt), time(now))
  ]
  if (filters.query) {
    conditions.push(
      sql`lower(${auctionListings.domainName}) like ${`%${escapeLike(filters.query)}%`} escape '\\'`
    )
  }
  if (filters.sources.length > 0) {
    conditions.push(inArray(column(auctionListings.provider), filters.sources))
  }
  if (filters.auctionTypes.length > 0) {
    conditions.push(
      inArray(sql<string>`lower(${auctionListings.auctionType})`, filters.auctionTypes)
    )
  }
  if (filters.tlds.length > 0) {
    conditions.push(inArray(column(auctionListings.tld), filters.tlds))
  }
  if (filters.domainLengthMin !== undefined) {
    conditions.push(gte(column(auctionListings.domainLength), filters.domainLengthMin))
  }
  if (filters.domainLengthMax !== undefined) {
    conditions.push(lte(column(auctionListings.domainLength), filters.domainLengthMax))
  }
  if (filters.noHyphens) {
    conditions.push(not(like(auctionListings.domainName, '%-%')))
  }
  if (filters.noDigits) {
    conditions.push(not(sql`${auctionListings.domainName} glob '*[0-9]*'`))
  }
  if (filters.priceMinCents !== undefined) {
    conditions.push(gte(column(auctionListings.currentBidCents), filters.priceMinCents))
  }
  if (filters.priceMaxCents !== undefined) {
    conditions.push(lte(column(auctionListings.currentBidCents), filters.priceMaxCents))
  }
  if (filters.bidsMin !== undefined) {
    conditions.push(gte(column(auctionListings.bidCount), filters.bidsMin))
  }
  if (filters.ageMin !== undefined) {
    conditions.push(gte(column(auctionListings.ageYears), filters.ageMin))
  }
  if (filters.ageMax !== undefined) {
    conditions.push(lte(column(auctionListings.ageYears), filters.ageMax))
  }
  if (filters.linksMin !== undefined) {
    conditions.push(gte(column(auctionListings.inboundLinks), filters.linksMin))
  }
  if (filters.visitorsMin !== undefined) {
    conditions.push(gte(column(auctionListings.visitors), filters.visitorsMin))
  }
  if (filters.appraisalMinCents !== undefined) {
    conditions.push(gte(column(auctionListings.appraisalCents), filters.appraisalMinCents))
  }
  if (filters.renewalMaxCents !== undefined) {
    conditions.push(lte(column(auctionListings.renewalPriceCents), filters.renewalMaxCents))
  }
  const seoConditions = [
    filters.majesticTfMin === undefined
      ? undefined
      : gte(domainSeoMetrics.majesticTf, filters.majesticTfMin),
    filters.majesticCfMin === undefined
      ? undefined
      : gte(domainSeoMetrics.majesticCf, filters.majesticCfMin),
    filters.majesticRefDomainsMin === undefined
      ? undefined
      : gte(domainSeoMetrics.majesticRefDomains, filters.majesticRefDomainsMin),
    filters.semrushAsMin === undefined
      ? undefined
      : gte(domainSeoMetrics.semrushAs, filters.semrushAsMin)
  ].filter(condition => condition !== undefined)
  if (seoConditions.length > 0) {
    // A subquery rather than a join: the metric indexes find the matching
    // domains, and listings are reached through their domain-name index.
    conditions.push(
      inArray(
        column(auctionListings.domainName),
        sql`(select ${domainSeoMetrics.domainName} from ${domainSeoMetrics} where ${and(...seoConditions)})`
      )
    )
  }
  if (filters.domainRatingMin !== undefined) {
    // Only a stored rating can satisfy a minimum, as for the feed metrics.
    conditions.push(
      inArray(
        column(auctionListings.domainName),
        sql`(select ${domainMetrics.domainName} from ${domainMetrics} where ${domainMetrics.metric} = 'ahrefs_dr' and ${domainMetrics.status} = 'ok' and ${domainMetrics.value} >= ${filters.domainRatingMin})`
      )
    )
  }
  if (filters.endingWithin) {
    conditions.push(
      lte(
        column(auctionListings.endsAt),
        time(new Date(now.getTime() + ENDING_WINDOW_MILLISECONDS[filters.endingWithin]))
      )
    )
  }

  return and(...conditions)
}

type SortableExpression = AnyColumn | SQL<number>

const NULL_BEARING_SORTS: ReadonlyArray<DomainTableFilters['sort']> = [
  'age',
  'links',
  'visitors',
  'appraisal',
  'renewal'
]

// Metric values live in other tables, keyed by domain name.
interface MetricSort {
  table: typeof domainSeoMetrics | typeof domainMetrics
  domainName: AnyColumn
  value: AnyColumn
  // The rows of `table` that hold this metric.
  where?: SQL
}

function seoMetricSort(value: AnyColumn): MetricSort {
  return { table: domainSeoMetrics, domainName: domainSeoMetrics.domainName, value }
}

const METRIC_SORTS: Partial<Record<DomainTableFilters['sort'], MetricSort>> = {
  majesticTf: seoMetricSort(domainSeoMetrics.majesticTf),
  majesticCf: seoMetricSort(domainSeoMetrics.majesticCf),
  majesticRefDomains: seoMetricSort(domainSeoMetrics.majesticRefDomains),
  semrushAs: seoMetricSort(domainSeoMetrics.semrushAs),
  // Ahrefs DR exists only for domains someone has viewed.
  domainRating: {
    table: domainMetrics,
    domainName: domainMetrics.domainName,
    value: domainMetrics.value,
    where: eq(domainMetrics.metric, 'ahrefs_dr')
  }
}

// Up to this many matches, a metric sort reads each match's value by primary
// key and sorts them (about 60 ms at the limit). Above it, it walks the
// metric's index instead, which stops after a page but would scan the whole
// metric table for a filter that few listings match.
export const LISTING_DRIVEN_METRIC_SORT_LIMIT = 50_000

const listingRowid = sql`${auctionListings}.rowid`

type MetricSortKey =
  | 'majesticTf'
  | 'majesticCf'
  | 'majesticRefDomains'
  | 'semrushAs'
  | 'domainRating'

function listingOrder(filters: DomainTableFilters) {
  const columns: Record<Exclude<DomainTableFilters['sort'], MetricSortKey>, SortableExpression> = {
    domain: auctionListings.domainName,
    source: auctionListings.provider,
    type: auctionListings.auctionType,
    price: auctionListings.currentBidCents,
    bids: auctionListings.bidCount,
    endsAt: auctionListings.endsAt,
    age: auctionListings.ageYears,
    links: auctionListings.inboundLinks,
    visitors: auctionListings.visitors,
    appraisal: auctionListings.appraisalCents,
    renewal: auctionListings.renewalPriceCents,
    domainLength: auctionListings.domainLength
  }
  const column = columns[filters.sort as Exclude<DomainTableFilters['sort'], MetricSortKey>]
  const order = filters.direction === 'desc' ? desc : asc
  const nullBearing = NULL_BEARING_SORTS.includes(filters.sort)

  return [
    ...(nullBearing ? [asc(sql`${column} is null`)] : []),
    order(column),
    asc(auctionListings.domainName),
    asc(auctionListings.provider),
    asc(auctionListings.externalId)
  ]
}

// A metric sort orders ties, and the listings without a value, by domain name
// and then rowid in the sort's own direction: the order the metric indexes
// and `auction_listings_domain_name_idx` store, which lets a page stop after
// 50 rows. Listings without a value come last in both directions.
function metricOrder(metric: MetricSort, filters: DomainTableFilters) {
  const by = filters.direction === 'desc' ? desc : asc
  // Evaluated once per row: descending already puts nulls last, and ascending
  // replaces them with the largest integer.
  const value = sql<number>`(select ${metric.value} from ${metric.table} where ${and(eq(metric.domainName, auctionListings.domainName), metric.where)})`
  return [
    filters.direction === 'desc' ? desc(value) : asc(sql`ifnull(${value}, 9223372036854775807)`),
    by(auctionListings.domainName),
    by(listingRowid)
  ]
}

const listingSelection = {
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
  appraisalCents: auctionListings.appraisalCents,
  renewalPriceCents: auctionListings.renewalPriceCents,
  domainLength: auctionListings.domainLength,
  tld: auctionListings.tld,
  hasHyphen: sql<number>`instr(${auctionListings.domainName}, '-') > 0`,
  hasDigit: sql<number>`${auctionListings.domainName} glob '*[0-9]*'`
}

interface PageSlice {
  limit: number
  offset: number
}

// A metric sort over many matches, in two parts. Listings whose domain has
// the value come first: SQLite reads the metric's index in order (CROSS JOIN
// keeps it the outer loop) and finds each domain's listings through
// `auction_listings_domain_name_idx`. Listings without it follow, by walking
// that index in name order. Both read the filters pinned (see
// `activeListingWhere`). Only a page that starts among the listings without a
// value counts the others.
async function queryMetricSortPage(
  database: AppDatabase,
  metric: MetricSort,
  filters: DomainTableFilters,
  now: Date,
  { limit, offset }: PageSlice
) {
  const by = filters.direction === 'desc' ? desc : asc
  const where = activeListingWhere(filters, now, true)
  const hasValue = and(metric.where, isNotNull(metric.value))
  const knownWhere = and(eq(auctionListings.domainName, metric.domainName), hasValue, where)
  const knownListings = () =>
    database.select(listingSelection).from(metric.table).crossJoin(auctionListings)

  const known = await knownListings()
    .where(knownWhere)
    .orderBy(by(metric.value), by(metric.domainName), by(listingRowid))
    .limit(limit)
    .offset(offset)
  if (known.length === limit) return known

  let unknownOffset = 0
  if (known.length === 0 && offset > 0) {
    const [{ value }] = await database
      .select({ value: count() })
      .from(metric.table)
      .crossJoin(auctionListings)
      .where(knownWhere)
    unknownOffset = offset - value
  }
  const unknown = await database
    .select(listingSelection)
    .from(auctionListings)
    .where(
      and(
        where,
        notExists(
          database
            .select({ one: sql`1` })
            .from(metric.table)
            .where(and(eq(metric.domainName, auctionListings.domainName), hasValue))
        )
      )
    )
    .orderBy(by(auctionListings.domainName), by(listingRowid))
    .limit(limit - known.length)
    .offset(unknownOffset)
  return [...known, ...unknown]
}

async function queryPageRows(
  database: AppDatabase,
  filters: DomainTableFilters,
  now: Date,
  where: SQL | undefined,
  total: number,
  slice: PageSlice,
  listingDrivenMetricSortLimit: number
) {
  const metric = METRIC_SORTS[filters.sort]
  if (metric && total > listingDrivenMetricSortLimit) {
    return queryMetricSortPage(database, metric, filters, now, slice)
  }
  return database
    .select(listingSelection)
    .from(auctionListings)
    .where(where)
    .orderBy(...(metric ? metricOrder(metric, filters) : listingOrder(filters)))
    .limit(slice.limit)
    .offset(slice.offset)
}

export async function queryDomainListingsWithDatabase(
  filters: DomainTableFilters,
  database: AppDatabase,
  now = new Date(),
  // Tests lower it to run the index-driven metric sort on a few rows.
  listingDrivenMetricSortLimit = LISTING_DRIVEN_METRIC_SORT_LIMIT
): Promise<DomainListingsResult> {
  const where = activeListingWhere(filters, now)

  // Keep these reads sequential. Concurrent statements against Wrangler's
  // local SQLite-backed D1 can race snapshots and fail with SQLITE_BUSY; a
  // D1 batch runs its statements one after another in one round trip.
  const totalRows = await database.select({ value: count() }).from(auctionListings).where(where)
  const [{ value: total }] = totalRows
  const lastPage = Math.max(1, Math.ceil(total / filters.pageSize))
  const page = Math.min(filters.page, lastPage)
  const rawRows =
    total === 0
      ? []
      : await queryPageRows(
          database,
          filters,
          now,
          where,
          total,
          { limit: filters.pageSize, offset: (page - 1) * filters.pageSize },
          listingDrivenMetricSortLimit
        )

  // Looked up only for the visible page, so it stays cheap on any filter.
  const pageDomains = [...new Set(rawRows.map(row => row.domainName))]
  const [ratingRows, seoRows] =
    pageDomains.length === 0
      ? [[], []]
      : await database.batch([
          database
            .select({
              domainName: domainMetrics.domainName,
              status: domainMetrics.status,
              value: domainMetrics.value,
              retryAfter: domainMetrics.retryAfter
            })
            .from(domainMetrics)
            .where(
              and(
                eq(domainMetrics.metric, 'ahrefs_dr'),
                inArray(domainMetrics.domainName, pageDomains)
              )
            ),
          database
            .select()
            .from(domainSeoMetrics)
            .where(inArray(domainSeoMetrics.domainName, pageDomains))
        ])
  // A domain Ahrefs left out of its answer shows as having no rating until it
  // may be asked again. A domain being asked about now counts as not fetched.
  // The schema gives every omission a retry time.
  const ratings = new Map(
    ratingRows
      .filter(
        ({ status, retryAfter }) =>
          status === 'ok' ||
          status === 'not_found' ||
          (status === 'omitted' && Number(retryAfter) > now.getTime())
      )
      .map(({ domainName, value }) => [domainName, { value }])
  )
  const seoMetrics = new Map(seoRows.map(({ domainName, ...metrics }) => [domainName, metrics]))

  return {
    rows: rawRows.map(row => {
      const rating = ratings.get(row.domainName)
      return {
        ...row,
        hasHyphen: row.hasHyphen === 1,
        hasDigit: row.hasDigit === 1,
        domainRating: rating?.value ?? null,
        domainRatingFetched: rating !== undefined,
        seoMetrics: seoMetrics.get(row.domainName) ?? null
      }
    }),
    total,
    page
  }
}

export interface ListingFacets {
  sources: AuctionSource[]
  auctionTypes: AuctionType[]
  tlds: string[]
}

// Facets do not depend on the filters. They are rebuilt when a sync
// succeeds; a value stays offered while one of its auctions can be open.
function listingFacetsQuery(database: AppDatabase, now: Date) {
  return database
    .select({ facet: listingFacets.facet, value: listingFacets.value })
    .from(listingFacets)
    .where(gt(listingFacets.latestEndsAt, now))
    .orderBy(asc(listingFacets.facet), asc(listingFacets.value))
}

function toListingFacets(facetRows: Awaited<ReturnType<typeof listingFacetsQuery>>): ListingFacets {
  const facetValues = (facet: (typeof facetRows)[number]['facet']) =>
    facetRows.filter(row => row.facet === facet).map(({ value }) => value)

  return {
    sources: facetValues('source').filter((value): value is AuctionSource =>
      DOMAIN_TABLE_AUCTION_SOURCES.includes(value as AuctionSource)
    ),
    auctionTypes: facetValues('auction_type').filter((value): value is AuctionType =>
      DOMAIN_TABLE_AUCTION_TYPES.includes(value as AuctionType)
    ),
    tlds: facetValues('tld')
  }
}

export async function queryListingFacetsWithDatabase(
  database: AppDatabase,
  now = new Date()
): Promise<ListingFacets> {
  return toListingFacets(await listingFacetsQuery(database, now))
}

export interface InventoryStatus extends ListingFacets {
  latestSuccessfulSync: Date | null
}

// What the page needs before the listing query finishes: the filter facets
// and the freshness of the inventory, both small, in one round trip.
export async function queryInventoryStatusWithDatabase(
  database: AppDatabase,
  now = new Date()
): Promise<InventoryStatus> {
  const [facetRows, latestSyncRows] = await database.batch([
    listingFacetsQuery(database, now),
    database
      .select({ value: max(ingestionRuns.completedAt) })
      .from(ingestionRuns)
      .where(eq(ingestionRuns.status, 'succeeded'))
  ])
  return { ...toListingFacets(facetRows), latestSuccessfulSync: latestSyncRows[0]?.value ?? null }
}
