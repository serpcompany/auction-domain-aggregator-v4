import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DOMAIN_RATING_PAGE_BATCH,
  DomainRatingsProvider,
  PendingRating,
  PendingRatingBadge
} from '@/components/auctions/domain-ratings'
import { TableLayoutProvider, useVisibleColumns } from '@/components/auctions/table-layout'
import { DOMAIN_TABLE_PAGE_SIZE } from '@/domain/domain-table'
import { type ColumnKey, DEFAULT_COLUMNS } from '@/domain/table-columns'
import { DOMAIN_RATING_REQUEST_LIMIT } from '@/server/enrichment/domain-rating'

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

function ShowDomainRating() {
  const { toggle } = useVisibleColumns()
  return (
    <button type="button" onClick={() => toggle('domainRating', true)}>
      Show DR
    </button>
  )
}

function renderRatings(domains: string[], columns: readonly ColumnKey[] = DEFAULT_COLUMNS) {
  return render(
    <TableLayoutProvider initialColumns={columns} initialWidths={{}}>
      <DomainRatingsProvider domains={domains}>
        <p>
          <PendingRating domain="a.com">not collected</PendingRating>
        </p>
        <PendingRatingBadge domain="a.com" />
        <p>
          <PendingRating domain="other.com">stored</PendingRating>
        </p>
        <ShowDomainRating />
      </DomainRatingsProvider>
    </TableLayoutProvider>
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

  it('waits while DR is hidden, and asks once the browser shows it again', async () => {
    const fetchMock = stubFetch(async () => Response.json({ stored: 0 }))
    renderRatings(['a.com'], ['price'])
    expect(screen.getByText('not collected')).toBeInTheDocument()
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Show DR' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(refresh).not.toHaveBeenCalled()
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

  it('fits a full page in two requests under the route limit', () => {
    expect(DOMAIN_RATING_PAGE_BATCH).toBeLessThanOrEqual(DOMAIN_RATING_REQUEST_LIMIT)
    expect(Math.ceil(DOMAIN_TABLE_PAGE_SIZE / DOMAIN_RATING_PAGE_BATCH)).toBe(2)
  })

  it('sends a full page in two requests and refreshes once, after both settle', async () => {
    const answers: Array<(response: Response) => void> = []
    const fetchMock = stubFetch(() => new Promise<Response>(done => answers.push(done)))
    const page = [
      'a.com',
      ...Array.from({ length: DOMAIN_TABLE_PAGE_SIZE - 1 }, (_, index) => `d${index}.com`)
    ]
    renderRatings(page)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const sent = fetchMock.mock.calls.map(
      call => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).domains
    )
    expect(sent).toEqual([page.slice(0, 48), page.slice(48)])

    await act(async () => answers[0]?.(Response.json({ stored: 48 })))
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getAllByRole('status', { name: 'Fetching Domain Rating' })).toHaveLength(2)

    await act(async () => answers[1]?.(Response.json({ stored: 0 })))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(screen.queryByRole('status', { name: 'Fetching Domain Rating' })).not.toBeInTheDocument()
  })

  it('does not refresh when neither request of a page stored a rating', async () => {
    const fetchMock = stubFetch(async () => Response.json({ stored: 0 }))
    renderRatings(Array.from({ length: 60 }, (_, index) => `d${index}.com`))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('not collected')).toBeInTheDocument())
    expect(refresh).not.toHaveBeenCalled()
  })

  it('aborts every request of a page when the shown rows change', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const view = renderRatings(Array.from({ length: 96 }, (_, index) => `d${index}.com`))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    view.unmount()
    for (const call of fetchMock.mock.calls) expect(call[1].signal?.aborted).toBe(true)
    await act(async () => {})
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
