import { describe, expect, it, vi } from 'vitest'

import { AhrefsError } from './ahrefs'
import { DOMAIN_RATING_MATCHING_LIMIT, enrichDomainRatings } from './domain-rating'
import {
  type DomainRatingRequestDependencies,
  handleDomainRatingRequest,
  handleMatchingDomainRatingRequest
} from './domain-rating-request'
import { createMemoryDomainRatingStore } from './test-domain-rating-store'

function post(body: unknown, signal?: AbortSignal) {
  return new Request('http://local/api/enrichment/domain-rating', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal
  })
}

function dependencies(
  overrides: Partial<DomainRatingRequestDependencies> = {}
): DomainRatingRequestDependencies {
  return {
    apiKey: 'invented-key',
    enrich: vi.fn(async (fetchRatings, domains) => {
      await fetchRatings(domains)
      return { requested: domains.length, stored: domains.length }
    }),
    fetchRatings: vi.fn(async () => new Map()),
    ...overrides
  }
}

describe('handleDomainRatingRequest', () => {
  it('enriches valid domains using the configured key', async () => {
    const deps = dependencies()
    const response = await handleDomainRatingRequest(
      post({ domains: ['garden.com', 'xn--tst-bma.example'] }),
      deps
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      requested: 2,
      stored: 2
    })
    expect(deps.fetchRatings).toHaveBeenCalledWith('invented-key', [
      'garden.com',
      'xn--tst-bma.example'
    ])
  })

  it('reports a missing key without reading the body', async () => {
    const deps = dependencies({ apiKey: undefined })
    const response = await handleDomainRatingRequest(post('{'), deps)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'failed',
      errorCode: 'ahrefs_not_configured'
    })
  })

  it.each([
    ['malformed JSON', '{'],
    ['no domains', { domains: [] }],
    ['an invalid domain', { domains: ['Not A Domain'] }],
    ['an extra field', { domains: ['a.com'], force: true }],
    ['too many domains', { domains: Array.from({ length: 51 }, (_, i) => `d${i}.com`) }]
  ])('rejects %s', async (_label, body) => {
    const deps = dependencies()
    const response = await handleDomainRatingRequest(post(body), deps)
    expect(response.status).toBe(400)
    expect(deps.enrich).not.toHaveBeenCalled()
  })

  it.each([
    [new AhrefsError('ahrefs_rate_limited'), 429, 'ahrefs_rate_limited'],
    [new AhrefsError('ahrefs_unauthorized'), 502, 'ahrefs_unauthorized'],
    [new Error('D1 details'), 500, 'enrichment_failed']
  ])('maps %s to a fixed code', async (error, status, errorCode) => {
    const response = await handleDomainRatingRequest(
      post({ domains: ['a.com'] }),
      dependencies({
        enrich: vi.fn(async () => {
          throw error
        })
      })
    )
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ status: 'failed', errorCode })
  })

  it('answers 429 with Retry-After during a cool-down without calling Ahrefs', async () => {
    const { store } = createMemoryDomainRatingStore(['a.com', 'b.com'])
    const now = () => new Date('2026-10-07T12:00:00.000Z')
    const fetchRatings = vi.fn(async () => {
      throw new AhrefsError('ahrefs_rate_limited', 30)
    })
    const deps = dependencies({
      enrich: (fetch, domains, signal) =>
        enrichDomainRatings(store, fetch, domains, { signal, now }),
      fetchRatings
    })

    const limited = await handleDomainRatingRequest(post({ domains: ['a.com'] }), deps)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ status: 'failed', errorCode: 'ahrefs_rate_limited' })

    const cooling = await handleDomainRatingRequest(post({ domains: ['b.com'] }), deps)
    expect(cooling.status).toBe(429)
    expect(cooling.headers.get('retry-after')).toBe('30')
    expect(await cooling.json()).toEqual({ status: 'failed', errorCode: 'ahrefs_cool_down' })
    expect(fetchRatings).toHaveBeenCalledOnce()
  })

  it('passes the request signal on and makes no Ahrefs call once the client aborts', async () => {
    const { store } = createMemoryDomainRatingStore(['a.com'])
    const controller = new AbortController()
    const fetchRatings = vi.fn(async () => new Map())
    const deps = dependencies({
      enrich: vi.fn(async (fetch, domains, signal) => {
        controller.abort()
        return enrichDomainRatings(store, fetch, domains, { signal })
      }),
      fetchRatings
    })

    const response = await handleDomainRatingRequest(
      post({ domains: ['a.com'] }, controller.signal),
      deps
    )
    expect(response.status).toBe(499)
    expect(await response.json()).toEqual({ status: 'failed', errorCode: 'request_aborted' })
    expect(fetchRatings).not.toHaveBeenCalled()
  })
})

describe('handleMatchingDomainRatingRequest', () => {
  const search = 'majesticTfMin=25&sort=endsAt&direction=asc&page=1'

  it('fetches every matching domain in one Ahrefs call, past the page limit', async () => {
    const domains = Array.from({ length: 60 }, (_, index) => `d${index}.com`)
    const { store } = createMemoryDomainRatingStore(domains)
    const fetchRatings = vi.fn(
      async (_key: string, targets: string[]) => new Map(targets.map(target => [target, 42]))
    )
    const matchingDomains = vi.fn(async () => domains)
    const response = await handleMatchingDomainRatingRequest(post({ search }), {
      ...dependencies({
        enrich: (fetch, targets, signal) =>
          enrichDomainRatings(store, fetch, targets, {
            signal,
            limit: DOMAIN_RATING_MATCHING_LIMIT
          }),
        fetchRatings
      }),
      matchingDomains
    })

    expect(await response.json()).toEqual({ status: 'ok', requested: 60, stored: 60 })
    expect(matchingDomains).toHaveBeenCalledWith(search)
    expect(fetchRatings).toHaveBeenCalledOnce()
    expect(fetchRatings.mock.calls[0]?.[1]).toHaveLength(60)
  })

  it('refuses filters that match too many domains without calling Ahrefs', async () => {
    const deps = { ...dependencies(), matchingDomains: vi.fn(async () => null) }
    const response = await handleMatchingDomainRatingRequest(post({ search }), deps)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ status: 'failed', errorCode: 'too_many_listings' })
    expect(deps.enrich).not.toHaveBeenCalled()
  })

  it('reports a missing key without reading the body', async () => {
    const deps = { ...dependencies({ apiKey: undefined }), matchingDomains: vi.fn() }
    const response = await handleMatchingDomainRatingRequest(post('{'), deps)
    expect(response.status).toBe(503)
    expect(deps.matchingDomains).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed JSON', '{'],
    ['no search', {}],
    ['an extra field', { search, force: true }],
    ['an overlong search', { search: 'q='.padEnd(4_001, 'a') }]
  ])('rejects %s', async (_label, body) => {
    const deps = { ...dependencies(), matchingDomains: vi.fn() }
    const response = await handleMatchingDomainRatingRequest(post(body), deps)
    expect(response.status).toBe(400)
    expect(deps.matchingDomains).not.toHaveBeenCalled()
  })
})
