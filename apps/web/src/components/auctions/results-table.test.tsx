import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ResultsTable } from '@/components/auctions/results-table'
import { emptyRow, fullRow, now } from '@/components/auctions/test-rows'
import { parseDomainTableFilters } from '@/domain/domain-table'
import { DEFAULT_COLUMNS, TABLE_COLUMNS } from '@/domain/table-columns'

const fetchMock = vi.fn(async () => Response.json({ status: 'ok', stored: 0 }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
beforeAll(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  cleanup()
  fetchMock.mockClear()
})

const allColumns = TABLE_COLUMNS.map(column => column.key)
const filters = parseDomainTableFilters({ sort: 'price', direction: 'desc', tld: 'com' })

function cells(rowIndex: number) {
  const row = screen.getAllByRole('row')[rowIndex]
  return within(row)
    .getAllByRole('cell')
    .map(cell => cell.textContent)
}

describe('ResultsTable', () => {
  it('renders the default columns with grouped metric headers', () => {
    render(
      <ResultsTable rows={[fullRow]} filters={filters} visibleColumns={DEFAULT_COLUMNS} now={now} />
    )

    const headers = screen.getAllByRole('columnheader').map(header => header.textContent)
    expect(headers).toEqual([
      'Domain',
      'Source',
      'Price',
      'Bids',
      'Ends',
      'Age',
      'Links',
      'Appraisal',
      'Majestic',
      'Semrush',
      'Domain Ratingby Ahrefs',
      'Details',
      'TF',
      'CF',
      'AS',
      'DR'
    ])
    expect(screen.getByRole('link', { name: 'Domain Rating by Ahrefs' })).toHaveAttribute(
      'href',
      'https://ahrefs.com/'
    )
    expect(screen.getByRole('columnheader', { name: 'Price' })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
    expect(screen.getByRole('link', { name: 'Price' })).toHaveAttribute(
      'href',
      '/?tld=com&sort=price&direction=asc&page=1'
    )
    expect(screen.getByRole('link', { name: 'Bids' })).toHaveAttribute(
      'href',
      '/?tld=com&sort=bids&direction=asc&page=1'
    )
  })

  it('renders every value of a full row on one line, opening the auction in a new tab', () => {
    render(
      <ResultsTable rows={[fullRow]} filters={filters} visibleColumns={allColumns} now={now} />
    )

    expect(cells(2)).toEqual([
      'garden-example.com (opens auction in a new tab)',
      'Dynadot · Expired',
      '$12.50',
      '3',
      '30mJul 13, 10:30 UTC',
      '12 yrs',
      '1.5K (1,500)',
      '$2,000',
      '$10.88',
      '20',
      '18',
      '12',
      '15',
      '28',
      '33',
      '42',
      ''
    ])
    const domain = screen.getByRole('link', { name: /garden-example\.com/ })
    expect(domain).toHaveAttribute('target', '_blank')
    expect(domain).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('30m')).toHaveClass('text-destructive')
    expect(screen.getByTitle('Dynadot appraisal')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Details for garden-example.com' })
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows unknown values as not collected', () => {
    render(
      <ResultsTable rows={[emptyRow]} filters={filters} visibleColumns={allColumns} now={now} />
    )

    expect(cells(2)).toEqual([
      'fresh2example.net (opens auction in a new tab)',
      'GoDaddy · Auction',
      '$9.99',
      '1',
      '2d 2hJul 15, 12:00 UTC',
      '—Not collected',
      '—Not collected',
      '—Not collected',
      '—Not collected',
      '—Not collected',
      '17',
      '—Not collected',
      '—Not collected',
      '—Not collected',
      '—Not collected',
      '—Not collected',
      ''
    ])
  })

  it('says when Ahrefs has no rating, and when a row ends within a day', () => {
    render(
      <ResultsTable
        rows={[
          {
            ...emptyRow,
            domainRatingFetched: true,
            ageYears: null,
            endsAt: new Date('2026-07-13T20:00:00.000Z')
          }
        ]}
        filters={filters}
        visibleColumns={['ends', 'age', 'domainRating']}
        now={now}
      />
    )

    expect(screen.getByTitle('Ahrefs has no rating for this domain')).toHaveTextContent(
      'No Ahrefs Domain Rating'
    )
    expect(screen.getByText(/^10h/)).toHaveClass('text-warning-foreground')
  })

  it('drops hidden columns and their group headers', () => {
    render(
      <ResultsTable
        rows={[emptyRow]}
        filters={filters}
        visibleColumns={['renewal', 'majesticRefDomains']}
        now={now}
      />
    )

    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Domain',
      'Renewal',
      'Majestic',
      'Details',
      'Ref. dom.'
    ])
    expect(screen.getByRole('link', { name: 'Renewal' })).toHaveAttribute(
      'href',
      '/?tld=com&sort=renewal&direction=asc&page=1'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sorts by every metric column, Ahrefs DR included', () => {
    render(
      <ResultsTable
        rows={[fullRow]}
        filters={parseDomainTableFilters({ sort: 'domainRating', direction: 'desc' })}
        visibleColumns={allColumns}
        now={now}
      />
    )

    const dr = screen.getByRole('columnheader', { name: 'DR' })
    expect(dr).toHaveAttribute('aria-sort', 'descending')
    expect(within(dr).getByRole('link')).toHaveAttribute(
      'href',
      '/?sort=domainRating&direction=asc&page=1'
    )
    for (const [label, sort] of [
      ['TF', 'majesticTf'],
      ['CF', 'majesticCf'],
      ['Ref. dom.', 'majesticRefDomains'],
      ['AS', 'semrushAs']
    ]) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute(
        'href',
        `/?sort=${sort}&direction=desc&page=1`
      )
    }
  })

  it('uses the singular for a one-year-old domain', () => {
    render(
      <ResultsTable
        rows={[{ ...fullRow, ageYears: 1 }]}
        filters={filters}
        visibleColumns={['age']}
        now={now}
      />
    )
    expect(screen.getByText('1 yr')).toBeInTheDocument()
  })

  it('uses one header row when no metric column is shown', () => {
    render(<ResultsTable rows={[fullRow]} filters={filters} visibleColumns={[]} now={now} />)

    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('columnheader', { name: 'Domain' })).toHaveAttribute('rowspan', '1')
    expect(screen.getByRole('columnheader', { name: 'Domain' })).not.toHaveAttribute('aria-sort')
  })

  it('sorts ascending from the active column and marks the domain sort', () => {
    render(
      <ResultsTable
        rows={[fullRow]}
        filters={parseDomainTableFilters({ sort: 'domain', direction: 'asc' })}
        visibleColumns={['price']}
        now={now}
      />
    )

    expect(screen.getByRole('columnheader', { name: 'Domain' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
    expect(screen.getByRole('link', { name: 'Domain' })).toHaveAttribute(
      'href',
      '/?sort=domain&direction=desc&page=1'
    )
  })
})
