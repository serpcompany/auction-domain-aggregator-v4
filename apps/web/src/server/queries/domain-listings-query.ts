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
  isNull,
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
// passed is hidden at read time even if the inventory is stale. The status is
// a literal so that SQLite can use the partial `auction_listings_open_*`
// indexes, whose predicate it must match. `ends_at` is never null; a plain
// range lets SQLite use it in the end-time and TLD indexes. A page in domain
// order writes it as `+ends_at`, which SQLite cannot use in an index, so it
// walks the domain-name index instead of sorting every open listing.
function openListingWhere(now: Date, order: 'any' | 'domain') {
  return and(
    sql`${auctionListings.status} = 'active'`,
    order === 'domain'
      ? sql`+${auctionListings.endsAt} > ${now.getTime()}`
      : gt(auctionListings.endsAt, now)
  )!
}

function activeListingWhere(
  filters: DomainTableFilters,
  now: Date,
  order: 'any' | 'domain' = 'any'
) {
  const conditions: SQL[] = [openListingWhere(now, order)]

  if (filters.query) {
    conditions.push(
      sql`lower(${auctionListings.domainName}) like ${`%${escapeLike(filters.query)}%`} escape '\\'`
    )
  }
  if (filters.sources.length > 0) {
    conditions.push(inArray(auctionListings.provider, filters.sources))
  }
  if (filters.auctionTypes.length > 0) {
    conditions.push(
      inArray(sql<string>`lower(${auctionListings.auctionType})`, filters.auctionTypes)
    )
  }
  if (filters.tlds.length > 0) {
    conditions.push(inArray(auctionListings.tld, filters.tlds))
  }
  if (filters.domainLengthMin !== undefined) {
    conditions.push(gte(auctionListings.domainLength, filters.domainLengthMin))
  }
  if (filters.domainLengthMax !== undefined) {
    conditions.push(lte(auctionListings.domainLength, filters.domainLengthMax))
  }
  if (filters.noHyphens) {
    conditions.push(not(like(auctionListings.domainName, '%-%')))
  }
  if (filters.noDigits) {
    conditions.push(not(sql`${auctionListings.domainName} glob '*[0-9]*'`))
  }
  if (filters.priceMinCents !== undefined) {
    conditions.push(gte(auctionListings.currentBidCents, filters.priceMinCents))
  }
  if (filters.priceMaxCents !== undefined) {
    conditions.push(lte(auctionListings.currentBidCents, filters.priceMaxCents))
  }
  if (filters.bidsMin !== undefined) {
    conditions.push(gte(auctionListings.bidCount, filters.bidsMin))
  }
  if (filters.ageMin !== undefined) {
    conditions.push(gte(auctionListings.ageYears, filters.ageMin))
  }
  if (filters.ageMax !== undefined) {
    conditions.push(lte(auctionListings.ageYears, filters.ageMax))
  }
  if (filters.linksMin !== undefined) {
    conditions.push(gte(auctionListings.inboundLinks, filters.linksMin))
  }
  if (filters.visitorsMin !== undefined) {
    conditions.push(gte(auctionListings.visitors, filters.visitorsMin))
  }
  if (filters.appraisalMinCents !== undefined) {
    conditions.push(gte(auctionListings.appraisalCents, filters.appraisalMinCents))
  }
  if (filters.renewalMaxCents !== undefined) {
    conditions.push(lte(auctionListings.renewalPriceCents, filters.renewalMaxCents))
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
        auctionListings.domainName,
        sql`(select ${domainSeoMetrics.domainName} from ${domainSeoMetrics} where ${and(...seoConditions)})`
      )
    )
  }
  if (filters.endingWithin) {
    conditions.push(
      lte(
        auctionListings.endsAt,
        new Date(now.getTime() + ENDING_WINDOW_MILLISECONDS[filters.endingWithin])
      )
    )
  }

  return and(...conditions)
}

// Each sort walks one index in the page's full order and stops after the
// page: the sort value, then the domain name, the end time, and the rowid,
// all in the requested direction. SQLite uses an index for ORDER BY only when
// the index satisfies every term, so ties cannot keep a fixed ascending order
// on the descending pages. Listings without a value come last in both
// directions.
const listingRowid = sql`${auctionListings}.rowid`

const ORDERED_SORTS = {
  source: auctionListings.provider,
  type: auctionListings.auctionType,
  price: auctionListings.currentBidCents,
  bids: auctionListings.bidCount,
  endsAt: auctionListings.endsAt,
  domainLength: auctionListings.domainLength
} as const satisfies Partial<Record<DomainTableFilters['sort'], AnyColumn>>

const NULLABLE_SORTS = {
  age: auctionListings.ageYears,
  links: auctionListings.inboundLinks,
  visitors: auctionListings.visitors,
  appraisal: auctionListings.appraisalCents,
  renewal: auctionListings.renewalPriceCents
} as const satisfies Partial<Record<DomainTableFilters['sort'], AnyColumn>>

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

const METRIC_SORTS = {
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
} as const satisfies Partial<Record<DomainTableFilters['sort'], MetricSort>>

