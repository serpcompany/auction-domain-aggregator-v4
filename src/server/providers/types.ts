import type { AuctionSource } from '../../domain/domain-table';

export type AuctionProvider = AuctionSource;

// One auction listing, normalized at the provider boundary. Provider-specific
// response shapes never cross this type.
export type NormalizedListing = {
  provider: AuctionProvider;
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
  // The provider's own valuation of the domain, when it publishes one.
  appraisalCents: number | null;
  renewalPriceCents: number | null;
};

export type ProviderPage = {
  listings: NormalizedListing[];
  // Auctions in the provider response, including rejected ones.
  received: number;
  // Auctions skipped because they failed validation.
  rejected: number;
  // Decided by the adapter, from raw counts, so a skipped record cannot end
  // a run early.
  isLastPage: boolean;
};

export type ProviderAdapter = {
  provider: AuctionProvider;
  fetchPage(input: { pageIndex: number }): Promise<ProviderPage>;
};

// Errors thrown by adapters carry a fixed, non-secret code prefixed with the
// provider name, e.g. `dynadot_http_error`. It is persisted on failed runs.
export class ProviderError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
  }
}
