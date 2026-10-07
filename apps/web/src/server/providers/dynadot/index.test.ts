import { describe, expect, it, vi } from 'vitest'

import { createPacer } from '../rate-limit'
import { type ApiProviderRegistration, PROVIDER_REGISTRY } from '../registry'
import {
  createDynadotAdapter,
  DYNADOT_RATE_LIMIT,
  DynadotProviderError,
  fetchDynadotPage
} from './index'

const validItem = {
  auction_id: 42,
  domain: '  Example-Domain.COM  ',
  auction_type: 'expired',
  currency: 'usd',
  current_bid_price: '1,234.50',
  bids: '7',
  bidders: 3,
  start_time_stamp: '1760000000000',
  end_time_stamp: 1760003600000,
  age: '12',
  links: '-',
  visitors: -1,
  dyna_appraisal: '99.9',
  renewal_price: '',
  provider_added_field: { tolerated: true }
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'text/plain' },
    ...init
  })
}

describe('fetchDynadotPage', () => {
  it('builds the request internally and normalizes a text/plain JSON page', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: 'success',
        auction_list: [validItem],
        response_added_field: true
      })
    )

    const result = await fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex: 2,
      pageSize: 1000,
      fetchImpl
    })

    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]))
    expect(requestedUrl.origin + requestedUrl.pathname).toBe('https://api.dynadot.com/api3.json')
    expect(Object.fromEntries(requestedUrl.searchParams)).toEqual({
      key: 'invented-key',
      command: 'get_open_auctions',
      currency: 'usd',
      type: 'expired',
      count_per_page: '1000',
      page_index: '2'
    })
    expect(result.listings).toEqual([
      {
        provider: 'dynadot',
        externalId: '42',
        domainName: 'example-domain.com',
        auctionUrl: 'https://www.dynadot.com/market/auction/example-domain.com',
        auctionType: 'EXPIRED',
        currency: 'USD',
        currentBidCents: 123450,
        bidCount: 7,
        bidderCount: 3,
        startsAt: new Date(1760000000000),
        endsAt: new Date(1760003600000),
        ageYears: 12,
        inboundLinks: null,
        visitors: null,
        appraisalCents: 9990,
        renewalPriceCents: null
      }
    ])
  })

  it.each([
    { pageIndex: 0, pageSize: 1 },
    { pageIndex: 1001, pageSize: 1 },
    { pageIndex: 1.5, pageSize: 1 },
    { pageIndex: 1, pageSize: 0 },
    { pageIndex: 1, pageSize: 1001 }
  ])('rejects invalid page bounds without fetching: %o', async input => {
    const fetchImpl = vi.fn()

    await expect(
      fetchDynadotPage({ apiKey: 'invented-key', ...input, fetchImpl })
    ).rejects.toMatchObject({ code: 'dynadot_invalid_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts page index 1000', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: 'success', auction_list: [] })
    )

    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1000,
        pageSize: 1,
        fetchImpl
      })
    ).resolves.toEqual({ listings: [], received: 0, rejected: 0 })
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get('page_index')).toBe(
      '1000'
    )
  })

  it('rejects more rows than the requested page size', async () => {
    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 1,
        fetchImpl: async () =>
          jsonResponse({
            status: 'success',
            auction_list: [validItem, { ...validItem, auction_id: 43 }]
          })
      })
    ).rejects.toMatchObject({ code: 'dynadot_response_error' })
  })

  it('aborts a timed-out request with a sanitized error', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const request = fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex: 1,
      pageSize: 1,
      fetchImpl
    })
    const rejection = expect(request).rejects.toMatchObject({
      code: 'dynadot_network_error'
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await rejection
    vi.useRealTimers()
  })

  it('composes an injected abort signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 1,
        signal: controller.signal,
        fetchImpl: async (_input, init) => {
          if (init?.signal?.aborted) throw new Error('aborted')
          return jsonResponse({ status: 'success', auction_list: [] })
        }
      })
    ).rejects.toMatchObject({ code: 'dynadot_network_error' })
  })

  it('rejects oversized content-length and streamed bodies', async () => {
    const oversizedHeader = new Response('', {
      headers: { 'content-length': String(10 * 1024 * 1024 + 1) }
    })
    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 1,
        fetchImpl: async () => oversizedHeader
      })
    ).rejects.toMatchObject({ code: 'dynadot_response_too_large' })

    const chunk = new Uint8Array(6 * 1024 * 1024)
    const streamed = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(chunk)
          controller.enqueue(chunk)
        }
      })
    )
    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 1,
        fetchImpl: async () => streamed
      })
    ).rejects.toMatchObject({ code: 'dynadot_response_too_large' })
  })

  it('retries a body that fails mid-stream, including an abort', async () => {
    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 1,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              pull() {
                throw new Error('stream internals')
              }
            })
          )
      })
    ).rejects.toEqual(new DynadotProviderError('dynadot_network_error', { transient: true }))

    const abortController = new AbortController()
    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 1,
        signal: abortController.signal,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              pull() {
                abortController.abort()
                throw new Error('aborted')
              }
            })
          )
      })
    ).rejects.toMatchObject({ code: 'dynadot_network_error' })
  })

  it('always clears the request timeout', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    await fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex: 1,
      pageSize: 1,
      fetchImpl: async () => jsonResponse({ status: 'success', auction_list: [] })
    })
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('handles a response without a body', async () => {
    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 1,
        fetchImpl: async () => new Response(null)
      })
    ).rejects.toMatchObject({ code: 'dynadot_parse_error' })
  })

  it.each([
    ['status', { status: 'failed', auction_list: [] }],
    ['shape', { status: 'success', auction_list: {} }]
  ])('rejects a malformed provider %s', async (_label, body) => {
    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 10,
        fetchImpl: async () => jsonResponse(body)
      })
    ).rejects.toMatchObject({ code: 'dynadot_response_error' })
  })

  it.each([
    ['core field', { bidders: undefined }, 'bidders: invalid_union'],
    ['domain', { domain: 'bad_label.example' }, 'domain: invalid_domain'],
    ['unparseable internationalized domain', { domain: 'té st.example' }, 'domain: invalid_domain'],
    ['empty domain', { domain: '' }, 'domain: invalid_domain'],
    ['single-label domain', { domain: 'localhost' }, 'domain: invalid_domain'],
    ['overlong domain', { domain: `${'a'.repeat(250)}.com` }, 'domain: too_big'],
    ['empty identity', { auction_id: '  ' }, 'auction_id: invalid_string'],
    ['overlong identity', { auction_id: 'x'.repeat(257) }, 'auction_id: too_big'],
    ['trailing dot', { domain: 'example.com.' }, 'domain: invalid_domain'],
    ['fractional cent', { current_bid_price: '1.001' }, 'current_bid_price: invalid_decimal'],
    ['unsafe money', { current_bid_price: '9007199254740991' }, 'current_bid_price: invalid_money'],
    ['invalid integer', { bids: '1.5' }, 'bids: invalid_integer'],
    ['timestamp', { end_time_stamp: 0 }, 'end_time_stamp: invalid_timestamp'],
    [
      'out-of-range timestamp',
      { end_time_stamp: '9007199254740991' },
      'end_time_stamp: invalid_timestamp'
    ]
  ])(
    'rejects an auction with a malformed %s and names the field',
    async (_label, fields, reason) => {
      await expect(
        fetchDynadotPage({
          apiKey: 'invented-key',
          pageIndex: 1,
          pageSize: 10,
          fetchImpl: async () =>
            jsonResponse({ status: 'success', auction_list: [{ ...validItem, ...fields }] })
        })
      ).rejects.toMatchObject({ code: 'dynadot_too_many_rejected', rejections: { [reason]: 1 } })
    }
  )

  it('skips and counts an invalid auction without failing the page', async () => {
    const auctions = Array.from({ length: 10 }, (_, index) => ({
      ...validItem,
      auction_id: index + 1,
      domain: `valid-${index}.example`
    }))
    auctions[3] = { ...auctions[3]!, domain: 'bad_label.example' }

    const page = await fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex: 1,
      pageSize: 10,
      fetchImpl: async () => jsonResponse({ status: 'success', auction_list: auctions })
    })

    expect(page.received).toBe(10)
    expect(page.rejected).toBe(1)
    expect(page.listings.map(listing => listing.domainName)).not.toContain('bad_label.example')
    expect(page.listings).toHaveLength(9)
  })

  it('fails the page when more than a tenth of its auctions are invalid, with the reasons', async () => {
    // The #73 case: renewal prices Dynadot wrote in a new format.
    const auctions = Array.from({ length: 10 }, (_, index) => ({
      ...validItem,
      auction_id: index + 1,
      domain: index < 1 ? `bad_${index}.example` : `valid-${index}.example`,
      renewal_price: index > 7 ? 'n/a' : '12.00'
    }))

    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 10,
        fetchImpl: async () => jsonResponse({ status: 'success', auction_list: auctions })
      })
    ).rejects.toEqual(
      new DynadotProviderError('dynadot_too_many_rejected', {
        rejections: { 'domain: invalid_domain': 1, 'renewal_price: invalid_decimal': 2 }
      })
    )
  })

  it('stores internationalized domain names in punycode', async () => {
    const {
      listings: [listing]
    } = await fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex: 1,
      pageSize: 10,
      fetchImpl: async () =>
        jsonResponse({
          status: 'success',
          auction_list: [{ ...validItem, domain: 'Tést.Example' }]
        })
    })

    expect(listing?.domainName).toBe('xn--tst-bma.example')
  })

  it('accepts integer money and omitted nullable fields', async () => {
    const requiredItem: Record<string, unknown> = { ...validItem }
    for (const field of [
      'age',
      'links',
      'visitors',
      'dyna_appraisal',
      'renewal_price',
      'start_time_stamp'
    ]) {
      delete requiredItem[field]
    }

    const {
      listings: [result]
    } = await fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex: 1,
      pageSize: 10,
      fetchImpl: async () =>
        jsonResponse({
          status: 'success',
          auction_list: [{ ...requiredItem, current_bid_price: '$5' }]
        })
    })

    expect(result).toMatchObject({
      currentBidCents: 500,
      startsAt: null,
      ageYears: null,
      inboundLinks: null,
      visitors: null,
      appraisalCents: null,
      renewalPriceCents: null
    })
  })

  it.each([
    ['empty', ''],
    ['dash', '-'],
    ['negative number', -5],
    ['negative string', '-2']
  ])('maps nullable numeric %s sentinels to null', async (_label, sentinel) => {
    const {
      listings: [listing]
    } = await fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex: 1,
      pageSize: 10,
      fetchImpl: async () =>
        jsonResponse({
          status: 'success',
          auction_list: [
            {
              ...validItem,
              age: sentinel,
              links: sentinel,
              visitors: sentinel,
              dyna_appraisal: sentinel,
              renewal_price: sentinel,
              start_time_stamp: sentinel
            }
          ]
        })
    })

    expect(listing).toMatchObject({
      startsAt: null,
      ageYears: null,
      inboundLinks: null,
      visitors: null,
      appraisalCents: null,
      renewalPriceCents: null
    })
  })

  it.each([
    [
      'network',
      async () => {
        throw new Error('invented-key https://secret.invalid/raw')
      },
      'dynadot_network_error'
    ],
    [
      'http',
      async () => new Response('invented-key raw body', { status: 503 }),
      'dynadot_http_error'
    ],
    ['parse', async () => new Response('invented-key not json'), 'dynadot_parse_error']
  ])('returns a fixed sanitized %s error', async (_label, fetchImpl, code) => {
    let caught: unknown
    try {
      await fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 10,
        fetchImpl
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(DynadotProviderError)
    expect(caught).toMatchObject({ code, message: code })
    expect(String(caught)).not.toContain('invented-key')
    expect(String(caught)).not.toContain('secret.invalid')
    expect(String(caught)).not.toContain('raw body')
  })
})

