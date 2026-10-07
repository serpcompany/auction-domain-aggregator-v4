import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AuctionsPage } from '@/components/auctions/auctions-page'
import { fullRow, now } from '@/components/auctions/test-rows'
import { parseDomainTableFilters } from '@/domain/domain-table'
import { DEFAULT_COLUMNS } from '@/domain/table-columns'
import type { DomainListingsResult } from '@/server/queries/domain-listings'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
beforeAll(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ stored: 0 }))
  )
)
afterEach(cleanup)

const result = (overrides: Partial<DomainListingsResult> = {}): DomainListingsResult => ({
  rows: [fullRow],
  total: 1,
  page: 1,
  sources: ['dynadot'],
  auctionTypes: ['expired'],
  tlds: ['com'],
  latestSuccessfulSync: new Date(now.getTime() - 60_000),
  ...overrides
})

function renderPage(params: Record<string, string> = {}, overrides = {}) {
  render(
    <AuctionsPage
      filters={parseDomainTableFilters(params)}
      result={result(overrides)}
      visibleColumns={DEFAULT_COLUMNS}
      now={now}
    />
  )
}

describe('AuctionsPage', () => {
  it('composes the toolbar, the keyboard-scrollable results, and pagination', () => {
    renderPage({ page: '9' })

    expect(screen.getByRole('heading', { level: 1, name: 'Auctions' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Domain contains' })).toBeInTheDocument()
    const region = screen.getByRole('region', { name: 'Domain results' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Domain results' })).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
    expect(screen.queryByText(/out of date/)).not.toBeInTheDocument()
  })

  it('warns when the inventory is stale', () => {
    renderPage({}, { latestSuccessfulSync: new Date(now.getTime() - 2 * 86_400_000) })
    expect(screen.getByRole('status')).toHaveTextContent('The inventory is out of date')
  })

  it('offers Clear all filters when filters match nothing', () => {
    renderPage({ tld: 'io', sort: 'price' }, { rows: [], total: 0 })

    expect(screen.getByRole('heading', { name: 'No domains found' })).toBeInTheDocument()
    expect(screen.getByText(/No listings match all applied filters/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clear all filters' })).toHaveAttribute(
      'href',
      '/?sort=price&direction=asc&page=1'
    )
  })

  it('points a fresh database at a sync', () => {
    renderPage({}, { rows: [], total: 0 })

    expect(screen.getByText(/run a local sync first/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Clear all filters' })).not.toBeInTheDocument()
  })
})
