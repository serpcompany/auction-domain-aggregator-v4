import { describe, expect, it, vi } from 'vitest'

import { AhrefsError, fetchDomainRatings } from './ahrefs'

function respond(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => Response.json(body, { status }))
}

describe('fetchDomainRatings', () => {
  it('posts targets with the key and maps ratings by requested domain', async () => {
    const fetchImpl = respond({
      domain_rating: {
        license: 'https://ahrefs.com/legal/domain-rating-license',
        targets: [
          // Live responses echo targets with a trailing slash.
          { target: 'Garden.com/', domain_rating: 41.5 },
          { target: 'https://unknown.net', domain_rating: null },
          { target: 'not-requested.org', domain_rating: 90 }
        ]
      }
    })

    const ratings = await fetchDomainRatings({
      apiKey: 'invented-key',
      domains: ['garden.com', 'unknown.net', 'omitted.io'],
      fetchImpl
    })

    expect(ratings).toEqual(
      new Map([
        ['garden.com', 41.5],
        ['unknown.net', null]
      ])
    )
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.ahrefs.com/v3/public/domain-rating-free')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer invented-key')
    expect(JSON.parse(String(init?.body))).toEqual({
      targets: ['garden.com', 'unknown.net', 'omitted.io']
    })
  })

  it.each([
    ['no key', { apiKey: '', domains: ['a.com'] }],
    ['no domains', { apiKey: 'k', domains: [] }],
    [
      'too many domains',
      {
        apiKey: 'k',
        domains: Array.from({ length: 1001 }, (_, i) => `d${i}.com`)
      }
    ]
  ])('rejects %s before calling Ahrefs', async (_label, input) => {
    const fetchImpl = respond({})
    await expect(fetchDomainRatings({ ...input, fetchImpl })).rejects.toMatchObject({
      code: 'ahrefs_invalid_request'
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'ahrefs_unauthorized'],
    [403, 'ahrefs_unauthorized'],
    [429, 'ahrefs_rate_limited'],
    [500, 'ahrefs_http_error']
  ])('maps HTTP %s to %s', async (status, code) => {
    await expect(
      fetchDomainRatings({
        apiKey: 'k',
        domains: ['a.com'],
        fetchImpl: respond({ error: 'details' }, status)
      })
    ).rejects.toEqual(new AhrefsError(code as AhrefsError['code']))
  })

  it('maps network failures and malformed or oversized responses', async () => {
    await expect(
      fetchDomainRatings({
        apiKey: 'k',
        domains: ['a.com'],
        fetchImpl: async () => {
          throw new TypeError('network')
        }
      })
    ).rejects.toMatchObject({ code: 'ahrefs_network_error' })

    for (const body of [
      'not json',
      JSON.stringify({ domain_rating: { targets: [{ target: 'a.com' }] } }),
      JSON.stringify({
        domain_rating: { targets: [{ target: 'a.com', domain_rating: 101 }] }
      }),
      ' '.repeat(1024 * 1024 + 1)
    ]) {
      await expect(
        fetchDomainRatings({
          apiKey: 'k',
          domains: ['a.com'],
          fetchImpl: async () => new Response(body)
        })
      ).rejects.toMatchObject({ code: 'ahrefs_response_error' })
    }
  })
})
