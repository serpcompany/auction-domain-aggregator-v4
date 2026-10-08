import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ListingDetailsProvider } from '@/components/auctions/listing-details'
import { DomainRatingAttribution, ResultsTable } from '@/components/auctions/results-table'
import { RowSelectionProvider, SelectionBar } from '@/components/auctions/row-selection'
import { TableLayoutProvider } from '@/components/auctions/table-layout'
import { emptyRow, fullRow, now } from '@/components/auctions/test-rows'
import { TooltipProvider } from '@/components/ui/tooltip'
import { listingKey, parseDomainTableFilters } from '@/domain/domain-table'
import {
  type ColumnKey,
  type ColumnLayout,
  type ColumnWidths,
  DEFAULT_COLUMN_LAYOUT,
  DEFAULT_COLUMNS,
  parseColumnLayout,
  TABLE_COLUMNS
} from '@/domain/table-columns'
import type { DomainListingRow } from '@/server/queries/domain-listings'

const { refresh, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
vi.mock('sonner', () => ({ toast }))
const fetchMock = vi.fn(async () => Response.json({ status: 'ok', stored: 0 }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock)
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
})
beforeEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie the menus write.
  document.cookie = 'columns=; max-age=0; path=/'
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie the menus write.
  document.cookie = 'column-layout=; max-age=0; path=/'
})
afterEach(() => {
  cleanup()
  fetchMock.mockClear()
  refresh.mockClear()
  toast.mockClear()
  toast.success.mockClear()
})

const allColumns = TABLE_COLUMNS.map(column => column.key)
const filters = parseDomainTableFilters({ sort: 'price', direction: 'desc', tld: 'com' })

function renderTable({
  rows = [fullRow],
  tableFilters = filters,
  columns = DEFAULT_COLUMNS,
  layout = DEFAULT_COLUMN_LAYOUT,
  widths = {}
}: {
  rows?: DomainListingRow[]
  tableFilters?: typeof filters
  columns?: readonly ColumnKey[]
  layout?: ColumnLayout
  widths?: ColumnWidths
} = {}) {
  return render(
    <TooltipProvider>
      <TableLayoutProvider initialColumns={columns} initialLayout={layout} initialWidths={widths}>
        <ListingDetailsProvider now={now}>
          <RowSelectionProvider rowKeys={rows.map(listingKey)}>
            <SelectionBar />
            <ResultsTable rows={rows} filters={tableFilters} now={now} />
            <DomainRatingAttribution />
          </RowSelectionProvider>
        </ListingDetailsProvider>
      </TableLayoutProvider>
    </TooltipProvider>
  )
}

