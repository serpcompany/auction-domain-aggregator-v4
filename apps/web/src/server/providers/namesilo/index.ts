import { z } from 'zod'

import {
  normalizeRecords,
  parseDomain,
  parseField,
  parseMoneyCents,
  parseNonnegativeInteger,
  ResponseTooLargeError,
  readBoundedBody,
  wholeYearsBetween
} from '../normalize'
import { DEFAULT_RATE_LIMIT, type Pacer, parseRetryAfter, type RateLimit } from '../rate-limit'
import {
  INGESTION_USER_AGENT,
  type NormalizedListing,
  type ProviderAdapter,
  ProviderError,
  type ProviderErrorOptions,
  type ProviderPage
} from '../types'

// NameSilo's `listAuctions` API operation, on the `/public/apibatch/` path
// that NameSilo's batch policy requires for automated calls. It has no total
// count: a page past the end answers success with an empty body.
const ENDPOINT = 'https://www.namesilo.com/public/apibatch/listAuctions'
// NameSilo rejects a larger page size (reply code 210).
export const NAMESILO_PAGE_SIZE = 500
// Customer auctions are a few thousand; this many pages is 20,000.
export const NAMESILO_MAX_CUSTOMER_PAGES = 40
const MAX_PAGE_INDEX = 1000
const SUCCESS_CODE = 300
// A deep page is about 224 KB and takes about 2.5 seconds.
const RESPONSE_BYTE_LIMIT = 10 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

// NameSilo publishes no rate limit.
export const NAMESILO_RATE_LIMIT: RateLimit = DEFAULT_RATE_LIMIT

// The two auction kinds synced, by NameSilo type and active status. Type 2
// (offers and counter-offers) is not an auction and is never requested.
const CUSTOMER = { typeId: 1, statusId: 9 } as const
const EXPIRED = { typeId: 3, statusId: 2 } as const
type AuctionKind = typeof CUSTOMER | typeof EXPIRED

const AUCTION_TYPES = { 1: 'AUCTION', 3: 'EXPIRED' } as const

const amount = z.union([z.number(), z.string().max(32)])
const dateTime = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/

const namesiloAuctionSchema = z
  .object({
    id: z.number().int().nonnegative(),
    domain: z.string().max(253),
    typeId: z.union([z.literal(1), z.literal(3)]),
    openingBid: amount,
    currentBid: amount,
    hasBids: z.union([z.boolean(), z.number(), z.string().max(8)]).nullish(),
    bidsQuantity: amount,
    domainCreatedOn: z.string().max(32).nullish(),
    auctionEndsOnUtc: z.string().max(32),
    url: z.string().max(2048),
    visits: amount.nullish()
  })
  .passthrough()

type NamesiloAuction = z.infer<typeof namesiloAuctionSchema>

// Records are validated one at a time, so a single malformed auction is
// skipped rather than failing the page.
const replySchema = z.object({
  reply: z
    .object({
      code: z.union([z.number(), z.string().max(16)]),
      body: z.unknown().optional()
    })
    .passthrough()
})

export type NamesiloProviderErrorCode =
  | 'namesilo_invalid_request'
  | 'namesilo_network_error'
  | 'namesilo_http_error'
  | 'namesilo_parse_error'
  | 'namesilo_response_too_large'
  | 'namesilo_response_error'
  | 'namesilo_api_error'
  | 'namesilo_customer_page_limit'
  | 'namesilo_too_many_rejected'

export class NamesiloProviderError extends ProviderError {
  declare readonly code: NamesiloProviderErrorCode

  constructor(code: NamesiloProviderErrorCode, options?: ProviderErrorOptions) {
    super(code, options)
    this.name = 'NamesiloProviderError'
  }
}

