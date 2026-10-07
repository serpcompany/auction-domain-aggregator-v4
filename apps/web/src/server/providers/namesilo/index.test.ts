import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { createPacer, DEFAULT_RATE_LIMIT, type Pacer } from '../rate-limit'
import { type ApiProviderRegistration, PROVIDER_REGISTRY } from '../registry'
import { INGESTION_USER_AGENT } from '../types'
import {
  createNamesiloAdapter,
  NAMESILO_MAX_CUSTOMER_PAGES,
  NAMESILO_PAGE_SIZE,
  NAMESILO_RATE_LIMIT,
  NamesiloProviderError
} from './index'

// Invented records in the shape `listAuctions` returns.
const expiredItem = {
  id: 9001,
  leaderUserId: 0,
  ownerUserId: 1,
  domainId: 77,
  domain: '  Invented-Example.COM ',
  statusId: 2,
  typeId: 3,
  openingBid: 1,
  currentBid: 12.5,
  maxBid: 1995,
  bidId: 5,
  domainCreatedOn: '2010-10-28 08:00:00',
  auctionEndsOn: '2026-10-28 00:00:00',
  auctionEndsOnUtc: '2026-10-28 07:00:00',
  url: 'https://www.namesilo.com/auctions/invented-example.com',
  bidsQuantity: 4,
  hasBids: true,
  visits: 31,
  clicks: 2,
  ctr: 0.06
}

const customerItem = {
  ...expiredItem,
  id: 42,
  domain: 'customer-sale.example',
  statusId: 9,
  typeId: 1,
  openingBid: 0,
  currentBid: 0,
  maxBid: 20000,
  bidsQuantity: 0,
  hasBids: false,
  url: 'https://www.namesilo.com/auctions/customer-sale.example'
}

// `count` distinct records from `base`, with `edits` applied by index.
const items = (
  count: number,
  base: Record<string, unknown> = expiredItem,
  edits: Record<number, Record<string, unknown>> = {}
) =>
  Array.from({ length: count }, (_, index) => ({
    ...base,
    id: Number(base.id) * 1000 + index,
    domain: `invented-${index}.example`,
    ...edits[index]
  }))

function reply(body: unknown, code: number | string = 300) {
  return new Response(JSON.stringify({ reply: { code, detail: 'success', body } }), {
    headers: { 'content-type': 'application/json' }
  })
}

function adapterWith(
  fetchImpl: typeof fetch,
  pacer: Mock<Pacer> = vi.fn<Pacer>(async () => undefined)
) {
  return { adapter: createNamesiloAdapter({ apiKey: 'invented-key', pacer, fetchImpl }), pacer }
}

const requested = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, call = 0) =>
  new URL(String(fetchImpl.mock.calls[call]?.[0]))

async function caught(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('NameSilo expired pages', () => {
  it('requests expired page n - 1 on the batch path and maps each field', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply([expiredItem]))
    const { adapter } = adapterWith(fetchImpl)

    const page = await adapter.fetchPage({ pageIndex: 3 })

    const url = requested(fetchImpl)
    expect(url.origin + url.pathname).toBe('https://www.namesilo.com/public/apibatch/listAuctions')
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({ 'user-agent': INGESTION_USER_AGENT })
    expect(Object.fromEntries(url.searchParams)).toEqual({
      version: '1',
      type: 'json',
      key: 'invented-key',
      typeId: '3',
      statusId: '2',
      page: '2',
      pageSize: '500'
    })
    expect(page).toEqual({
      listings: [
        {
          provider: 'namesilo',
          externalId: '9001',
          domainName: 'invented-example.com',
          auctionUrl: 'https://www.namesilo.com/auctions/invented-example.com',
          auctionType: 'EXPIRED',
          currency: 'USD',
          currentBidCents: 1250,
          bidCount: 4,
          bidderCount: null,
          startsAt: null,
          endsAt: new Date('2026-10-28T07:00:00Z'),
          ageYears: 15,
          inboundLinks: null,
          visitors: 31,
          appraisalCents: null,
          renewalPriceCents: null
        }
      ],
      received: 1,
      rejected: 0,
      isLastPage: true
    })
  })

  it('ends on the first short expired page, an empty one included', async () => {
    const full = vi.fn<typeof fetch>(async () => reply(items(NAMESILO_PAGE_SIZE)))
    await expect(adapterWith(full).adapter.fetchPage({ pageIndex: 2 })).resolves.toMatchObject({
      received: 500,
      isLastPage: false
    })
    const empty = vi.fn<typeof fetch>(async () => reply([]))
    await expect(adapterWith(empty).adapter.fetchPage({ pageIndex: 441 })).resolves.toEqual({
      listings: [],
      received: 0,
      rejected: 0,
      isLastPage: true
    })
    expect(requested(empty).searchParams.get('page')).toBe('440')
  })

  it('keeps auctions whose end time has passed', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply([{ ...expiredItem, auctionEndsOnUtc: '2025-07-01 12:00:00' }])
    )
    const { listings } = await adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 2 })
    expect(listings[0]?.endsAt).toEqual(new Date('2025-07-01T12:00:00Z'))
  })
})

