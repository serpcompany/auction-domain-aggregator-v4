import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DomainRatingsProvider,
  PendingRating,
  PendingRatingBadge
} from '@/components/auctions/domain-ratings'

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

function renderRatings(domains: string[]) {
  return render(
    <DomainRatingsProvider domains={domains}>
      <p>
        <PendingRating domain="a.com">not collected</PendingRating>
      </p>
      <PendingRatingBadge domain="a.com" />
      <p>
        <PendingRating domain="other.com">stored</PendingRating>
      </p>
    </DomainRatingsProvider>
  )
}

describe('DomainRatingsProvider', () => {
  it('shows a spinner while Ahrefs is asked, then refreshes after a store', async () => {
    let resolve = (_: Response) => {}
    const fetchMock = stubFetch(() => new Promise<Response>(done => (resolve = done)))
    renderRatings(['a.com', 'b.net'])

    expect(screen.getAllByRole('status', { name: 'Fetching Domain Rating' })).toHaveLength(2)
    expect(screen.getByText('stored')).toBeInTheDocument()
    expect(screen.getByTitle('Domain Rating by Ahrefs')).toHaveTextContent('DR')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/enrichment/domain-rating')
    expect(JSON.parse(String(init.body))).toEqual({ domains: ['a.com', 'b.net'] })

    await act(async () => resolve(Response.json({ status: 'ok', requested: 2, stored: 2 })))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(screen.queryByRole('status', { name: 'Fetching Domain Rating' })).not.toBeInTheDocument()
    expect(screen.getByText('not collected')).toBeInTheDocument()
  })

  it('does nothing when every shown domain already has DR', () => {
    const fetchMock = stubFetch(async () => Response.json({}))
    renderRatings([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('not collected')).toBeInTheDocument()
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
  ])('stops the spinner without a refresh when %s', async (_label, response) => {
    const fetchMock = stubFetch(response)
    renderRatings(['a.com'])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByText('not collected')).toBeInTheDocument())
    expect(refresh).not.toHaveBeenCalled()
  })

  it('abandons a request when the shown rows change', async () => {
    let rejectOnAbort = () => {}
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          rejectOnAbort = () => reject(new DOMException('aborted', 'AbortError'))
          init.signal?.addEventListener('abort', () => rejectOnAbort())
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = renderRatings(['a.com'])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const signal = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => {})
    expect(refresh).not.toHaveBeenCalled()
  })
})
