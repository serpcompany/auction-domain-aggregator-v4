import { describe, expect, it, vi } from 'vitest'

import { PROVIDER_REGISTRY } from '../registry'
import {
  createDynadotAdapter,
  DYNADOT_REQUEST_INTERVAL_MS,
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

  it('sanitizes body stream failures, including aborts', async () => {
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
    ).rejects.toMatchObject({ code: 'dynadot_parse_error' })

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
    ['shape', { status: 'success', auction_list: {} }],
    [
      'core field',
      {
        status: 'success',
        auction_list: [{ ...validItem, bidders: undefined }]
      }
    ],
    [
      'domain',
      {
        status: 'success',
        auction_list: [{ ...validItem, domain: 'bad_label.example' }]
      }
    ],
    [
      'unparseable internationalized domain',
      {
        status: 'success',
        auction_list: [{ ...validItem, domain: 'té st.example' }]
      }
    ],
    [
      'empty domain',
      {
        status: 'success',
        auction_list: [{ ...validItem, domain: '' }]
      }
    ],
    [
      'single-label domain',
      {
        status: 'success',
        auction_list: [{ ...validItem, domain: 'localhost' }]
      }
    ],
    [
      'overlong domain',
      {
        status: 'success',
        auction_list: [{ ...validItem, domain: `${'a'.repeat(250)}.com` }]
      }
    ],
    [
      'empty identity',
      {
        status: 'success',
        auction_list: [{ ...validItem, auction_id: '  ' }]
      }
    ],
    [
      'overlong identity',
      {
        status: 'success',
        auction_list: [{ ...validItem, auction_id: 'x'.repeat(257) }]
      }
    ],
    [
      'trailing dot',
      {
        status: 'success',
        auction_list: [{ ...validItem, domain: 'example.com.' }]
      }
    ],
    [
      'fractional cent',
      {
        status: 'success',
        auction_list: [{ ...validItem, current_bid_price: '1.001' }]
      }
    ],
    [
      'unsafe money',
      {
        status: 'success',
        auction_list: [{ ...validItem, current_bid_price: '9007199254740991' }]
      }
    ],
    [
      'invalid integer',
      {
        status: 'success',
        auction_list: [{ ...validItem, bids: '1.5' }]
      }
    ],
    [
      'timestamp',
      {
        status: 'success',
        auction_list: [{ ...validItem, end_time_stamp: 0 }]
      }
    ],
    [
      'out-of-range timestamp',
      {
        status: 'success',
        auction_list: [{ ...validItem, end_time_stamp: '9007199254740991' }]
      }
    ]
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

  it('fails the page when more than a tenth of its auctions are invalid', async () => {
    const auctions = Array.from({ length: 10 }, (_, index) => ({
      ...validItem,
      auction_id: index + 1,
      domain: index < 2 ? `bad_${index}.example` : `valid-${index}.example`
    }))

    await expect(
      fetchDynadotPage({
        apiKey: 'invented-key',
        pageIndex: 1,
        pageSize: 10,
        fetchImpl: async () => jsonResponse({ status: 'success', auction_list: auctions })
      })
    ).rejects.toMatchObject({ code: 'dynadot_response_error' })
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
      const adapter = PROVIDER_REGISTRY.dynadot!.createAdapter({
        secrets: { DYNADOT_API_PRODUCTION_KEY: 'invented-test-key' }
      })
      expect(adapter.provider).toBe('dynadot')
      await expect(adapter.fetchPage({ pageIndex: 1 })).resolves.toMatchObject({
        received: 1,
        rejected: 0,
        isLastPage: true
      })
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
      now: () => clock,
      wait: async milliseconds => {
        waits.push(milliseconds)
        clock += milliseconds
      }
    })
    await adapter.fetchPage({ pageIndex: 1 })
    clock += 300
    await adapter.fetchPage({ pageIndex: 2 })
    clock += 5_000
    await adapter.fetchPage({ pageIndex: 3 })
    expect(waits).toEqual([DYNADOT_REQUEST_INTERVAL_MS - 300])
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

describe('Dynadot request pacing', () => {
  it('waits on a real timer by default', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        jsonResponse({ status: 'success', auction_list: [validItem] })
      )
      const adapter = createDynadotAdapter({ apiKey: 'invented-test-key', fetchImpl })
      await adapter.fetchPage({ pageIndex: 1 })
      const second = adapter.fetchPage({ pageIndex: 2 })
      await vi.advanceTimersByTimeAsync(DYNADOT_REQUEST_INTERVAL_MS - 1)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await second
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Dynadot transient failures', () => {
  const fetchWith = (response: () => Response | Promise<Response>) =>
    fetchDynadotPage({
      apiKey: 'invented-key',
      pageIndex: 1,
      pageSize: 1000,
      fetchImpl: vi.fn<typeof fetch>(async () => response())
    })

  it('marks the rate-limit answer, server errors, and network failures transient', async () => {
    const cases: [() => Response | Promise<Response>, DynadotProviderError][] = [
      [
        () =>
          jsonResponse({
            Response: {
              ResponseCode: '-1',
              Error: 'Too many requests. Please try again in 1 minute after.'
            }
          }),
        new DynadotProviderError('dynadot_rate_limited', { transient: true })
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
      [() => new Response('gone', { status: 404 }), new DynadotProviderError('dynadot_http_error')],
      [
        () => jsonResponse({ Response: { ResponseCode: '-1', Error: 'Invalid key' } }),
        new DynadotProviderError('dynadot_response_error')
      ]
    ]
    for (const [response, expected] of cases) {
      await expect(fetchWith(response)).rejects.toEqual(expected)
    }
  })
})
