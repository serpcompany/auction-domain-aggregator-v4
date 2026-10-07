import { describe, expect, it, vi } from 'vitest'

import { ResponseTooLargeError } from '../normalize'
import { type FeedProviderRegistration, PROVIDER_REGISTRY } from '../registry'
import { createNamecheapAdapter, NamecheapProviderError, normalizeNamecheapRecords } from './index'

// Invented row in the shape of Namecheap's market sales CSV, as staged: the
// non-empty fields as strings.
const record = {
  url: 'https://www.namecheap.com/market/sale/AbC123xyz/',
  name: 'Example-Garden.ORG',
  startDate: '2026-09-29T23:30:00Z',
  endDate: '2026-10-11T15:00:00Z',
  price: '4750.00',
  startPrice: '15.00',
  renewPrice: '229.96',
  bidCount: '27',
  ahrefsDomainRating: '12',
  estibotValue: '1000.00',
  extensionsTaken: '63',
  registeredDate: '2020-09-30T00:00:00Z',
  isPartnerSale: '1',
  semrushAScore: '16',
  majesticCitation: '12',
  ahrefsBacklinks: '1932',
  semrushBacklinks: '6471',
  majesticBacklinks: '142',
  majesticTrustFlow: '1'
}

type PageOutcome = string | null | Error

function adapterFor(pages: Record<number, PageOutcome>) {
  const readPage = vi.fn(async (page: number) => {
    const outcome = pages[page]
    if (outcome instanceof Error) throw outcome
    return outcome ?? null
  })
  return { readPage, adapter: createNamecheapAdapter({ pages: { readPage } }) }
}

describe('Namecheap record normalization', () => {
  it('normalizes a sale with its feed metrics', () => {
    expect(normalizeNamecheapRecords([record])).toEqual({
      received: 1,
      rejected: 0,
      listings: [
        {
          provider: 'namecheap',
          externalId: 'AbC123xyz',
          domainName: 'example-garden.org',
          auctionUrl: 'https://www.namecheap.com/market/sale/AbC123xyz/',
          auctionType: 'AUCTION',
          currency: 'USD',
          currentBidCents: 475_000,
          bidCount: 27,
          bidderCount: null,
          startsAt: new Date('2026-09-29T23:30:00.000Z'),
          endsAt: new Date('2026-10-11T15:00:00.000Z'),
          // Registered one day short of six years before the sale started.
          ageYears: 5,
          inboundLinks: null,
          visitors: null,
          appraisalCents: 100_000,
          renewalPriceCents: 22_996,
          seoMetrics: {
            majesticTf: 1,
            majesticCf: 12,
            majesticBacklinks: 142,
            majesticRefDomains: null,
            semrushAs: 16,
            semrushRefDomains: null,
            semrushBacklinks: 6471
          }
        }
      ]
    })
  })

  it('treats missing optional fields as unknown', () => {
    const [listing] = normalizeNamecheapRecords([
      {
        url: 'https://www.namecheap.com/market/sale/Plain1',
        name: 'plain.example',
        endDate: '2026-10-11T15:00:00.500Z',
        price: '1',
        bidCount: '0',
        registeredDate: '2020-01-01T00:00:00Z'
      }
    ]).listings
    expect(listing).toEqual({
      provider: 'namecheap',
      externalId: 'Plain1',
      domainName: 'plain.example',
      auctionUrl: 'https://www.namecheap.com/market/sale/Plain1',
      auctionType: 'AUCTION',
      currency: 'USD',
      currentBidCents: 100,
      bidCount: 0,
      bidderCount: null,
      startsAt: null,
      endsAt: new Date('2026-10-11T15:00:00.500Z'),
      ageYears: null,
      inboundLinks: null,
      visitors: null,
      appraisalCents: null,
      renewalPriceCents: null
    })
  })

  it('counts whole years to the start, and no age for a registration after it', () => {
    const age = (registeredDate: string) =>
      normalizeNamecheapRecords([{ ...record, registeredDate }]).listings[0]!.ageYears
    expect(age('2020-09-29T23:30:00Z')).toBe(6)
    expect(age('2026-09-01T00:00:00Z')).toBe(0)
    expect(age('2026-09-30T00:00:00Z')).toBeNull()
  })

  it('counts each invalid record as rejected', () => {
    const invalid = [
      { ...record, url: 'not a url' },
      { ...record, url: 'http://www.namecheap.com/market/sale/a1/' },
      { ...record, url: 'https://evil.example/market/sale/a1/' },
      { ...record, url: 'https://u:p@www.namecheap.com/market/sale/a1/' },
      { ...record, url: 'https://www.namecheap.com/market/sale/a-1/' },
      { ...record, endDate: '2026-10-11 15:00' },
      { ...record, endDate: '2026-13-45T15:00:00Z' },
      { ...record, startDate: '2026-02-30T25:00:00Z' },
      { ...record, price: '$5' },
      { ...record, price: '1.234' },
      { ...record, bidCount: '-1' },
      { ...record, bidCount: undefined },
      { ...record, majesticTrustFlow: '101' },
      { ...record, semrushBacklinks: '1e3' },
      { ...record, name: 'no-dot' },
      'not an object'
    ]
    const valid = Array.from({ length: 150 }, (_, index) => ({
      ...record,
      url: `https://www.namecheap.com/market/sale/Valid${index}/`
    }))
    const page = normalizeNamecheapRecords([...valid, ...invalid])
    expect(page.received).toBe(valid.length + invalid.length)
    expect(page.rejected).toBe(invalid.length)
    expect(page.listings).toHaveLength(valid.length)
  })

  it('fails a page where more than a tenth of the records are invalid, naming the fields', () => {
    let caught: unknown
    try {
      normalizeNamecheapRecords([record, record, { ...record, renewPrice: '--' }])
    } catch (error) {
      caught = error
    }
    expect(caught).toEqual(
      new NamecheapProviderError('namecheap_too_many_rejected', {
        rejections: { 'renewPrice: invalid_format': 1 }
      })
    )
  })
})

