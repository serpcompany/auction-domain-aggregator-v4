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

// Errors thrown by adapters carry a fixed, non-secret code prefixed with the
// provider name, e.g. `dynadot_http_error`. It is persisted on failed runs.
// `transient` marks a failure the same request may not repeat: a network
// failure, a rate limit, a server error, or a failed staged-page read. The
// Workflow retries those instead of failing the run.
export class ProviderError extends Error {
  readonly code: string
  readonly transient: boolean

  constructor(code: string, { transient = false }: { transient?: boolean } = {}) {
    super(code)
    this.name = 'ProviderError'
    this.code = code
    this.transient = transient
  }
}
