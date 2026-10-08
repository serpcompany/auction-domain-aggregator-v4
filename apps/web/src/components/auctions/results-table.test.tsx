import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DomainRatingAttribution, ResultsTable } from '@/components/auctions/results-table'
import { TableLayoutProvider } from '@/components/auctions/table-layout'
import { emptyRow, fullRow, now } from '@/components/auctions/test-rows'
import { TooltipProvider } from '@/components/ui/tooltip'
import { parseDomainTableFilters } from '@/domain/domain-table'
import {
  type ColumnKey,
  type ColumnWidths,
  DEFAULT_COLUMNS,
  TABLE_COLUMNS
} from '@/domain/table-columns'
import type { DomainListingRow } from '@/server/queries/domain-listings'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
const fetchMock = vi.fn(async () => Response.json({ status: 'ok', stored: 0 }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock)
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
})
beforeEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie the menus write.
  document.cookie = 'columns=; max-age=0; path=/'
})
afterEach(() => {
  cleanup()
  fetchMock.mockClear()
  refresh.mockClear()
})

const allColumns = TABLE_COLUMNS.map(column => column.key)
const filters = parseDomainTableFilters({ sort: 'price', direction: 'desc', tld: 'com' })

function renderTable({
  rows = [fullRow],
  tableFilters = filters,
  columns = DEFAULT_COLUMNS,
  widths = {}
}: {
  rows?: DomainListingRow[]
  tableFilters?: typeof filters
  columns?: readonly ColumnKey[]
  widths?: ColumnWidths
} = {}) {
  return render(
    <TooltipProvider>
      <TableLayoutProvider initialColumns={columns} initialWidths={widths}>
        <ResultsTable rows={rows} filters={tableFilters} now={now} />
        <DomainRatingAttribution />
      </TableLayoutProvider>
    </TooltipProvider>
  )
}

function headers() {
  return screen.getAllByRole('columnheader').map(header => header.textContent)
}

function cells(rowIndex: number) {
  const row = screen.getAllByRole('row')[rowIndex]
  return within(row)
    .getAllByRole('cell')
    .map(cell => cell.textContent)
}

async function openMenu(header: string) {
  const trigger = within(screen.getByRole('columnheader', { name: header })).getByRole('button')
  fireEvent.click(trigger)
  return screen.findByRole('menu')
}