describe('Namecheap adapter', () => {
  it('reads numbered staged pages and reports the marked last page', async () => {
    const { adapter, readPage } = adapterFor({
      1: JSON.stringify({ page: 1, isLastPage: false, records: [record] }),
      2: JSON.stringify({ page: 2, isLastPage: true, records: [record] })
    })
    expect(adapter.provider).toBe('namecheap')
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

  it('is built by the registry as a CSV file feed', async () => {
    const registration = PROVIDER_REGISTRY.namecheap as FeedProviderRegistration
    expect(registration.rateLimit).toBe('one download per run')
    expect(registration.secretNames).toEqual([])
    expect(registration.fileFeed).toMatchObject({ format: 'csv', pageSize: 2000 })
    const withoutPages = registration.createAdapter({ secrets: {} })
    await expect(withoutPages.fetchPage({ pageIndex: 1 })).rejects.toThrow(
      new NamecheapProviderError('namecheap_invalid_request')
    )
    const readPage = vi.fn(async () =>
      JSON.stringify({ page: 1, isLastPage: true, records: [record] })
    )
    const adapter = registration.createAdapter({ secrets: {}, feedPages: { readPage } })
    await expect(adapter.fetchPage({ pageIndex: 1 })).resolves.toMatchObject({
      received: 1,
      isLastPage: true
    })
  })

  it('maps invalid requests and read failures to fixed codes', async () => {
    const { adapter: unread, readPage } = adapterFor({})
    await expect(unread.fetchPage({ pageIndex: 1001 })).rejects.toThrow(
      new NamecheapProviderError('namecheap_invalid_request')
    )
    expect(readPage).not.toHaveBeenCalled()

    const cases: [PageOutcome, string][] = [
      [new Error('R2 unavailable'), 'namecheap_page_read_error'],
      [new ResponseTooLargeError(), 'namecheap_response_too_large'],
      [null, 'namecheap_missing_page'],
      ['{', 'namecheap_parse_error'],
      [JSON.stringify({ page: 2, isLastPage: true, records: [] }), 'namecheap_response_error'],
      [
        JSON.stringify({
          page: 1,
          isLastPage: true,
          records: Array.from({ length: 2001 }, () => record)
        }),
        'namecheap_response_error'
      ]
    ]
    for (const [outcome, code] of cases) {
      const { adapter } = adapterFor({ 1: outcome })
      await expect(adapter.fetchPage({ pageIndex: 1 })).rejects.toThrow(
        new NamecheapProviderError(code as never, {
          transient: code === 'namecheap_page_read_error'
        })
      )
    }
  })
})
