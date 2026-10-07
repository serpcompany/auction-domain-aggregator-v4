import { describe, expect, it, vi } from 'vitest'

import { AhrefsError } from './ahrefs'
import {
  type DomainRatingRequestDependencies,
  handleDomainRatingRequest
} from './domain-rating-request'

function post(body: unknown) {
  return new Request('http://local/api/enrichment/domain-rating', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body)
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
})