describe('Dynadot adapter', () => {
  it('is built by the registry and ends on the first short page', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: 'success', auction_list: [validItem] })
    )
    vi.stubGlobal('fetch', fetchImpl)
    try {
      const registration = PROVIDER_REGISTRY.dynadot as ApiProviderRegistration
      expect(registration.rateLimit).toEqual(DYNADOT_RATE_LIMIT)
      expect(DYNADOT_RATE_LIMIT.intervalMs).toBe(1_100)
      const pacer = vi.fn(async () => undefined)
      const adapter = registration.createAdapter({
        secrets: { DYNADOT_API_PRODUCTION_KEY: 'invented-test-key' },
        pacer
      })
      expect(adapter.provider).toBe('dynadot')
      await expect(adapter.fetchPage({ pageIndex: 1 })).resolves.toMatchObject({
        received: 1,
        rejected: 0,
        isLastPage: true
      })
      expect(pacer).toHaveBeenCalledTimes(1)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('requests pages at most once per interval to stay under the rate limit', async () => {
    let clock = 10_000
    const waits: number[] = []
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: 'success', auction_list: [validItem] })
    )
    const adapter = createDynadotAdapter({
      apiKey: 'invented-test-key',
      fetchImpl,
      pacer: createPacer(DYNADOT_RATE_LIMIT.intervalMs, {
        now: () => clock,
        wait: async milliseconds => {
          waits.push(milliseconds)
          clock += milliseconds
        }
      })
    })
    await adapter.fetchPage({ pageIndex: 1 })
    clock += 300
    await adapter.fetchPage({ pageIndex: 2 })
    clock += 5_000
    await adapter.fetchPage({ pageIndex: 3 })
    expect(waits).toEqual([DYNADOT_RATE_LIMIT.intervalMs - 300])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe('Dynadot missing values', () => {
  it('reads one or more dashes as a missing value', async () => {
    const result = await fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex: 1,
      pageSize: 1000,
      fetchImpl: vi.fn<typeof fetch>(async () =>
        jsonResponse({
          status: 'success',
          auction_list: [{ ...validItem, renewal_price: '--', dyna_appraisal: '-', age: '---' }]
        })
      )
    })
    expect(result.rejected).toBe(0)
    expect(result.listings[0]).toMatchObject({
      renewalPriceCents: null,
      appraisalCents: null,
      ageYears: null
    })
  })
})