// Up to this many matches, a metric sort reads each match's metric by primary
// key and sorts them (about 60 ms at the limit). Above it, it walks the
// metric's index and joins listings, which stops after a page but would scan
// the whole metric table for a filter that few listings match.
export const LISTING_DRIVEN_METRIC_SORT_LIMIT = 50_000

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

// Listings with a value come first, in the value's index order; listings
// without one follow in domain order. Only a page that starts among the
// listings without a value needs to know how many have one.
async function knownFirst<Row>(
  slice: PageSlice,
  known: (slice: PageSlice) => Promise<Row[]>,
  unknown: (slice: PageSlice) => Promise<Row[]>,
  countKnown: () => Promise<number>
) {
  const rows = await known(slice)
  if (rows.length === slice.limit) return rows
  const offset = rows.length > 0 || slice.offset === 0 ? 0 : slice.offset - (await countKnown())
  return [...rows, ...(await unknown({ limit: slice.limit - rows.length, offset }))]
}

async function countListings(database: AppDatabase, where: SQL | undefined) {
  const [{ value }] = await database.select({ value: count() }).from(auctionListings).where(where)
  return value
}

function queryPageRows(
  database: AppDatabase,
  filters: DomainTableFilters,
  now: Date,
  total: number,
  slice: PageSlice,
  listingDrivenMetricSortLimit: number
) {
  const by = filters.direction === 'desc' ? desc : asc
  const tieBreak = [by(auctionListings.domainName), by(auctionListings.endsAt), by(listingRowid)]
  const where = activeListingWhere(filters, now)
  const listingPage = (pageWhere: SQL | undefined, order: SQL[], { limit, offset }: PageSlice) =>
    database
      .select(listingSelection)
      .from(auctionListings)
      .where(pageWhere)
      .orderBy(...order)
      .limit(limit)
      .offset(offset)

  if (filters.sort === 'domain') {
    return listingPage(activeListingWhere(filters, now, 'domain'), tieBreak, slice)
  }
  if (filters.sort in ORDERED_SORTS) {
    const column = ORDERED_SORTS[filters.sort as keyof typeof ORDERED_SORTS]
    return listingPage(where, [by(column), ...tieBreak], slice)
  }
  if (filters.sort in NULLABLE_SORTS) {
    const column = NULLABLE_SORTS[filters.sort as keyof typeof NULLABLE_SORTS]
    return knownFirst(
      slice,
      known => listingPage(and(where, isNotNull(column)), [by(column), ...tieBreak], known),
      unknown => listingPage(and(where, isNull(column)), tieBreak, unknown),
      () => countListings(database, and(where, isNotNull(column)))
    )
  }

  const metric = METRIC_SORTS[filters.sort as keyof typeof METRIC_SORTS]
  const hasValue = and(metric.where, isNotNull(metric.value))
  if (total <= listingDrivenMetricSortLimit) {
    // Evaluated once per row: descending already puts nulls last, and
    // ascending replaces them with the largest integer.
    const value = sql<number>`(select ${metric.value} from ${metric.table} where ${and(eq(metric.domainName, auctionListings.domainName), metric.where)})`
    const order =
      filters.direction === 'desc' ? desc(value) : asc(sql`ifnull(${value}, 9223372036854775807)`)
    return listingPage(where, [order, ...tieBreak], slice)
  }
  // CROSS JOIN makes SQLite read the metric table first, in its index order.
  const joined = and(eq(auctionListings.domainName, metric.domainName), hasValue, where)
  return knownFirst(
    slice,
    ({ limit, offset }) =>
      database
        .select(listingSelection)
        .from(metric.table)
        .crossJoin(auctionListings)
        .where(joined)
        .orderBy(
          by(metric.value),
          by(metric.domainName),
          by(auctionListings.endsAt),
          by(listingRowid)
        )
        .limit(limit)
        .offset(offset),
    unknown =>
      listingPage(
        and(
          activeListingWhere(filters, now, 'domain'),
          notExists(
            database
              .select({ one: sql`1` })
              .from(metric.table)
              .where(and(eq(metric.domainName, auctionListings.domainName), hasValue))
          )
        ),
        tieBreak,
        unknown
      ),
    async () => {
      const [{ value }] = await database
        .select({ value: count() })
        .from(metric.table)
        .crossJoin(auctionListings)
        .where(joined)
      return value
    }
  )
}

export async function queryDomainListingsWithDatabase(
  filters: DomainTableFilters,
  database: AppDatabase,
  now = new Date(),
  // Tests lower it to run the index-driven metric sort on a few rows.
  listingDrivenMetricSortLimit = LISTING_DRIVEN_METRIC_SORT_LIMIT
): Promise<DomainListingsResult> {
  // Keep these reads sequential. Concurrent statements against Wrangler's
  // local SQLite-backed D1 can race snapshots and fail with SQLITE_BUSY; a
  // D1 batch runs its statements one after another in one round trip.
  const total = await countListings(database, activeListingWhere(filters, now))
  const lastPage = Math.max(1, Math.ceil(total / filters.pageSize))
  const page = Math.min(filters.page, lastPage)
  const rawRows =
    total === 0
      ? []
      : await queryPageRows(
          database,
          filters,
          now,
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
