import { describe, expect, it, vi } from 'vitest'

import { ResponseTooLargeError } from '../normalize'
import { type FeedProviderRegistration, PROVIDER_REGISTRY } from '../registry'
import { createGodaddyAdapter, GodaddyProviderError, normalizeGodaddyRecords } from './index'

// Invented record in the shape of GoDaddy's public inventory feed.
const record = {
  domainName: 'Example-Garden.ORG',
  link: 'https://www.godaddy.com/domain-auctions/example-garden-org-728418303?isc=json_biddable',
  auctionType: 'Bid',
  auctionEndTime: '2026-10-05T16:00:00Z',
  price: '$1,234',
  numberOfBids: 4,
  domainAge: 4,
  pageviews: 12,
  valuation: '$9,999',
  monthlyParkingRevenue: '$0',
  isAdult: false,
  majesticTf: 7,
  majesticCf: 12,
  majesticBacklinks: 300,
  majesticReferringDomains: 21,
  exactMatchTlds: 2,
  semrushAs: 3,
  semrushReferringDomains: 188,
  semrushBacklinks: 262,
  semrushTopReferringDomains: 'a.example, b.example',
  semrushCpc: 0.1
}

type PageOutcome = string | null | Error

// A page source that answers each page number from `pages`.
function adapterFor(pages: Record<number, PageOutcome>) {
  const readPage = vi.fn(async (page: number) => {
    const outcome = pages[page]
    if (outcome instanceof Error) throw outcome
    return outcome ?? null
  })
  return { readPage, adapter: createGodaddyAdapter({ pages: { readPage } }) }
}

function pageText(body: unknown) {
  return JSON.stringify(body)
}

describe('GoDaddy record normalization', () => {
  it('normalizes a bid auction with its feed metrics', () => {
    const page = normalizeGodaddyRecords([record])
    expect(page).toEqual({
      received: 1,
      rejected: 0,
      listings: [
        {
          provider: 'godaddy',
          externalId: '728418303',
          domainName: 'example-garden.org',
          auctionUrl:
            'https://www.godaddy.com/domain-auctions/example-garden-org-728418303?isc=json_biddable',
          auctionType: 'AUCTION',
          currency: 'USD',
          currentBidCents: 123_400,
          bidCount: 4,
          bidderCount: null,
          startsAt: null,
          endsAt: new Date('2026-10-05T16:00:00.000Z'),
          ageYears: 4,
          inboundLinks: null,
          visitors: 12,
          appraisalCents: 999_900,
          renewalPriceCents: null,
          seoMetrics: {
            majesticTf: 7,
            majesticCf: 12,
            majesticBacklinks: 300,
            majesticRefDomains: 21,
            semrushAs: 3,
            semrushRefDomains: 188,
            semrushBacklinks: 262
          }
        }
      ]
    })
  })

  it('keeps buy-now listings and treats missing optional fields as unknown', () => {
    const [listing] = normalizeGodaddyRecords([
      {
        domainName: 'bücher.example',
        link: 'https://www.godaddy.com/domain-auctions/xn--bcher-kva-example-55',
        auctionType: 'BuyNow',
        auctionEndTime: '2026-10-05T16:00:00.250Z',
        price: 25,
        domainAge: null,
        majesticTf: 0
      }
    ]).listings
    expect(listing).toMatchObject({
      externalId: '55',
      domainName: 'xn--bcher-kva.example',
      auctionType: 'BUY_NOW',
      currentBidCents: 2500,
      bidCount: 0,
      ageYears: null,
      visitors: null,
      appraisalCents: null,
      seoMetrics: {
        majesticTf: 0,
        majesticCf: null,
        semrushAs: null
      }
    })

    const [withoutMetrics] = normalizeGodaddyRecords([
      {
        domainName: 'plain.example',
        link: 'https://www.godaddy.com/domain-auctions/plain-example-56',
        auctionType: 'Bid',
        auctionEndTime: '2026-10-05T16:00:00Z',
        price: '$1',
        numberOfBids: 0
      }
    ]).listings
    expect(withoutMetrics).not.toHaveProperty('seoMetrics')
  })

  it('counts each invalid record as rejected', () => {
    const invalid = [
      { ...record, auctionType: 'Offer' },
      { ...record, numberOfBids: undefined },
      { ...record, link: 'not a url' },
      { ...record, link: 'http://www.godaddy.com/domain-auctions/a-com-1' },
      { ...record, link: 'https://evil.example/domain-auctions/a-com-1' },
      { ...record, link: 'https://u:p@www.godaddy.com/domain-auctions/a-1' },
      { ...record, link: 'https://www.godaddy.com/domain-auctions/no-id' },
      { ...record, auctionEndTime: '2026-10-05 16:00' },
      { ...record, auctionEndTime: '2026-13-45T16:00:00Z' },
      { ...record, price: 'free' },
      { ...record, majesticTf: 101 },
      { ...record, semrushBacklinks: -1 },
      { ...record, domainName: 'no-dot' },
      'not an object'
    ]
    const valid = Array.from({ length: 130 }, (_, index) => ({
      ...record,
      link: `https://www.godaddy.com/domain-auctions/example-${index + 1}`
    }))
    const page = normalizeGodaddyRecords([...valid, ...invalid])
    expect(page.received).toBe(valid.length + invalid.length)
    expect(page.rejected).toBe(invalid.length)
    expect(page.listings).toHaveLength(valid.length)
  })

  it('fails a page where more than a tenth of the records are invalid, naming the fields', () => {
    let caught: unknown
    try {
      normalizeGodaddyRecords([
        record,
        { ...record, price: 'x' },
        { ...record, price: '1.001' },
        { ...record, link: 'not a url' },
        { ...record, auctionType: 'Other' },
        { ...record, numberOfBids: undefined }
      ])
    } catch (error) {
      caught = error
    }
    expect(caught).toEqual(
      new GodaddyProviderError('godaddy_too_many_rejected', {
        rejections: {
          'price: invalid_decimal': 2,
          // The URL parser's own message is not kept.
          'link: invalid': 1,
          'auctionType: invalid_value': 1,
          'numberOfBids: missing': 1
        }
      })
    )
  })
})