describe('ResultsTable', () => {
  it('renders the default columns in one header row, with the DR attribution below', () => {
    renderTable()

    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(headers()).toEqual([
      'Domain',
      'Source',
      'Type',
      'Price',
      'Bids',
      'Ends',
      'Age',
      'Links',
      'Appraisal',
      'TF',
      'CF',
      'DR',
      'Details'
    ])
    expect(screen.getByRole('link', { name: 'Domain Rating by Ahrefs' })).toHaveAttribute(
      'href',
      'https://ahrefs.com/'
    )
    expect(screen.getByRole('columnheader', { name: 'Price' })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
    expect(screen.getByRole('columnheader', { name: 'Bids' })).not.toHaveAttribute('aria-sort')
    // Each header is a menu button; its resize handle stays out of its name.
    expect(
      within(screen.getByRole('columnheader', { name: 'Price' })).getByRole('button', {
        name: 'Price'
      })
    ).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('names short metric labels in tooltips', async () => {
    renderTable({ columns: allColumns })

    const trigger = within(screen.getByRole('columnheader', { name: 'TF' })).getByRole('button')
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    fireEvent.mouseEnter(trigger)
    fireEvent.mouseMove(trigger)
    expect(await screen.findByText('Majestic Trust Flow')).toBeInTheDocument()
  })

  it('sorts from the header menu with links, marking the current order', async () => {
    renderTable()

    const menu = await openMenu('Price')
    expect(within(menu).getByRole('menuitem', { name: 'Sort ascending' })).toHaveAttribute(
      'href',
      '/?tld=com&sort=price&direction=asc&page=1'
    )
    const current = within(menu).getByRole('menuitem', { name: 'Sort descending Current order' })
    expect(current).toHaveAttribute('aria-disabled', 'true')
    expect(current).not.toHaveAttribute('href')
    expect(within(menu).getByRole('menuitem', { name: 'Hide column' })).toBeInTheDocument()
  })

  it('links both orders for a column the table is not sorted by', async () => {
    renderTable()

    const menu = await openMenu('Bids')
    expect(within(menu).getByRole('menuitem', { name: 'Sort ascending' })).toHaveAttribute(
      'href',
      '/?tld=com&sort=bids&direction=asc&page=1'
    )
    expect(within(menu).getByRole('menuitem', { name: 'Sort descending' })).toHaveAttribute(
      'href',
      '/?tld=com&sort=bids&direction=desc&page=1'
    )
  })

  it("gives Domain's menu sorting only", async () => {
    renderTable({ tableFilters: parseDomainTableFilters({ sort: 'domain', direction: 'asc' }) })

    expect(screen.getByRole('columnheader', { name: 'Domain' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
    const menu = await openMenu('Domain')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map(item => item.textContent)
    ).toEqual(['Sort ascending', 'Sort descending'])
    expect(within(menu).getByRole('menuitem', { name: 'Sort descending' })).toHaveAttribute(
      'href',
      '/?sort=domain&direction=desc&page=1'
    )
  })

  it('hides a column in the browser only, saving the cookie without a refresh', async () => {
    renderTable()

    const menu = await openMenu('Bids')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }))
    expect(screen.queryByRole('columnheader', { name: 'Bids' })).not.toBeInTheDocument()
    expect(document.cookie).toContain(
      'columns=source,type,price,ends,age,links,appraisal,majesticTf,majesticCf,domainRating'
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows and hides columns from the Columns submenu, DR attribution included', async () => {
    renderTable()

    const menu = await openMenu('Price')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Columns' }))
    const domain = await screen.findByRole('menuitemcheckbox', { name: 'Domain Always shown' })
    expect(domain).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Renewal Off by default' }))
    expect(screen.getByRole('columnheader', { name: 'Renewal' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Domain Rating Ahrefs' }))
    expect(screen.queryByRole('columnheader', { name: 'DR' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Domain Rating by Ahrefs' })).not.toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('keeps a press on the resize handle from opening the menu', () => {
    renderTable()

    const handle = screen.getByRole('separator', { name: 'Resize Price column' })
    act(() => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 100 })
      fireEvent.pointerUp(window)
      fireEvent.click(handle)
      fireEvent.keyDown(handle, { key: 'Enter' })
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders every value of a full row on one line, opening the auction in a new tab', () => {
    renderTable({ columns: allColumns })

    expect(cells(1)).toEqual([
      'garden-example.com (opens auction in a new tab)',
      'Dynadot',
      'Expired',
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
    renderTable({ rows: [emptyRow], columns: allColumns })

    expect(cells(1)).toEqual([
      'fresh2example.net (opens auction in a new tab)',
      'GoDaddy',
      'Auction',
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
    renderTable({
      rows: [
        {
          ...emptyRow,
          domainRatingFetched: true,
          ageYears: null,
          endsAt: new Date('2026-07-13T20:00:00.000Z')
        }
      ],
      columns: ['ends', 'age', 'domainRating']
    })

    expect(screen.getByTitle('Ahrefs has no rating for this domain')).toHaveTextContent(
      'No Ahrefs Domain Rating'
    )
    expect(screen.getByText(/^10h/)).toHaveClass('text-warning-foreground')
  })

  it('uses the singular for a one-year-old domain', () => {
    renderTable({ rows: [{ ...fullRow, ageYears: 1 }], columns: ['age'] })
    expect(screen.getByText('1 yr')).toBeInTheDocument()
  })

  it('shows Domain alone, without the DR attribution, when every column is hidden', () => {
    renderTable({ columns: [] })

    expect(headers()).toEqual(['Domain', 'Details'])
    expect(screen.queryByRole('link', { name: 'Domain Rating by Ahrefs' })).not.toBeInTheDocument()
  })

  it('lays the columns out at their saved widths, each with a resize handle', () => {
    const { container } = renderTable({
      columns: ['price', 'links', 'majesticTf'],
      widths: { price: 150 }
    })

    const widths = [...container.querySelectorAll('col')].map(col => col.style.width)
    expect(widths).toEqual([
      'var(--column-domain-width, 240px)',
      'var(--column-price-width, 80px)',
      'var(--column-links-width, 72px)',
      'var(--column-majesticTf-width, 56px)',
      // Details takes the space the others leave.
      ''
    ])
    expect(container.querySelector('table')).toHaveClass('table-fixed')
    expect(
      screen
        .getAllByRole('separator')
        .map(handle => [handle.getAttribute('aria-label'), handle.getAttribute('aria-valuenow')])
    ).toEqual([
      ['Resize Domain column', '240'],
      ['Resize Price column', '150'],
      ['Resize Inbound links column', '72'],
      ['Resize Majestic Trust Flow column', '56']
    ])
    // The handles stay out of the header names.
    for (const name of ['Domain', 'Price', 'Links', 'TF']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
  })
})
