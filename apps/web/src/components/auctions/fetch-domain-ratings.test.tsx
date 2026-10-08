import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FetchDomainRatingsButton } from '@/components/auctions/fetch-domain-ratings'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
const refresh = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const search = 'majesticTfMin=25&sort=endsAt&direction=asc&page=1'

async function click(total = 481) {
  render(<FetchDomainRatingsButton total={total} limit={1_000} search={search} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Fetch DR' }))
  })
}

describe('FetchDomainRatingsButton', () => {
  it('shows nothing when no listing matches', () => {
    render(<FetchDomainRatingsButton total={0} limit={1_000} search={search} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('asks for narrower filters past the limit, without calling the server', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await click(1_001)
    expect(toast.info).toHaveBeenCalledWith(
      'Narrow the filters to 1,000 listings or fewer to fetch DR.'
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('posts the filters, waits while Ahrefs answers, then re-renders with the ratings', async () => {
    let answer: (response: Response) => void = () => {}
    const fetch = vi.fn(() => new Promise<Response>(resolve => (answer = resolve)))
    vi.stubGlobal('fetch', fetch)
    await click()

    expect(fetch).toHaveBeenCalledWith('/api/enrichment/domain-rating/matching', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ search })
    })
    expect(screen.getByRole('button', { name: /Fetch DR/ })).toBeDisabled()

    await act(async () => answer(Response.json({ status: 'ok', requested: 431, stored: 431 })))
    expect(toast.success).toHaveBeenCalledWith('Fetched DR for 431 domains.')
    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Fetch DR' })).toBeEnabled()
  })

  it('says when every matching domain already has DR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'ok', stored: 0 }))
    )
    await click()
    expect(toast.success).toHaveBeenCalledWith('Every matching domain already has DR.')
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([
    ['too_many_listings', 'Too many matching listings. Narrow the filters and try again.'],
    ['ahrefs_cool_down', 'Ahrefs asked for a pause. Try again in a minute.'],
    ['ahrefs_unauthorized', 'Ahrefs did not answer. Try again later.'],
    [undefined, 'Ahrefs did not answer. Try again later.']
  ])('explains a %s failure', async (errorCode, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'failed', errorCode }, { status: 400 }))
    )
    await click()
    expect(toast.error).toHaveBeenCalledWith(message)
  })

  it('reports a request that never reaches the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      })
    )
    await click()
    expect(toast.error).toHaveBeenCalledWith('Ahrefs did not answer. Try again later.')
  })
})