describe('NameSilo customer auctions on page 1', () => {
  it('pages every customer auction internally and is never the last page', async () => {
    const pages = [items(500, customerItem), items(500, customerItem), items(3, customerItem)]
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(pages.shift()))
    const { adapter, pacer } = adapterWith(fetchImpl)

    const page = await adapter.fetchPage({ pageIndex: 1 })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(pacer).toHaveBeenCalledTimes(3)
    for (const call of [0, 1, 2]) {
      const url = requested(fetchImpl, call)
      expect(url.searchParams.get('typeId')).toBe('1')
      expect(url.searchParams.get('statusId')).toBe('9')
      expect(url.searchParams.get('page')).toBe(String(call + 1))
      expect(url.searchParams.get('pageSize')).toBe('500')
    }
    expect(page).toMatchObject({ received: 1003, rejected: 0, isLastPage: false })
    expect(page.listings).toHaveLength(1003)
    expect(page.listings[0]).toMatchObject({
      externalId: '42000',
      auctionType: 'AUCTION',
      currentBidCents: 0,
      bidCount: 0
    })
  })

  it('returns an empty page 1 when there are no customer auctions', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply([]))
    await expect(adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 1 })).resolves.toEqual({
      listings: [],
      received: 0,
      rejected: 0,
      isLastPage: false
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails with a fixed error after the customer page cap', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(items(500, customerItem)))
    const error = await caught(adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 1 }))
    expect(error).toEqual(new NamesiloProviderError('namesilo_customer_page_limit'))
    expect(fetchImpl).toHaveBeenCalledTimes(NAMESILO_MAX_CUSTOMER_PAGES)
    expect(NAMESILO_MAX_CUSTOMER_PAGES).toBe(40)
  })

  it('counts rejections across the internal pages', async () => {
    const pages = [
      items(500, customerItem, { 0: { domain: 'bad_label.example' } }),
      items(2, customerItem)
    ]
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(pages.shift()))
    await expect(adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 1 })).resolves.toMatchObject(
      { received: 502, rejected: 1 }
    )
  })
})

describe('NameSilo pacing', () => {
  it('waits for the pacer before every request, internal customer pages included', async () => {
    const events: string[] = []
    const pages = [items(500, customerItem), items(1, customerItem)]
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      events.push('fetch')
      return reply(pages.shift() ?? [expiredItem])
    })
    const pacer = vi.fn<Pacer>(async () => {
      events.push('pace')
    })
    const { adapter } = adapterWith(fetchImpl, pacer)
    await adapter.fetchPage({ pageIndex: 1 })
    await adapter.fetchPage({ pageIndex: 2 })
    expect(events).toEqual(['pace', 'fetch', 'pace', 'fetch', 'pace', 'fetch'])
  })

  it('spaces requests by the default rate limit', async () => {
    let clock = 10_000
    const waits: number[] = []
    const pages = [items(500, customerItem), items(1, customerItem)]
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      clock += 300
      return reply(pages.shift() ?? [expiredItem])
    })
    const adapter = createNamesiloAdapter({
      apiKey: 'invented-key',
      fetchImpl,
      pacer: createPacer(NAMESILO_RATE_LIMIT.intervalMs, {
        now: () => clock,
        wait: async milliseconds => {
          waits.push(milliseconds)
          clock += milliseconds
        }
      })
    })
    await adapter.fetchPage({ pageIndex: 1 })
    await adapter.fetchPage({ pageIndex: 2 })
    expect(waits).toEqual([1_700, 1_700])
  })
})