// "YYYY-MM-DD HH:MM:SS" (or a bare date) read as UTC. A date that does not
// exist, such as February 30, is rejected rather than rolled over.
function parseDateTime(value: string) {
  const match = dateTime.exec(value.trim())
  if (!match) throw new Error('invalid_timestamp')
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map(part => Number(part ?? 0)) as [number, number, number, number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw new Error('invalid_timestamp')
  }
  return date
}

// Missing, empty, and the all-zero date mean "not known".
function parseCreatedOn(value: string | null | undefined) {
  if (!value?.trim() || /^0000-00-00/.test(value.trim())) return null
  return parseDateTime(value)
}

function parseAuctionUrl(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.namesilo.com' ||
    url.username !== '' ||
    url.password !== '' ||
    !/^\/auctions\/[^/]+\/?$/.test(url.pathname)
  ) {
    throw new Error('invalid_url')
  }
  return url.toString()
}

function hasBids(value: NamesiloAuction['hasBids']) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

// The current bid once someone has bid, otherwise the opening bid. `maxBid`
// is NameSilo's price cap for an expired auction, not a bid, and is unused.
function priceCents(auction: NamesiloAuction) {
  const currentBid = parseField('currentBid', () => parseMoneyCents(auction.currentBid))
  if (hasBids(auction.hasBids) || currentBid > 0) return currentBid
  return parseField('openingBid', () => parseMoneyCents(auction.openingBid))
}

function normalizeAuction(auction: NamesiloAuction): NormalizedListing {
  const endsAt = parseField('auctionEndsOnUtc', () => parseDateTime(auction.auctionEndsOnUtc))
  const createdOn = parseField('domainCreatedOn', () => parseCreatedOn(auction.domainCreatedOn))

  return {
    provider: 'namesilo',
    externalId: String(auction.id),
    domainName: parseField('domain', () => parseDomain(auction.domain)),
    auctionUrl: parseField('url', () => parseAuctionUrl(auction.url)),
    auctionType: AUCTION_TYPES[auction.typeId],
    currency: 'USD',
    currentBidCents: priceCents(auction),
    bidCount: parseField('bidsQuantity', () => parseNonnegativeInteger(auction.bidsQuantity)),
    // NameSilo publishes no bidder count, start time, links, or valuation.
    bidderCount: null,
    startsAt: null,
    endsAt,
    // Measured to the auction's end, so it does not depend on the read time.
    ageYears: wholeYearsBetween(createdOn, endsAt),
    inboundLinks: null,
    visitors: parseField('visits', () =>
      auction.visits === null || auction.visits === undefined
        ? null
        : parseNonnegativeInteger(auction.visits)
    ),
    appraisalCents: null,
    renewalPriceCents: null
  }
}

function normalizeAuctions(auctions: unknown[]) {
  return normalizeRecords(
    auctions,
    auction => normalizeAuction(namesiloAuctionSchema.parse(auction)),
    rejections => new NamesiloProviderError('namesilo_too_many_rejected', { rejections })
  )
}

type RequestAuctionsInput = {
  apiKey: string
  kind: AuctionKind
  page: number
  // The run's first request, where an error answer most likely means a bad
  // key and is not retried.
  firstRequest: boolean
  fetchImpl: typeof fetch
}

