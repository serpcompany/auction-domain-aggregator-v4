import { z } from 'zod'

import {
  parseDomain,
  parseMoneyCents,
  parseNonnegativeInteger,
  ResponseTooLargeError,
  readBoundedBody
} from '../normalize'
import { type Pacer, parseRetryAfter, type RateLimit } from '../rate-limit'
import {
  type NormalizedListing,
  type ProviderAdapter,
  ProviderError,
  type ProviderPage
} from '../types'

const stringOrNumber = (maximumLength: number) =>
  z.union([z.string().max(maximumLength), z.number()])

const dynadotAuctionSchema = z
  .object({
    auction_id: stringOrNumber(256),
    domain: z.string().max(253),
    auction_type: stringOrNumber(32),
    currency: stringOrNumber(16),
    current_bid_price: stringOrNumber(64),
    bids: stringOrNumber(32),
    bidders: stringOrNumber(32),
    end_time_stamp: stringOrNumber(32),
    start_time_stamp: stringOrNumber(32).optional(),
    age: stringOrNumber(32).optional(),
    links: stringOrNumber(32).optional(),
    visitors: stringOrNumber(32).optional(),
    dyna_appraisal: stringOrNumber(64).optional(),
    renewal_price: stringOrNumber(64).optional()
  })
  .passthrough()

// Items are validated one at a time so a single malformed auction is skipped
// rather than failing the whole page.
const dynadotResponseSchema = z
  .object({
    status: z.literal('success'),
    auction_list: z.array(z.unknown()).max(1000)
  })
  .passthrough()

// Dynadot answers a failed command with HTTP 200 and a `Response` object,
// for example an over-limit request with `{"Response":{"ResponseCode":"-1",
// "Error":"Too many requests. Please try again in 1 minute after."}}`.
const errorResponseSchema = z.object({
  Response: z.object({
    ResponseCode: stringOrNumber(16),
    Error: z.string().max(1024).optional()
  })
})

// Wording that means "slow down", matched broadly so a reworded message is
// still retried. A bare "try again" is not enough: an invalid key's message
// could say that too.
const RATE_LIMITED_TEXT = /too many|rate.?limit|throttl|try again (?:in|later)/i
const RETRY_HINT = /try again in (\d+) (second|minute|hour)/i
const HINT_UNIT_MS = { second: 1_000, minute: 60_000, hour: 3_600_000 }

// The wait an error message asks for ("try again in 1 minute"), if any.
function retryHintMs(message: string) {
  const match = RETRY_HINT.exec(message)
  if (!match) return null
  const [, amount, unit] = match
  return Number(amount) * HINT_UNIT_MS[unit.toLowerCase() as keyof typeof HINT_UNIT_MS]
}

// An error answer is a rate limit when its wording says so. Any other error
// on page 1 is permanent: an invalid key or command fails the first request.
// After page 1 the key and command have worked, so an unrecognized error is
// most likely a limit worded differently, and is retried.
function errorResponse(message: string, pageIndex: number) {
  if (RATE_LIMITED_TEXT.test(message)) {
    return new DynadotProviderError('dynadot_rate_limited', {
      transient: true,
      retryAfterMs: retryHintMs(message)
    })
  }
  return new DynadotProviderError('dynadot_api_error', { transient: pageIndex > 1 })
}

// A page where more than this share of auctions is invalid indicates a
// response-format change rather than a few bad records.
const MAX_REJECTED_RATIO = 0.1

export type DynadotPage = Omit<ProviderPage, 'isLastPage'>

export type DynadotListing = NormalizedListing & { provider: 'dynadot' }

export type DynadotProviderErrorCode =
  | 'dynadot_invalid_request'
  | 'dynadot_network_error'
  | 'dynadot_http_error'
  | 'dynadot_parse_error'
  | 'dynadot_response_too_large'
  | 'dynadot_response_error'
  | 'dynadot_rate_limited'
  | 'dynadot_api_error'

export class DynadotProviderError extends ProviderError {
  declare readonly code: DynadotProviderErrorCode

  constructor(
    code: DynadotProviderErrorCode,
    options?: { transient?: boolean; retryAfterMs?: number | null }
  ) {
    super(code, options)
    this.name = 'DynadotProviderError'
  }
}

type FetchDynadotPageInput = {
  apiKey: string
  pageIndex: number
  pageSize: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

const RESPONSE_BYTE_LIMIT = 10 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

function parseRequiredString(value: string | number) {
  const parsed = String(value).trim()
  if (parsed.length === 0) throw new Error('invalid_string')
  return parsed
}

function isNullableSentinel(value: string | number | undefined) {
  if (value === undefined) return true
  const text = String(value).trim()
  // Dynadot writes a missing value as `-` and, for some renewal prices, `--`.
  if (/^-*$/.test(text)) return true
  const number = Number(text.replaceAll(',', '').replace(/^\$/, ''))
  return Number.isFinite(number) && number < 0
}

function parseNullableMoney(value: string | number | undefined) {
  return isNullableSentinel(value) ? null : parseMoneyCents(value!)
}

function parseNullableInteger(value: string | number | undefined) {
  return isNullableSentinel(value) ? null : parseNonnegativeInteger(value!)
}

function parseTimestamp(value: string | number) {
  const milliseconds = parseNonnegativeInteger(value)
  if (milliseconds <= 0) throw new Error('invalid_timestamp')
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) throw new Error('invalid_timestamp')
  return date
}