describe('NameSilo record mapping', () => {
  const mapOne = async (fields: Record<string, unknown>) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply([{ ...expiredItem, ...fields }]))
    const page = await adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 2 })
    return page.listings[0]
  }

  it.each([
    ['a bid', { hasBids: true, currentBid: 7, openingBid: 1 }, 700],
    ['a current bid without the flag', { hasBids: false, currentBid: 7, openingBid: 1 }, 700],
    ['a bid at zero', { hasBids: true, currentBid: 0, openingBid: 5 }, 0],
    ['a numeric flag', { hasBids: 1, currentBid: 0, openingBid: 5 }, 0],
    ['a string flag', { hasBids: '1', currentBid: 0, openingBid: 5 }, 0],
    ['a "true" flag', { hasBids: 'true', currentBid: 0, openingBid: 5 }, 0],
    ['no bids', { hasBids: false, currentBid: 0, openingBid: 5 }, 500],
    ['no flag', { hasBids: undefined, currentBid: 0, openingBid: '5.25' }, 525],
    ['a zero flag', { hasBids: 0, currentBid: '0', openingBid: 3 }, 300],
    ['a null flag', { hasBids: null, currentBid: 0, openingBid: 2 }, 200]
  ])('prices %s', async (_label, fields, cents) => {
    expect((await mapOne(fields))?.currentBidCents).toBe(cents)
  })

  it('never uses the price cap as the price', async () => {
    const listing = await mapOne({ hasBids: false, currentBid: 0, openingBid: 1, maxBid: 1995 })
    expect(listing?.currentBidCents).toBe(100)
  })

  it.each([
    ['a second before the anniversary', '2010-10-28 07:00:01', 15],
    ['on the anniversary', '2010-10-28 07:00:00', 16],
    ['as a bare date', '2010-10-27', 16],
    ['created after the end', '2027-01-01 00:00:00', null],
    ['missing', undefined, null],
    ['null', null, null],
    ['empty', '  ', null],
    ['the zero date', '0000-00-00 00:00:00', null]
  ])('measures age %s to the auction end', async (_label, domainCreatedOn, ageYears) => {
    expect((await mapOne({ domainCreatedOn }))?.ageYears).toBe(ageYears)
  })

  it('reads missing visits as unknown and string counts as numbers', async () => {
    expect(await mapOne({ visits: undefined, bidsQuantity: '3' })).toMatchObject({
      visitors: null,
      bidCount: 3
    })
    expect((await mapOne({ visits: null }))?.visitors).toBeNull()
  })

  it('stores internationalized names in punycode and keeps the URL', async () => {
    const listing = await mapOne({
      domain: 'Tést.Example',
      url: 'https://www.namesilo.com/auctions/xn--tst-bma.example/'
    })
    expect(listing).toMatchObject({
      domainName: 'xn--tst-bma.example',
      auctionUrl: 'https://www.namesilo.com/auctions/xn--tst-bma.example/'
    })
  })

  it.each([
    ['offer listing type', { typeId: 2 }, 'typeId: invalid_union'],
    ['identity', { id: 'abc' }, 'id: invalid_type'],
    ['domain', { domain: 'bad_label.example' }, 'domain: invalid_domain'],
    [
      'end-time format',
      { auctionEndsOnUtc: '2026-10-28T07:00:00Z' },
      'auctionEndsOnUtc: invalid_timestamp'
    ],
    [
      'impossible end time',
      { auctionEndsOnUtc: '2026-02-30 07:00:00' },
      'auctionEndsOnUtc: invalid_timestamp'
    ],
    [
      'end hour',
      { auctionEndsOnUtc: '2026-10-28 24:00:00' },
      'auctionEndsOnUtc: invalid_timestamp'
    ],
    ['creation date', { domainCreatedOn: 'yesterday' }, 'domainCreatedOn: invalid_timestamp'],
    ['http URL', { url: 'http://www.namesilo.com/auctions/invented.example' }, 'url: invalid_url'],
    [
      'foreign URL',
      { url: 'https://namesilo.example/auctions/invented.example' },
      'url: invalid_url'
    ],
    ['URL path', { url: 'https://www.namesilo.com/account/invented.example' }, 'url: invalid_url'],
    [
      'URL user',
      { url: 'https://user@www.namesilo.com/auctions/invented.example' },
      'url: invalid_url'
    ],
    [
      'URL password',
      { url: 'https://:secret@www.namesilo.com/auctions/a.example' },
      'url: invalid_url'
    ],
    ['unparseable URL', { url: 'not a url' }, 'url: invalid'],
    ['current bid', { currentBid: -1 }, 'currentBid: invalid_decimal'],
    [
      'opening bid',
      { hasBids: false, currentBid: 0, openingBid: 'n/a' },
      'openingBid: invalid_decimal'
    ],
    ['bid count', { bidsQuantity: 1.5 }, 'bidsQuantity: invalid_integer'],
    ['visits', { visits: -2 }, 'visits: invalid_integer']
  ])('rejects a malformed %s and names the field', async (_label, fields, reason) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply([{ ...expiredItem, ...fields }]))
    const error = await caught(adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 2 }))
    expect(error).toEqual(
      new NamesiloProviderError('namesilo_too_many_rejected', { rejections: { [reason]: 1 } })
    )
  })

  it('skips and counts a few invalid auctions without failing the page', async () => {
    const auctions = items(10, expiredItem, { 3: { url: 'https://www.namesilo.com/' } })
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(auctions))
    const page = await adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 2 })
    expect(page).toMatchObject({ received: 10, rejected: 1, isLastPage: true })
    expect(page.listings).toHaveLength(9)
  })
})

