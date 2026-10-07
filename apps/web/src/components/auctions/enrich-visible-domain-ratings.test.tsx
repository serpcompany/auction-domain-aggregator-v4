import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnrichVisibleDomainRatings } from '@/components/auctions/enrich-visible-domain-ratings'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

afterEach(() => {
  cleanup()
  refresh.mockReset()
  vi.unstubAllGlobals()
})

function stubFetch(response: () => Promise<Response>) {
  const fetchMock = vi.fn(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('EnrichVisibleDomainRatings', () => {
  it('posts the missing domains once and refreshes after a store', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({ status: 'ok', requested: 2, stored: 2 })
    )

    render(<EnrichVisibleDomainRatings domains={['a.com', 'b.net']} />)

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/enrichment/domain-rating')
    expect(JSON.parse(String(init.body))).toEqual({
      domains: ['a.com', 'b.net']
    })
  })

  it('does nothing when every visible domain already has DR', () => {
    const fetchMock = stubFetch(async () => Response.json({}))
    render(<EnrichVisibleDomainRatings domains={[]} />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['nothing was stored', async () => Response.json({ stored: 0 })],
    ['the route failed', async () => Response.json({ status: 'failed' }, { status: 503 })],
    [
      'the request threw',
      async () => {
        throw new Error('offline')
      }
    ]
  ])('does not refresh when %s', async (_label, response) => {
    const fetchMock = stubFetch(response)
    render(<EnrichVisibleDomainRatings domains={['a.com']} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(refresh).not.toHaveBeenCalled()
  })
})
