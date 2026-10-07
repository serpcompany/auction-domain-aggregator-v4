import type { AuctionSource } from '../../domain/domain-table'

export type AuctionProvider = AuctionSource

// One auction listing, normalized at the provider boundary. Provider-specific
// response shapes never cross this type.
export type NormalizedListing = {
  provider: AuctionProvider
  externalId: string
  domainName: string
  auctionUrl: string
  auctionType: string
  currency: string
  currentBidCents: number
  bidCount: number
  // Null when the provider does not publish a bidder count.
  bidderCount: number | null
  startsAt: Date | null
  endsAt: Date
  ageYears: number | null
  inboundLinks: number | null
  visitors: number | null
  // The provider's own valuation of the domain, when it publishes one.
  appraisalCents: number | null
  renewalPriceCents: number | null
  // Domain-level SEO metrics carried by the provider's feed. Absent when the
  // provider publishes none, which leaves any stored metrics untouched.
  seoMetrics?: NormalizedSeoMetrics
}

// Third-party metrics for the listing's domain, as the provider reports them.
// Each value is null when the provider omits it.
export type NormalizedSeoMetrics = {
  majesticTf: number | null
  majesticCf: number | null
  majesticBacklinks: number | null
  majesticRefDomains: number | null
  semrushAs: number | null
  semrushRefDomains: number | null
  semrushBacklinks: number | null
}

export type ProviderPage = {
  listings: NormalizedListing[]
  // Auctions in the provider response, including rejected ones.
  received: number
  // Auctions skipped because they failed validation.
  rejected: number
  // Decided by the adapter, from raw counts, so a skipped record cannot end
  // a run early.
  isLastPage: boolean
}

export type ProviderAdapter = {
  provider: AuctionProvider
  fetchPage(input: { pageIndex: number }): Promise<ProviderPage>
}

// Raw page files staged from a provider's file feed (R2 in the ingestion
// Worker). Each page is JSON: `{ page, isLastPage, records: [...] }`.
export type FeedPageSource = {
  // Resolves with the page body, or null when the page does not exist.
  // Rejects with `ResponseTooLargeError` above `maxBytes`.
  readPage(page: number, maxBytes: number): Promise<string | null>
}

// Why the records of a page were rejected, counted per reason. A reason is
// `<field>: <code>`, for example `renewal_price: invalid_decimal`.
export type RejectionReasons = Record<string, number>

// Sent on every provider request: a Worker's fetch sends no User-Agent by
// default, and some providers' CDNs reject a request without one.
export const INGESTION_USER_AGENT = 'auction-domain-aggregator-ingestion/1'

export type ProviderErrorOptions = {
  transient?: boolean
  retryAfterMs?: number | null
  rejections?: RejectionReasons | null
}

// Errors thrown by adapters carry a fixed, non-secret code prefixed with the
// provider name, e.g. `dynadot_http_error`. It is persisted on failed runs.
// `transient` marks a failure the same request may not repeat: a network
// failure, a rate limit, a server error, or a failed staged-page read. The
// Workflow retries those instead of failing the run. `retryAfterMs` is how
// long the provider asked to wait (`Retry-After`, or a hint in the body); the
// retry waits at least that long. `rejections` explains a page that failed
// the rejection threshold, and is stored on the failed run.
export class ProviderError extends Error {
  readonly code: string
  readonly transient: boolean
  readonly retryAfterMs: number | null
  readonly rejections: RejectionReasons | null

  constructor(
    code: string,
    { transient = false, retryAfterMs = null, rejections = null }: ProviderErrorOptions = {}
  ) {
    super(code)
    this.name = 'ProviderError'
    this.code = code
    this.transient = transient
    this.retryAfterMs = retryAfterMs
    this.rejections = rejections
  }
}