describe('NameSilo errors', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const fail = (response: () => Response | Promise<Response>, pageIndex = 2) =>
    caught(
      adapterWith(vi.fn<typeof fetch>(async () => response())).adapter.fetchPage({ pageIndex })
    )

  it.each([0, 1001, 1.5])('rejects page index %s without a request', async pageIndex => {
    const fetchImpl = vi.fn<typeof fetch>()
    const { adapter, pacer } = adapterWith(fetchImpl)
    await expect(adapter.fetchPage({ pageIndex })).rejects.toEqual(
      new NamesiloProviderError('namesilo_invalid_request')
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(pacer).not.toHaveBeenCalled()
  })

  it('rejects a missing key without a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const adapter = createNamesiloAdapter({ apiKey: '', pacer: async () => undefined, fetchImpl })
    await expect(adapter.fetchPage({ pageIndex: 1000 })).rejects.toMatchObject({
      code: 'namesilo_invalid_request'
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('marks network failures, 429, and server errors transient, honoring Retry-After', async () => {
    const cases: [() => Response | Promise<Response>, NamesiloProviderError][] = [
      [
        () => Promise.reject(new Error('reset')),
        new NamesiloProviderError('namesilo_network_error', { transient: true })
      ],
      [
        () => new Response('busy', { status: 429, headers: { 'retry-after': '120' } }),
        new NamesiloProviderError('namesilo_http_error', { transient: true, retryAfterMs: 120_000 })
      ],
      [
        () => new Response('down', { status: 503, headers: { 'retry-after': '5' } }),
        new NamesiloProviderError('namesilo_http_error', { transient: true, retryAfterMs: 5_000 })
      ],
      [
        () => new Response('error', { status: 500, headers: { 'retry-after': '120' } }),
        new NamesiloProviderError('namesilo_http_error', { transient: true })
      ],
      [
        () => new Response('gone', { status: 404 }),
        new NamesiloProviderError('namesilo_http_error')
      ]
    ]
    for (const [response, expected] of cases) {
      expect(await fail(response)).toEqual(expected)
    }
  })

  it('logs the status and any Cloudflare verdict of an HTTP error, never the key', async () => {
    const error = await fail(
      () =>
        new Response('blocked', {
          status: 403,
          headers: { server: 'cloudflare', 'cf-mitigated': 'challenge' }
        })
    )
    expect(error).toEqual(new NamesiloProviderError('namesilo_http_error'))
    expect(console.warn).toHaveBeenCalledWith('namesilo_http_error', {
      status: 403,
      server: 'cloudflare',
      cfMitigated: 'challenge'
    })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('invented-key')
  })

  it('retries a body that fails mid-stream', async () => {
    const error = await fail(
      () =>
        new Response(
          new ReadableStream({
            pull() {
              throw new Error('stream internals')
            }
          })
        )
    )
    expect(error).toEqual(new NamesiloProviderError('namesilo_network_error', { transient: true }))
  })

  it('aborts a request after 30 seconds as a transient network error', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const request = adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 2 })
    const rejection = expect(request).rejects.toMatchObject({
      code: 'namesilo_network_error',
      transient: true
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await rejection
  })

  it('always clears the request timeout', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    await adapterWith(vi.fn<typeof fetch>(async () => reply([]))).adapter.fetchPage({
      pageIndex: 2
    })
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('fails an oversized body permanently', async () => {
    const oversized = () =>
      new Response('', { headers: { 'content-length': String(10 * 1024 * 1024 + 1) } })
    expect(await fail(oversized)).toEqual(new NamesiloProviderError('namesilo_response_too_large'))
  })

  it.each([
    ['an empty body', () => new Response(null), 'namesilo_parse_error'],
    ['text', () => new Response('<html>'), 'namesilo_parse_error'],
    ['no reply', () => new Response(JSON.stringify({ code: 300 })), 'namesilo_response_error'],
    ['a body that is not a list', () => reply({}), 'namesilo_response_error'],
    [
      'no body',
      () => new Response(JSON.stringify({ reply: { code: 300 } })),
      'namesilo_response_error'
    ],
    ['more than a page', () => reply(items(501)), 'namesilo_response_error']
  ])('fails %s permanently', async (_label, response, code) => {
    expect(await fail(response)).toEqual(new NamesiloProviderError(code as 'namesilo_parse_error'))
  })

  it('accepts the success code as a string', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply([expiredItem], '300'))
    await expect(adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 2 })).resolves.toMatchObject(
      { received: 1 }
    )
  })

  it('fails an error answer to the first request, and retries one after the key worked', async () => {
    const errorAnswer = () => reply(undefined, 110)
    expect(await fail(errorAnswer, 1)).toEqual(new NamesiloProviderError('namesilo_api_error'))
    expect(await fail(errorAnswer, 2)).toEqual(
      new NamesiloProviderError('namesilo_api_error', { transient: true })
    )
    // A later internal customer page follows a request the key already passed.
    const answers = [reply(items(500, customerItem)), reply(undefined, 210)]
    const fetchImpl = vi.fn<typeof fetch>(async () => answers.shift() ?? reply([]))
    expect(await caught(adapterWith(fetchImpl).adapter.fetchPage({ pageIndex: 1 }))).toEqual(
      new NamesiloProviderError('namesilo_api_error', { transient: true })
    )
  })

  it('never puts the key, URL, or body into an error', async () => {
    const leaks = [
      () => Promise.reject(new Error('invented-key https://www.namesilo.com/public/apibatch')),
      () => new Response('invented-key raw body', { status: 500 }),
      () => new Response('invented-key not json'),
      () => reply('invented-key', 110)
    ]
    for (const response of leaks) {
      const error = await fail(response, 1)
      expect(error).toBeInstanceOf(NamesiloProviderError)
      expect(String(error)).not.toContain('invented-key')
      expect(String(error)).not.toContain('namesilo.com')
      expect(String(error)).not.toContain('raw body')
    }
  })
})

