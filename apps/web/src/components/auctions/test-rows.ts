import type { DomainListingRow } from '@/server/queries/domain-listings'

// Invented rows for component tests: one with every value, one with none.
export const now = new Date('2026-07-13T10:00:00.000Z')

export const fullRow: DomainListingRow = {
  provider: 'dynadot',
  externalId: 'auction-1',
  domainName: 'garden-example.com',
  auctionUrl: 'https://www.dynadot.com/market/auction/garden-example.com',
  auctionType: 'EXPIRED',
  currency: 'USD',
  currentBidCents: 1250,
  bidCount: 3,
  bidderCount: 2,
  startsAt: null,
  endsAt: new Date('2026-07-13T10:30:00.000Z'),
  ageYears: 12,
  inboundLinks: 1500,
  visitors: 20,
  appraisalCents: 200000,
  renewalPriceCents: 1088,
  domainLength: 18,
  tld: 'com',
  hasHyphen: true,
  hasDigit: false,
  domainRating: 42.4,
  domainRatingFetched: true,
  seoMetrics: {
    source: 'godaddy',
    majesticTf: 12,
    majesticCf: 15,
    majesticBacklinks: 40,
    majesticRefDomains: 28,
    semrushAs: 33,
    semrushRefDomains: 9,
    semrushBacklinks: 50,
    updatedAt: new Date('2026-07-12T00:00:00.000Z')
  }
}

export const emptyRow: DomainListingRow = {
  provider: 'godaddy',
  externalId: 'auction-2',
  domainName: 'fresh2example.net',
  auctionUrl: 'https://auctions.godaddy.com/auction-2',
  auctionType: 'auction',
  currency: 'USD',
  currentBidCents: 999,
  bidCount: 1,
  bidderCount: null,
  startsAt: null,
  endsAt: new Date('2026-07-15T12:00:00.000Z'),
  ageYears: null,
  inboundLinks: null,
  visitors: null,
  appraisalCents: null,
  renewalPriceCents: null,
  domainLength: 17,
  tld: 'net',
  hasHyphen: false,
  hasDigit: true,
  domainRating: null,
  domainRatingFetched: false,
  seoMetrics: null
}