function parseNullableTimestamp(value: string | number | undefined) {
  return isNullableSentinel(value) ? null : parseTimestamp(value!)
}

function normalizeAuction(auction: z.infer<typeof dynadotAuctionSchema>): DynadotListing {
  const domainName = parseDomain(auction.domain)

  return {
    provider: 'dynadot',
    externalId: parseRequiredString(auction.auction_id),
    domainName,
    auctionUrl: `https://www.dynadot.com/market/auction/${encodeURIComponent(domainName)}`,
    auctionType: parseRequiredString(auction.auction_type).toUpperCase(),
    currency: parseRequiredString(auction.currency).toUpperCase(),
    currentBidCents: parseMoneyCents(auction.current_bid_price),
    bidCount: parseNonnegativeInteger(auction.bids),
    bidderCount: parseNonnegativeInteger(auction.bidders),
    startsAt: parseNullableTimestamp(auction.start_time_stamp),
    endsAt: parseTimestamp(auction.end_time_stamp),
    ageYears: parseNullableInteger(auction.age),
    inboundLinks: parseNullableInteger(auction.links),
    visitors: parseNullableInteger(auction.visitors),
    appraisalCents: parseNullableMoney(auction.dyna_appraisal),
    renewalPriceCents: parseNullableMoney(auction.renewal_price)
  }
}

function normalizePage(auctions: unknown[]): DynadotPage {
  const listings: DynadotListing[] = []
  for (const auction of auctions) {
    const parsed = dynadotAuctionSchema.safeParse(auction)
    if (!parsed.success) continue
    try {
      listings.push(normalizeAuction(parsed.data))
    } catch {
      // Counted as rejected below.
    }
  }
  const rejected = auctions.length - listings.length
  if (rejected > auctions.length * MAX_REJECTED_RATIO) {
    throw new Error('too_many_rejected_auctions')
  }
  return { listings, received: auctions.length, rejected }
}

export async function fetchDynadotPage({
  apiKey,
  pageIndex,
  pageSize,
  fetchImpl = fetch,
  signal: suppliedSignal
}: FetchDynadotPageInput): Promise<DynadotPage> {
  if (
    apiKey.length === 0 ||
    !Number.isSafeInteger(pageIndex) ||
    pageIndex < 1 ||
    pageIndex > 1000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 1000
  ) {
    throw new DynadotProviderError('dynadot_invalid_request')
  }

  const url = new URL('https://api.dynadot.com/api3.json')
  url.search = new URLSearchParams({
    key: apiKey,
    command: 'get_open_auctions',
    currency: 'usd',
    type: 'expired',
    count_per_page: String(pageSize),
    page_index: String(pageIndex)
  }).toString()

  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)
  const signal = suppliedSignal
    ? AbortSignal.any([suppliedSignal, timeoutController.signal])
    : timeoutController.signal
  try {
    let response: Response
    try {
      response = await fetchImpl(url, { signal })
    } catch {
      throw new DynadotProviderError('dynadot_network_error', { transient: true })
    }

    if (!response.ok) {
      // A rate limit or a server error may clear; other statuses will not.
      const { status } = response
      throw new DynadotProviderError('dynadot_http_error', {
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
        throw new DynadotProviderError('dynadot_response_too_large')
      }
      if (signal.aborted) {
        throw new DynadotProviderError('dynadot_network_error', { transient: true })
      }
      throw new DynadotProviderError('dynadot_parse_error')
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new DynadotProviderError('dynadot_parse_error')
    }
    const failed = errorResponseSchema.safeParse(body)
    if (failed.success) {
      throw errorResponse(failed.data.Response.Error ?? '', pageIndex)
    }

    try {
      const parsed = dynadotResponseSchema.parse(body)
      if (parsed.auction_list.length > pageSize) {
        throw new Error('page_size_exceeded')
      }
      return normalizePage(parsed.auction_list)
    } catch {
      throw new DynadotProviderError('dynadot_response_error')
    }
  } finally {
    clearTimeout(timeout)
  }
}

const DYNADOT_PAGE_SIZE = 1000
// A regular Dynadot account may make 60 requests a minute. Back-to-back page
// requests reached about 120 and were rate-limited partway through a sync,
// so pages are requested at most once per 1.1 seconds.
export const DYNADOT_RATE_LIMIT: RateLimit = {
  intervalMs: 1_100,
  source: 'Dynadot API commands page: regular accounts 60 requests a minute'
}

export function createDynadotAdapter({
  apiKey,
  pacer,
  fetchImpl
}: {
  apiKey: string
  // Enforces DYNADOT_RATE_LIMIT; awaited before every request.
  pacer: Pacer
  fetchImpl?: typeof fetch
}): ProviderAdapter {
  return {
    provider: 'dynadot',
    async fetchPage({ pageIndex }) {
      await pacer()
      const page = await fetchDynadotPage({
        apiKey,
        pageIndex,
        pageSize: DYNADOT_PAGE_SIZE,
        fetchImpl
      })
      // Dynadot has no total count; the first short page is the last one.
      return { ...page, isLastPage: page.received < DYNADOT_PAGE_SIZE }
    }
  }
}
