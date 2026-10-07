import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AuctionsPage, ListingCount, Results } from '@/components/auctions/auctions-page'
import { fullRow, now } from '@/components/auctions/test-rows'
import { parseDomainTableFilters } from '@/domain/domain-table'
import { DEFAULT_COLUMNS } from '@/domain/table-columns'
import type { DomainListingsResult, InventoryStatus } from '@/server/queries/domain-listings'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
beforeAll(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ stored: 0 }))
  )
)
afterEach(cleanup)

const status = (overrides: Partial<InventoryStatus> = {}): InventoryStatus => ({
  sources: ['dynadot'],
  auctionTypes: ['expired'],
  tlds: ['com'],
  latestSuccessfulSync: new Date(now.getTime() - 60_000),
  ...overrides
})

const result = (overrides: Partial<DomainListingsResult> = {}): DomainListingsResult => ({
  rows: [fullRow],
  total: 1,
  page: 1,
  ...status(),
  ...overrides
})

// The async parts are server components; render what they resolve to.
async function renderResults(
  params: Record<string, string>,
  overrides = {},
  columns = DEFAULT_COLUMNS
) {
  render(
    await Results({
      result: Promise.resolve(result(overrides)),
      filters: parseDomainTableFilters(params),
      visibleColumns: columns,
      now
    })
  )
}

describe('AuctionsPage', () => {
  it('renders the toolbar and a skeleton while the listings load', () => {
    render(
      <AuctionsPage
        filters={parseDomainTableFilters({})}
        status={status()}
        result={new Promise(() => {})}
        visibleColumns={DEFAULT_COLUMNS}
        now={now}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Auctions' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Domain contains' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading listings')
    expect(screen.getByTestId('results-skeleton')).toBeInTheDocument()
    expect(screen.queryByText(/out of date/)).not.toBeInTheDocument()
  })

  it('warns when the inventory is stale', () => {
    render(
      <AuctionsPage
        filters={parseDomainTableFilters({})}
        status={status({ latestSuccessfulSync: new Date(now.getTime() - 2 * 86_400_000) })}
        result={new Promise(() => {})}
        visibleColumns={DEFAULT_COLUMNS}
        now={now}
      />
    )
    const alert = screen
      .getAllByRole('status')
      .find(node => node.textContent?.includes('out of date'))
    expect(alert).toHaveTextContent('The inventory is out of date')
    expect(alert).toHaveTextContent('Synced 2 days ago. Ended auctions are hidden')
  })

  it('counts the listings', async () => {
    render(await ListingCount({ result: Promise.resolve(result({ total: 857_412 })) }))
    expect(screen.getByText('857,412')).toBeInTheDocument()
    expect(screen.getByText('listings')).toBeInTheDocument()
    cleanup()
    render(await ListingCount({ result: Promise.resolve(result()) }))
    expect(screen.getByText('listing')).toBeInTheDocument()
  })

  it('shows the keyboard-scrollable table, the phone list, and pagination', async () => {
    await renderResults({ page: '9' })

    const region = screen.getByTestId('domain-results-scroll-container')
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Domain results' })).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
  })

  it('asks Ahrefs only for missing ratings, and only while DR is shown', async () => {
    const fetchMock = vi.fn(async () => Response.json({ stored: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    const rows = [fullRow, { ...fullRow, domainName: 'new.com', domainRatingFetched: false }]
    await renderResults({}, { rows })
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/enrichment/domain-rating',
        expect.objectContaining({ body: JSON.stringify({ domains: ['new.com'] }) })
      )
    )
    cleanup()
    fetchMock.mockClear()
    await renderResults({}, { rows }, ['price'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offers Clear all filters and Edit filters when filters match nothing', async () => {
    await renderResults({ tld: 'io', bidsMin: '3', sort: 'price' }, { rows: [], total: 0 })

    expect(
      screen.getByRole('heading', { name: 'No listings match these filters' })
    ).toBeInTheDocument()
    expect(screen.getByText(/meets all 2 filters/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clear all filters' })).toHaveAttribute(
      'href',
      '/?sort=price&direction=asc&page=1'
    )
    expect(screen.getByRole('link', { name: 'Edit filters' })).toHaveAttribute(
      'href',
      '/filters/?tld=io&bidsMin=3&sort=price&direction=asc&page=1'
    )
    cleanup()
    await renderResults({ tld: 'io' }, { rows: [], total: 0 })
    expect(screen.getByText(/meets all 1 filter\./)).toBeInTheDocument()
  })

  it('points a fresh database at a sync with the command to copy', async () => {
    await renderResults({}, { rows: [], total: 0 })

    expect(screen.getByRole('heading', { name: 'No auctions collected yet' })).toBeInTheDocument()
    expect(screen.getByText('corepack pnpm sync godaddy')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Clear all filters' })).not.toBeInTheDocument()
  })
})