function cookie(name: string) {
  return document.cookie
    .split('; ')
    .find(entry => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1)
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
      '',
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
      'Actions'
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
      '',
      'garden-example.com (opens auction in a new tab)',
      'Dynadot',
      'Expired',
      '$12.50',
      '3',
      '30m (Ends Jul 13, 10:30 UTC)',
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
    expect(screen.getByText('30m').closest('time')).toHaveAttribute('data-state', 'soon')
    expect(screen.getByText('30m').closest('time')).toHaveClass('bg-warning')
    expect(screen.getByText('Dynadot').previousElementSibling).toHaveClass('bg-provider-dynadot')
    expect(screen.getByText('Expired').closest('[data-slot=badge]')).toBeInTheDocument()
    expect(screen.getByTitle('Domain Rating by Ahrefs')).toHaveAttribute('data-fill', '42')
    expect(screen.getByTitle('Dynadot appraisal')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Actions for garden-example.com' })
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows unknown values as not collected', () => {
    renderTable({ rows: [emptyRow], columns: allColumns })

    expect(cells(1)).toEqual([
      '',
      'fresh2example.net (opens auction in a new tab)',
      'GoDaddy',
      'Auction',
      '$9.99',
      '1',
      '2d 2h (Ends Jul 15, 12:00 UTC)',
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

  it('says when Ahrefs has no rating, and marks a row ending within two days', () => {
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
    expect(screen.getByText(/^10h/).closest('time')).toHaveClass('text-warning-foreground')
  })

  it('keeps the countdown neutral from two days on, and marks an ended auction', () => {
    renderTable({
      rows: [
        { ...emptyRow, externalId: 'later', endsAt: new Date('2026-07-15T10:00:00.000Z') },
        { ...fullRow, externalId: 'ended', endsAt: new Date('2026-07-13T09:00:00.000Z') }
      ],
      columns: ['ends']
    })

    const later = screen.getByText('2d').closest('time')
    expect(later).toHaveAttribute('data-state', 'neutral')
    expect(later).not.toHaveClass('bg-warning')
    const ended = screen.getByText('Ended 1h ago').closest('time')
    expect(ended).toHaveAttribute('data-state', 'ended')
    expect(ended).toHaveTextContent('(Ended Jul 13, 09:00 UTC)')
  })

  it('shows the exact end time in the countdown tooltip', async () => {
    renderTable({ columns: ['ends'] })

    const pill = screen.getByText('30m').closest('time') as HTMLElement
    expect(pill).toHaveAttribute('dateTime', '2026-07-13T10:30:00.000Z')
    fireEvent.pointerEnter(pill, { pointerType: 'mouse' })
    fireEvent.mouseEnter(pill)
    fireEvent.mouseMove(pill)
    const tooltip = await screen.findByText('Ends Jul 13, 10:30 UTC', {
      selector: '[data-slot=tooltip-content]'
    })
    expect(tooltip).toBeInTheDocument()
  })

  it.each([
    ['namecheap', 'Namecheap', 'bg-provider-namecheap'],
    ['godaddy', 'GoDaddy', 'bg-provider-godaddy'],
    ['dynadot', 'Dynadot', 'bg-provider-dynadot'],
    ['namesilo', 'NameSilo', 'bg-provider-namesilo'],
    ['dropcatch', 'DropCatch', 'bg-muted-foreground']
  ])('gives a %s Source pill its dot color', (provider, label, dot) => {
    renderTable({ rows: [{ ...fullRow, provider }], columns: ['source'] })
    expect(screen.getByText(label).previousElementSibling).toHaveClass(dot)
  })

  it('fills the DR ring to the rounded rating', () => {
    renderTable({
      rows: [
        { ...fullRow, externalId: 'low', domainRating: 0 },
        { ...emptyRow, externalId: 'high', domainRating: 99.6, domainRatingFetched: true }
      ],
      columns: ['domainRating']
    })

    const rings = screen.getAllByTitle('Domain Rating by Ahrefs')
    expect(rings.map(ring => [ring.textContent, ring.dataset.fill])).toEqual([
      ['0', '0'],
      ['100', '100']
    ])
    expect(rings[1].style.getPropertyValue('--rating-fill')).toBe('100%')
  })

  it('uses the singular for a one-year-old domain', () => {
    renderTable({ rows: [{ ...fullRow, ageYears: 1 }], columns: ['age'] })
    expect(screen.getByText('1 yr')).toBeInTheDocument()
  })

  it('shows Domain alone, without the DR attribution, when every column is hidden', () => {
    renderTable({ columns: [] })

    expect(headers()).toEqual(['', 'Domain', 'Actions'])
    expect(screen.queryByRole('link', { name: 'Domain Rating by Ahrefs' })).not.toBeInTheDocument()
  })

  it('lays the columns out at their saved widths, each with a resize handle', () => {
    const { container } = renderTable({
      columns: ['price', 'links', 'majesticTf'],
      widths: { price: 150 }
    })

    const widths = [...container.querySelectorAll('col')].map(col => col.style.width)
    expect(widths).toEqual([
      '40px',
      'var(--column-domain-width, 192px)',
      'var(--column-price-width, 80px)',
      'var(--column-links-width, 72px)',
      'var(--column-majesticTf-width, 56px)',
      // An empty column takes the space the others leave.
      '',
      '40px'
    ])
    expect(container.querySelector('table')).toHaveClass('table-fixed')
    expect(
      screen
        .getAllByRole('separator')
        .map(handle => [handle.getAttribute('aria-label'), handle.getAttribute('aria-valuenow')])
    ).toEqual([
      ['Resize Domain column', '192'],
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

async function chooseFromMenu(header: string, item: string) {
  const menu = await openMenu(header)
  fireEvent.click(within(menu).getByRole('menuitem', { name: item }))
  await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
}

function menuItemNames(menu: HTMLElement) {
  return within(menu)
    .getAllByRole('menuitem')
    .map(item => [item.textContent, item.getAttribute('aria-disabled') === 'true'])
}

const defaultHeaders = [
  '',
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
  'Actions'
]

describe('ResultsTable layout', () => {
  it('pins a column after Domain from its menu and unpins it in place, in the browser only', async () => {
    renderTable()

    await chooseFromMenu('Price', 'Pin to left')
    expect(headers()).toEqual([
      '',
      'Domain',
      'Price',
      ...defaultHeaders.filter(name => !['', 'Domain', 'Price'].includes(name))
    ])
    const price = screen.getByRole('columnheader', { name: 'Price' })
    expect(price.style.left).toBe('calc(40px + var(--column-domain-width, 192px))')
    expect(price.className).toContain('z-30')
    expect(price.className).toContain('shadow-')
    // Price is the sorted column, so its arrow keeps the indicator slot.
    expect(within(price).queryByRole('img', { name: 'Pinned' })).not.toBeInTheDocument()
    const priceCell = screen.getByText('$12.50').closest('td') as HTMLElement
    expect(priceCell.style.left).toBe('calc(40px + var(--column-domain-width, 192px))')
    expect(priceCell.className).toContain('sticky')
    expect(cookie('column-layout')).toBe(
      `order:${TABLE_COLUMNS.map(column => column.key).join(',')}|left:price`
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    const menu = await openMenu('Price')
    expect(menuItemNames(menu).slice(2, 5)).toEqual([
      ['Unpin', false],
      ['Move left', true],
      ['Move right', true]
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Unpin' }))
    expect(headers()).toEqual(defaultHeaders)
    expect(screen.getByRole('columnheader', { name: 'Price' }).style.left).toBe('')
    expect(cookie('column-layout')).toBe(`order:${TABLE_COLUMNS.map(c => c.key).join(',')}`)
  })

  it('stacks left pins after Domain and right pins before the row actions, edges shadowed', () => {
    renderTable({ layout: parseColumnLayout('left:price,bids|right:links,majesticTf') })

    expect(headers()).toEqual([
      '',
      'Domain',
      'Price',
      'Bids',
      'Source',
      'Type',
      'Ends',
      'Age',
      'Appraisal',
      'CF',
      'DR',
      'Links',
      'TF',
      'Actions'
    ])
    const style = (name: string) => {
      const header = screen.getByRole('columnheader', { name })
      return {
        left: header.style.left,
        right: header.style.right,
        edge: header.className.includes('shadow-')
      }
    }
    expect(style('Domain')).toEqual({ left: '40px', right: '', edge: false })
    expect(style('Price').edge).toBe(false)
    expect(style('Bids')).toEqual({
      left: 'calc(40px + var(--column-domain-width, 192px) + var(--column-price-width, 80px))',
      right: '',
      edge: true
    })
    expect(style('Links')).toEqual({
      left: '',
      right: 'calc(40px + var(--column-majesticTf-width, 56px))',
      edge: true
    })
    expect(style('TF')).toEqual({ left: '', right: '40px', edge: false })
    expect(style('Source')).toEqual({ left: '', right: '', edge: false })
  })

  it('pins to the right, and moves columns past neighbours but not at the ends', async () => {
    renderTable()

    const source = await openMenu('Source')
    expect(menuItemNames(source).slice(2, 6)).toEqual([
      ['Pin to left', false],
      ['Pin to right', false],
      ['Move left', true],
      ['Move right', false]
    ])
    fireEvent.click(within(source).getByRole('menuitem', { name: 'Move left' }))
    fireEvent.click(within(source).getByRole('menuitem', { name: 'Move right' }))
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(headers().slice(2, 4)).toEqual(['Type', 'Source'])
    expect(cookie('column-layout')).toMatch(/^order:type,source,price,/)

    await chooseFromMenu('DR', 'Pin to right')
    expect(headers().slice(-3)).toEqual(['CF', 'DR', 'Actions'])
    const dr = screen.getByRole('columnheader', { name: 'DR' })
    expect(dr.style.right).toBe('40px')
    // An unsorted pinned column's pin takes the place of its idle sort icon.
    expect(within(dr).getByRole('img', { name: 'Pinned' })).toBeInTheDocument()
    expect(dr.querySelector('.lucide-chevrons-up-down')).toBeNull()
    expect(cookie('column-layout')).toMatch(/\|right:domainRating$/)

    // CF is now the last scrolling column.
    const cf = await openMenu('CF')
    expect(menuItemNames(cf).slice(4, 6)).toEqual([
      ['Move left', false],
      ['Move right', true]
    ])
    fireEvent.click(within(cf).getByRole('menuitem', { name: 'Move left' }))
    expect(headers().slice(-4)).toEqual(['CF', 'TF', 'DR', 'Actions'])
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('ResultsTable rows', () => {
  it('selects rows one by one or all at once, with a bar to clear them', async () => {
    renderTable({ rows: [fullRow, emptyRow] })
    const all = screen.getByRole('checkbox', { name: 'Select all rows on this page' })
    const garden = screen.getByRole('checkbox', { name: 'Select garden-example.com' })
    const row = garden.closest('tr') as HTMLElement
    expect(all).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('region', { name: 'Selected rows' })).not.toBeInTheDocument()

    fireEvent.click(garden)
    expect(row).toHaveAttribute('data-state', 'selected')
    expect(all).toHaveAttribute('aria-checked', 'mixed')
    const bar = screen.getByRole('region', { name: 'Selected rows' })
    expect(within(bar).getByRole('status')).toHaveTextContent('1 selected')

    fireEvent.click(all)
    expect(all).toHaveAttribute('aria-checked', 'true')
    expect(within(bar).getByRole('status')).toHaveTextContent('2 selected')
    fireEvent.click(garden)
    expect(row).not.toHaveAttribute('data-state')
    expect(within(bar).getByRole('status')).toHaveTextContent('1 selected')

    fireEvent.click(within(bar).getByRole('button', { name: 'Save to list' }))
    expect(toast).toHaveBeenCalledWith('Saving selected rows to a list comes in a later feature.')
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('region', { name: 'Selected rows' })).not.toBeInTheDocument()
    expect(all).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(all)
    fireEvent.click(all)
    expect(all).toHaveAttribute('aria-checked', 'false')
    expect(refresh).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves the header checkbox clear on an empty page', () => {
    renderTable({ rows: [] })
    expect(screen.getByRole('checkbox', { name: 'Select all rows on this page' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('opens details, the auction, or a copy of the domain from the row menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderTable()
    const open = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actions for garden-example.com' }))
      return screen.findByRole('menu')
    }

    let menu = await open()
    expect(within(menu).getByRole('menuitem', { name: 'Open auction' })).toHaveAttribute(
      'href',
      fullRow.auctionUrl
    )
    expect(within(menu).getByRole('menuitem', { name: 'Open auction' })).toHaveAttribute(
      'target',
      '_blank'
    )
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy domain' }))
    })
    expect(writeText).toHaveBeenCalledWith('garden-example.com')
    expect(toast.success).toHaveBeenCalledWith('Copied garden-example.com')
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    menu = await open()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Details' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Dynadot · Expired · ends in 30m')).toBeInTheDocument()
  })

  it('needs a selection provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<SelectionBar />)).toThrow('Row selection needs a RowSelectionProvider')
    consoleError.mockRestore()
  })
})
