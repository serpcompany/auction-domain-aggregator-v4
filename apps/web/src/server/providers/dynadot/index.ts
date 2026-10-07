import { z } from 'zod'

import {
  parseDomain,
  parseMoneyCents,
  parseNonnegativeInteger,
  ResponseTooLargeError,
  readBoundedBody
} from '../normalize'
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

export class DynadotProviderError extends ProviderError {
  declare readonly code: DynadotProviderErrorCode

  constructor(code: DynadotProviderErrorCode) {
    super(code)
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
  if (text === '' || text === '-') return true
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
      throw new DynadotProviderError('dynadot_network_error')
    }

    if (!response.ok) {
      throw new DynadotProviderError('dynadot_http_error')
    }

    let text: string
    try {
      text = await readBoundedBody(response, RESPONSE_BYTE_LIMIT)
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        throw new DynadotProviderError('dynadot_response_too_large')
      }
      if (signal.aborted) {
        throw new DynadotProviderError('dynadot_network_error')
      }
      throw new DynadotProviderError('dynadot_parse_error')
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new DynadotProviderError('dynadot_parse_error')
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

export function createDynadotAdapter({
  apiKey,
  fetchImpl
}: {
  apiKey: string
  fetchImpl?: typeof fetch
}): ProviderAdapter {
  return {
    provider: 'dynadot',
    async fetchPage({ pageIndex }) {
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
