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
  like,
  lte,
  max,
  not,
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

export interface DomainListingsResult {
  rows: DomainListingRow[]
  total: number
  page: number
  sources: string[]
  auctionTypes: string[]
  tlds: string[]
  latestSuccessfulSync: Date | null
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
function openListingWhere(now: Date) {
  return and(eq(auctionListings.status, 'active'), gt(auctionListings.endsAt, now))!
}

function activeListingWhere(filters: DomainTableFilters, now: Date) {
  const conditions: SQL[] = [openListingWhere(now)]

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

type SortableExpression = AnyColumn | SQL<number>

// Metric sorts read the per-domain metric tables through their primary keys.
function seoMetric(column: AnyColumn) {
  return sql<number>`(select ${column} from ${domainSeoMetrics} where ${domainSeoMetrics.domainName} = ${auctionListings.domainName})`
}

// Ahrefs DR exists only for domains someone has viewed; the rest sort last.
const domainRating = sql<number>`(select ${domainMetrics.value} from ${domainMetrics} where ${domainMetrics.domainName} = ${auctionListings.domainName} and ${domainMetrics.metric} = 'ahrefs_dr')`

const NULL_BEARING_SORTS: ReadonlyArray<DomainTableFilters['sort']> = [
  'age',
  'links',
  'visitors',
  'appraisal',
  'renewal'
]
const METRIC_SORTS: ReadonlyArray<DomainTableFilters['sort']> = [
  'majesticTf',
  'majesticCf',
  'majesticRefDomains',
  'semrushAs',
  'domainRating'
]

function listingOrder(filters: DomainTableFilters) {
  const columns: Record<DomainTableFilters['sort'], SortableExpression> = {
    domain: auctionListings.domainName,
    source: auctionListings.provider,
    price: auctionListings.currentBidCents,
    bids: auctionListings.bidCount,
    endsAt: auctionListings.endsAt,
    age: auctionListings.ageYears,
    links: auctionListings.inboundLinks,
    visitors: auctionListings.visitors,
    appraisal: auctionListings.appraisalCents,
    renewal: auctionListings.renewalPriceCents,
    domainLength: auctionListings.domainLength,
    majesticTf: seoMetric(domainSeoMetrics.majesticTf),
    majesticCf: seoMetric(domainSeoMetrics.majesticCf),
    majesticRefDomains: seoMetric(domainSeoMetrics.majesticRefDomains),
    semrushAs: seoMetric(domainSeoMetrics.semrushAs),
    domainRating
  }
  const column = columns[filters.sort]
  const order = filters.direction === 'desc' ? desc : asc
  const nullBearing = NULL_BEARING_SORTS.includes(filters.sort)
  // A metric is a subquery per row, so it is evaluated once: SQLite already
  // puts nulls last when descending, and ascending replaces them with the
  // largest integer.
  const metricOrder = METRIC_SORTS.includes(filters.sort)
    ? filters.direction === 'desc'
      ? desc(column)
      : asc(sql`ifnull(${column}, 9223372036854775807)`)
    : undefined

  return [
    ...(nullBearing ? [asc(sql`${column} is null`)] : []),
    metricOrder ?? order(column),
    asc(auctionListings.domainName),
    asc(auctionListings.provider),
    asc(auctionListings.externalId)
  ]
}

export async function queryDomainListingsWithDatabase(
  filters: DomainTableFilters,
  database: AppDatabase,
  now = new Date()
): Promise<DomainListingsResult> {
  const where = activeListingWhere(filters, now)

  // Keep these reads sequential. Concurrent statements against Wrangler's
  // local SQLite-backed D1 can race snapshots and fail with SQLITE_BUSY.
  const totalRows = await database.select({ value: count() }).from(auctionListings).where(where)
  const total = totalRows[0]?.value ?? 0
  const lastPage = Math.max(1, Math.ceil(total / filters.pageSize))
  const page = Math.min(filters.page, lastPage)

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
      appraisalCents: auctionListings.appraisalCents,
      renewalPriceCents: auctionListings.renewalPriceCents,
      domainLength: auctionListings.domainLength,
      tld: auctionListings.tld,
      hasHyphen: sql<number>`instr(${auctionListings.domainName}, '-') > 0`,
      hasDigit: sql<number>`${auctionListings.domainName} glob '*[0-9]*'`
    })
    .from(auctionListings)
    .where(where)
    .orderBy(...listingOrder(filters))
    .limit(filters.pageSize)
    .offset((page - 1) * filters.pageSize)

  // Looked up only for the visible page, so it stays cheap on any filter.
  const pageDomains = [...new Set(rawRows.map(row => row.domainName))]
  const ratingRows =
    pageDomains.length === 0
      ? []
      : await database
          .select({
            domainName: domainMetrics.domainName,
            value: domainMetrics.value
          })
          .from(domainMetrics)
          .where(
            and(
              eq(domainMetrics.metric, 'ahrefs_dr'),
              inArray(domainMetrics.domainName, pageDomains)
            )
          )
  const ratings = new Map(ratingRows.map(({ domainName, value }) => [domainName, { value }]))
  const seoRows =
    pageDomains.length === 0
      ? []
      : await database
          .select()
          .from(domainSeoMetrics)
          .where(inArray(domainSeoMetrics.domainName, pageDomains))
  const seoMetrics = new Map(seoRows.map(({ domainName, ...metrics }) => [domainName, metrics]))

  const facets = await queryListingFacetsWithDatabase(database, now)

  const latestSyncRows = await database
    .select({ value: max(ingestionRuns.completedAt) })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.status, 'succeeded'))

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
    page,
    ...facets,
    latestSuccessfulSync: latestSyncRows[0]?.value ?? null
  }
}

export interface ListingFacets {
  sources: AuctionSource[]
  auctionTypes: AuctionType[]
  tlds: string[]
}

// Facets do not depend on the filters. They are rebuilt when a sync
// succeeds; a value stays offered while one of its auctions can be open.
export async function queryListingFacetsWithDatabase(
  database: AppDatabase,
  now = new Date()
): Promise<ListingFacets> {
  const facetRows = await database
    .select({ facet: listingFacets.facet, value: listingFacets.value })
    .from(listingFacets)
    .where(gt(listingFacets.latestEndsAt, now))
    .orderBy(asc(listingFacets.facet), asc(listingFacets.value))
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

export interface InventoryStatus extends ListingFacets {
  latestSuccessfulSync: Date | null
}

// What the page needs before the listing query finishes: the filter facets
// and the freshness of the inventory. Both reads are small.
export async function queryInventoryStatusWithDatabase(
  database: AppDatabase,
  now = new Date()
): Promise<InventoryStatus> {
  const facets = await queryListingFacetsWithDatabase(database, now)
  const latestSyncRows = await database
    .select({ value: max(ingestionRuns.completedAt) })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.status, 'succeeded'))
  return { ...facets, latestSuccessfulSync: latestSyncRows[0]?.value ?? null }
}