describe('GoDaddy adapter', () => {
  it('reads numbered staged pages and reports the marked last page', async () => {
    const { adapter, readPage } = adapterFor({
      1: pageText({ page: 1, isLastPage: false, records: [record] }),
      2: pageText({ page: 2, isLastPage: true, records: [record] })
    })
    expect(adapter.provider).toBe('godaddy')
    await expect(adapter.fetchPage({ pageIndex: 1 })).resolves.toMatchObject({
      received: 1,
      rejected: 0,
      isLastPage: false
    })
    await expect(adapter.fetchPage({ pageIndex: 2 })).resolves.toMatchObject({
      isLastPage: true
    })
    expect(readPage).toHaveBeenLastCalledWith(2, 10 * 1024 * 1024)
  })

  it('is built by the registry from the staged page source', async () => {
    const registration = PROVIDER_REGISTRY.godaddy as FeedProviderRegistration
    expect(registration.rateLimit).toBe('one download per run')
    expect(registration.fileFeed).toMatchObject({
      field: 'data',
      pageSize: 1000
    })
    const withoutPages = registration.createAdapter({ secrets: {} })
    await expect(withoutPages.fetchPage({ pageIndex: 1 })).rejects.toThrow(
      new GodaddyProviderError('godaddy_invalid_request')
    )
    const readPage = vi.fn(async () => pageText({ page: 1, isLastPage: true, records: [] }))
    const adapter = registration.createAdapter({
      secrets: {},
      feedPages: { readPage }
    })
    await expect(adapter.fetchPage({ pageIndex: 1 })).resolves.toMatchObject({
      received: 0,
      isLastPage: true
    })
  })

  it('rejects invalid requests without reading', async () => {
    const { adapter, readPage } = adapterFor({})
    for (const pageIndex of [0, 1001, 1.5]) {
      await expect(adapter.fetchPage({ pageIndex })).rejects.toThrow(
        new GodaddyProviderError('godaddy_invalid_request')
      )
    }
    expect(readPage).not.toHaveBeenCalled()
  })

  it('maps read and envelope failures to fixed codes', async () => {
    const cases: [PageOutcome, string][] = [
      [new Error('R2 unavailable'), 'godaddy_page_read_error'],
      [new ResponseTooLargeError(), 'godaddy_response_too_large'],
      [null, 'godaddy_missing_page'],
      ['{', 'godaddy_parse_error'],
      ['', 'godaddy_parse_error'],
      [pageText({ page: 2, isLastPage: true, records: [] }), 'godaddy_response_error'],
      [pageText({ page: 1, isLastPage: true, records: [], extra: 1 }), 'godaddy_response_error'],
      [
        pageText({
          page: 1,
          isLastPage: true,
          records: Array.from({ length: 1001 }, () => record)
        }),
        'godaddy_response_error'
      ]
    ]
    for (const [outcome, code] of cases) {
      const { adapter } = adapterFor({ 1: outcome })
      await expect(adapter.fetchPage({ pageIndex: 1 })).rejects.toThrow(
        new GodaddyProviderError(code as never, { transient: code === 'godaddy_page_read_error' })
      )
    }
  })
})