describe('Dynadot transient failures', () => {
  const fetchWith = (response: () => Response | Promise<Response>, pageIndex = 1) =>
    fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex,
      pageSize: 1000,
      fetchImpl: vi.fn<typeof fetch>(async () => response())
    })
  const errorBody = (error?: string) =>
    jsonResponse({
      Response: { ResponseCode: '-1', ...(error === undefined ? {} : { Error: error }) }
    })

  it('marks the rate-limit answer, server errors, and network failures transient', async () => {
    const cases: [() => Response | Promise<Response>, DynadotProviderError][] = [
      [
        () => errorBody('Too many requests. Please try again in 1 minute after.'),
        new DynadotProviderError('dynadot_rate_limited', { transient: true, retryAfterMs: 60_000 })
      ],
      [
        () => new Response('busy', { status: 429 }),
        new DynadotProviderError('dynadot_http_error', { transient: true })
      ],
      [
        () => new Response('down', { status: 503 }),
        new DynadotProviderError('dynadot_http_error', { transient: true })
      ],
      [
        () => Promise.reject(new Error('reset')),
        new DynadotProviderError('dynadot_network_error', { transient: true })
      ],
      [() => new Response('gone', { status: 404 }), new DynadotProviderError('dynadot_http_error')]
    ]
    for (const [response, expected] of cases) {
      await expect(fetchWith(response)).rejects.toEqual(expected)
    }
  })

  it('carries the wait the provider asked for', async () => {
    const cases: [() => Response, number | null][] = [
      [() => errorBody('Too many requests. Please try again in 1 minute after.'), 60_000],
      [() => errorBody('Rate limited, try again in 30 Seconds'), 30_000],
      [() => errorBody('Too many requests. Try again in 2 hours.'), 7_200_000],
      [() => errorBody('Too many requests.'), null],
      [() => new Response('busy', { status: 429, headers: { 'retry-after': '120' } }), 120_000],
      [() => new Response('down', { status: 503, headers: { 'retry-after': '5' } }), 5_000],
      [() => new Response('busy', { status: 429, headers: { 'retry-after': 'soon' } }), null],
      [() => new Response('busy', { status: 429 }), null],
      // Only 429 and 503 define Retry-After.
      [() => new Response('error', { status: 500, headers: { 'retry-after': '120' } }), null]
    ]
    for (const [response, retryAfterMs] of cases) {
      await expect(fetchWith(response)).rejects.toMatchObject({ transient: true, retryAfterMs })
    }
  })

  it('recognizes a reworded rate limit on any page', async () => {
    for (const message of ['Rate limit exceeded', 'Request throttled', 'Please try again later']) {
      await expect(fetchWith(() => errorBody(message))).rejects.toMatchObject({
        code: 'dynadot_rate_limited',
        transient: true
      })
    }
  })

  it('fails an invalid key on page 1, and retries an unrecognized error after page 1', async () => {
    for (const message of ['Invalid key', 'Invalid key, please check it and try again']) {
      await expect(fetchWith(() => errorBody(message))).rejects.toEqual(
        new DynadotProviderError('dynadot_api_error')
      )
    }
    await expect(fetchWith(() => errorBody())).rejects.toMatchObject({
      code: 'dynadot_api_error',
      transient: false
    })
    // The key worked for page 1, so a later error, even without a message,
    // is most likely a limit.
    await expect(fetchWith(() => errorBody(), 2)).rejects.toMatchObject({
      code: 'dynadot_api_error',
      transient: true,
      retryAfterMs: null
    })
    await expect(
      fetchWith(() => jsonResponse({ Response: { ResponseCode: -1, Error: 'Unknown' } }), 40)
    ).rejects.toMatchObject({ code: 'dynadot_api_error', transient: true })
  })
})