describe('NameSilo registration', () => {
  it('is a paged API with the default rate limit and its own key', async () => {
    const registration = PROVIDER_REGISTRY.namesilo as ApiProviderRegistration
    expect(registration.fileFeed).toBeUndefined()
    expect(registration.secretNames).toEqual(['NAMESILO_API_KEY'])
    expect(registration.rateLimit).toBe(DEFAULT_RATE_LIMIT)
    expect(registration.rateLimit.intervalMs).toBe(2_000)

    const fetchImpl = vi.fn<typeof fetch>(async () => reply([expiredItem]))
    vi.stubGlobal('fetch', fetchImpl)
    const pacer = vi.fn(async () => undefined)
    const adapter = registration.createAdapter({
      secrets: { NAMESILO_API_KEY: 'invented-test-key' },
      pacer
    })
    expect(adapter.provider).toBe('namesilo')
    await expect(adapter.fetchPage({ pageIndex: 2 })).resolves.toMatchObject({
      received: 1,
      isLastPage: true
    })
    expect(pacer).toHaveBeenCalledTimes(1)
    expect(requested(fetchImpl).searchParams.get('key')).toBe('invented-test-key')

    const withoutKey = registration.createAdapter({ secrets: {}, pacer })
    await expect(withoutKey.fetchPage({ pageIndex: 1 })).rejects.toEqual(
      new NamesiloProviderError('namesilo_invalid_request')
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