// One `listAuctions` page of raw records. Errors are fixed codes that never
// carry the key or the request URL.
async function requestAuctions({
  apiKey,
  kind,
  page,
  firstRequest,
  fetchImpl
}: RequestAuctionsInput): Promise<unknown[]> {
  const url = new URL(ENDPOINT)
  url.search = new URLSearchParams({
    version: '1',
    type: 'json',
    key: apiKey,
    typeId: String(kind.typeId),
    statusId: String(kind.statusId),
    page: String(page),
    pageSize: String(NAMESILO_PAGE_SIZE)
  }).toString()

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await fetchImpl(url, {
        headers: { 'user-agent': INGESTION_USER_AGENT },
        signal: timeout.signal
      })
    } catch {
      throw new NamesiloProviderError('namesilo_network_error', { transient: true })
    }

    if (!response.ok) {
      const { status } = response
      // Workers Logs shows why, including a Cloudflare block or challenge in
      // front of NameSilo. The URL carries the key and is never logged.
      console.warn('namesilo_http_error', {
        status,
        server: response.headers.get('server'),
        cfMitigated: response.headers.get('cf-mitigated')
      })
      // A rate limit or a server error may clear; other statuses will not.
      throw new NamesiloProviderError('namesilo_http_error', {
        transient: status === 429 || status >= 500,
        retryAfterMs:
          status === 429 || status === 503
            ? parseRetryAfter(response.headers.get('retry-after'))
            : null
      })
    }

    let text: string
    try {
      text = await readBoundedBody(response, RESPONSE_BYTE_LIMIT)
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        throw new NamesiloProviderError('namesilo_response_too_large')
      }
      // The body stopped partway: a timeout or a dropped connection.
      throw new NamesiloProviderError('namesilo_network_error', { transient: true })
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new NamesiloProviderError('namesilo_parse_error')
    }
    const parsed = replySchema.safeParse(body)
    if (!parsed.success) throw new NamesiloProviderError('namesilo_response_error')
    const { code, body: auctions } = parsed.data.reply
    // Any other reply code is an error answer. On the run's first request it
    // is most likely an invalid key, so it is final. After that the key has
    // worked, so it is most likely a limit or an outage, and is retried.
    if (Number(code) !== SUCCESS_CODE) {
      throw new NamesiloProviderError('namesilo_api_error', { transient: !firstRequest })
    }
    if (!Array.isArray(auctions) || auctions.length > NAMESILO_PAGE_SIZE) {
      throw new NamesiloProviderError('namesilo_response_error')
    }
    return auctions
  } finally {
    clearTimeout(timer)
  }
}

function addPage(total: Omit<ProviderPage, 'isLastPage'>, page: Omit<ProviderPage, 'isLastPage'>) {
  total.listings.push(...page.listings)
  total.received += page.received
  total.rejected += page.rejected
}

// Sync page 1 is every customer auction, paged internally until a short
// page; sync page n is expired-auction page n - 1, and the first short one is
// the last page. Every request waits for the pacer first.
export function createNamesiloAdapter({
  apiKey,
  pacer,
  fetchImpl = fetch
}: {
  apiKey: string
  // Enforces NAMESILO_RATE_LIMIT; awaited before every request.
  pacer: Pacer
  fetchImpl?: typeof fetch
}): ProviderAdapter {
  const request = async (kind: AuctionKind, page: number, firstRequest = false) => {
    await pacer()
    return requestAuctions({ apiKey, kind, page, firstRequest, fetchImpl })
  }

  return {
    provider: 'namesilo',
    async fetchPage({ pageIndex }) {
      if (
        apiKey.length === 0 ||
        !Number.isSafeInteger(pageIndex) ||
        pageIndex < 1 ||
        pageIndex > MAX_PAGE_INDEX
      ) {
        throw new NamesiloProviderError('namesilo_invalid_request')
      }

      if (pageIndex > 1) {
        const auctions = await request(EXPIRED, pageIndex - 1)
        return {
          ...normalizeAuctions(auctions),
          isLastPage: auctions.length < NAMESILO_PAGE_SIZE
        }
      }

      const customer: Omit<ProviderPage, 'isLastPage'> = { listings: [], received: 0, rejected: 0 }
      for (let page = 1; page <= NAMESILO_MAX_CUSTOMER_PAGES; page += 1) {
        const auctions = await request(CUSTOMER, page, page === 1)
        addPage(customer, normalizeAuctions(auctions))
        if (auctions.length < NAMESILO_PAGE_SIZE) return { ...customer, isLastPage: false }
      }
      // Far more customer auctions than NameSilo has listed: page 1 holds
      // them all, so it fails rather than growing without bound.
      throw new NamesiloProviderError('namesilo_customer_page_limit')
    }
  }
}
