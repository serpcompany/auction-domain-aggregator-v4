import { z } from 'zod'

import { parseDomain, parseField, parseMoneyCents } from '../normalize'
import { isTransientStagedPageError, normalizeStagedRecords, readStagedPage } from '../staged-feed'
import {
  type FeedPageSource,
  type NormalizedListing,
  type NormalizedSeoMetrics,
  type ProviderAdapter,
  ProviderError,
  type ProviderErrorOptions,
  type ProviderPage
} from '../types'

// Namecheap publishes every open Namecheap Market sale as one public CSV
// (about 194 MB and 1.1 million rows in October 2026), refreshed hourly. The
// ingestion Workflow's stage step streams it into numbered page files of at
// most NAMECHEAP_PAGE_SIZE rows in R2, each row a JSON object of its
// non-empty fields as strings (`src/server/ingestion/feed-csv.ts`). This
// adapter reads those pages, like GoDaddy's.
export const NAMECHEAP_FEED_URL =
  'https://d3ry1h4w5036x1.cloudfront.net/reports/Namecheap_Market_Sales.csv'
// 2,000 rows keep the feed near 550 pages, inside the page cap with room to
// grow. A page is about 1 MB.
export const NAMECHEAP_PAGE_SIZE = 2000
export const NAMECHEAP_PAGE_BYTE_LIMIT = 10 * 1024 * 1024
export const NAMECHEAP_MAX_PAGES = 1000

const text = (max: number) => z.string().max(max)
const integer = z
  .string()
  .regex(/^\d{1,15}$/)
  .transform(Number)
const score = integer.pipe(z.number().max(100))
const money = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/)
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)

const namecheapRecordSchema = z
  .object({
    url: text(2048),
    name: text(253),
    startDate: timestamp.optional(),
    endDate: timestamp,
    price: money,
    renewPrice: money.optional(),
    bidCount: integer,
    estibotValue: money.optional(),
    registeredDate: timestamp.optional(),
    majesticTrustFlow: score.optional(),
    majesticCitation: score.optional(),
    majesticBacklinks: integer.optional(),
    semrushAScore: score.optional(),
    semrushBacklinks: integer.optional()
  })
  .passthrough()

type NamecheapRecord = z.infer<typeof namecheapRecordSchema>

export type NamecheapProviderErrorCode =
  | 'namecheap_invalid_request'
  | 'namecheap_page_read_error'
  | 'namecheap_missing_page'
  | 'namecheap_parse_error'
  | 'namecheap_response_too_large'
  | 'namecheap_response_error'
  | 'namecheap_too_many_rejected'

export class NamecheapProviderError extends ProviderError {
  declare readonly code: NamecheapProviderErrorCode

  constructor(code: NamecheapProviderErrorCode, options?: ProviderErrorOptions) {
    super(code, options)
    this.name = 'NamecheapProviderError'
  }
}

function parseTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('invalid_timestamp')
  return date
}

// The listing ID is the sale's path segment, for example
// `/market/sale/97WgbeLorYDjJu7h7XDcFv/`.
function parseSaleUrl(value: string) {
  const url = new URL(value)
  const match = /^\/market\/sale\/([A-Za-z0-9]{1,64})\/?$/.exec(url.pathname)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.namecheap.com' ||
    url.username !== '' ||
    url.password !== '' ||
    !match
  ) {
    throw new Error('invalid_url')
  }
  return { auctionUrl: url.toString(), externalId: match[1]! }
}

// Whole years from registration to the sale's start, so the value does not
// depend on when the feed is read. Null when either date is missing or the
// registration is reported after the start.
function ageYears(registered: Date | null, startsAt: Date | null) {
  if (!registered || !startsAt) return null
  let years = startsAt.getUTCFullYear() - registered.getUTCFullYear()
  const anniversary = new Date(registered)
  anniversary.setUTCFullYear(startsAt.getUTCFullYear())
  if (anniversary > startsAt) years -= 1
  return years >= 0 ? years : null
}

function seoMetrics(record: NamecheapRecord): NormalizedSeoMetrics | undefined {
  const metrics = {
    majesticTf: record.majesticTrustFlow ?? null,
    majesticCf: record.majesticCitation ?? null,
    majesticBacklinks: record.majesticBacklinks ?? null,
    majesticRefDomains: null,
    semrushAs: record.semrushAScore ?? null,
    semrushRefDomains: null,
    semrushBacklinks: record.semrushBacklinks ?? null
  }
  return Object.values(metrics).every(value => value === null) ? undefined : metrics
}

function normalizeRecord(record: NamecheapRecord): NormalizedListing {
  const { auctionUrl, externalId } = parseField('url', () => parseSaleUrl(record.url))
  const startsAt = parseField('startDate', () =>
    record.startDate ? parseTimestamp(record.startDate) : null
  )
  const registered = parseField('registeredDate', () =>
    record.registeredDate ? parseTimestamp(record.registeredDate) : null
  )
  const metrics = seoMetrics(record)

  return {
    provider: 'namecheap',
    externalId,
    domainName: parseField('name', () => parseDomain(record.name)),
    auctionUrl,
    // Every Namecheap Market sale is a timed auction.
    auctionType: 'AUCTION',
    currency: 'USD',
    currentBidCents: parseField('price', () => parseMoneyCents(record.price)),
    bidCount: record.bidCount,
    // The feed has no bidder count, visitors, or a generic link count.
    bidderCount: null,
    startsAt,
    endsAt: parseField('endDate', () => parseTimestamp(record.endDate)),
    ageYears: ageYears(registered, startsAt),
    inboundLinks: null,
    visitors: null,
    // Namecheap shows Estibot's valuation as the sale's appraisal.
    appraisalCents: parseField('estibotValue', () =>
      record.estibotValue === undefined ? null : parseMoneyCents(record.estibotValue)
    ),
    renewalPriceCents: parseField('renewPrice', () =>
      record.renewPrice === undefined ? null : parseMoneyCents(record.renewPrice)
    ),
    ...(metrics ? { seoMetrics: metrics } : {})
  }
}

export function normalizeNamecheapRecords(records: unknown[]): Omit<ProviderPage, 'isLastPage'> {
  return normalizeStagedRecords(
    records,
    record => normalizeRecord(namecheapRecordSchema.parse(record)),
    rejections => new NamecheapProviderError('namecheap_too_many_rejected', { rejections })
  )
}

export function createNamecheapAdapter({
  pages
}: {
  pages: FeedPageSource | undefined
}): ProviderAdapter {
  return {
    provider: 'namecheap',
    async fetchPage({ pageIndex }) {
      const page = await readStagedPage(
        pages,
        pageIndex,
        {
          pageSize: NAMECHEAP_PAGE_SIZE,
          maxPages: NAMECHEAP_MAX_PAGES,
          maxPageBytes: NAMECHEAP_PAGE_BYTE_LIMIT
        },
        code =>
          new NamecheapProviderError(`namecheap_${code}`, {
            transient: isTransientStagedPageError(code)
          })
      )
      return { ...normalizeNamecheapRecords(page.records), isLastPage: page.isLastPage }
    }
  }
}
