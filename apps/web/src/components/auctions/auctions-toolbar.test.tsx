import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuctionsToolbar } from '@/components/auctions/auctions-toolbar'
import { TableLayoutProvider } from '@/components/auctions/table-layout'
import { parseDomainTableFilters } from '@/domain/domain-table'
import { DEFAULT_COLUMNS } from '@/domain/table-columns'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

beforeAll(() => {
  // cmdk and Base UI expect browser APIs jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
})
beforeEach(() => push.mockClear())
afterEach(cleanup)

function renderToolbar(params: Record<string, string | string[]> = {}, actions?: ReactNode) {
  return render(
    <TableLayoutProvider initialColumns={DEFAULT_COLUMNS} initialWidths={{}}>
      <AuctionsToolbar
        filters={parseDomainTableFilters({ sort: 'price', direction: 'desc', ...params })}
        sources={['dynadot', 'godaddy']}
        auctionTypes={['auction', 'buy_now', 'expired']}
        tlds={['co', 'com', 'net']}
        count={<span>857,412 listings</span>}
        actions={actions}
      />
    </TableLayoutProvider>
  )
}

describe('AuctionsToolbar', () => {
  it('shows the count, Filters, Columns, and no Clear all without filters', () => {
    renderToolbar()

    expect(screen.getByText('857,412 listings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Clear all' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument()
  })

  it('ends the row with actions on the matching listings', () => {
    renderToolbar({ tld: 'com' }, <button type="button">Fetch DR</button>)
    expect(screen.getByRole('button', { name: 'Fetch DR' })).toBeInTheDocument()
  })

  it('searches on Enter and returns to page 1', () => {
    renderToolbar({ page: '4' })

    const search = screen.getByRole('searchbox', { name: 'Domain contains' })
    fireEvent.change(search, { target: { value: '  Garden ' } })
    fireEvent.submit(search.closest('form') as HTMLFormElement)
    expect(push).toHaveBeenCalledWith('/?q=garden&sort=price&direction=desc&page=1')
  })

  it('searches on leaving the field only when the search changed', () => {
    renderToolbar({ q: 'garden' })

    const search = screen.getByRole('searchbox', { name: 'Domain contains' })
    fireEvent.change(search, { target: { value: 'Garden ' } })
    fireEvent.blur(search)
    expect(push).not.toHaveBeenCalled()
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.blur(search)
    expect(push).toHaveBeenCalledWith('/?sort=price&direction=desc&page=1')
  })

  it('focuses search on "/" unless the user is typing', () => {
    renderToolbar()
    const search = screen.getByRole('searchbox', { name: 'Domain contains' })

    fireEvent.keyDown(document.body, { key: '/' })
    expect(search).toHaveFocus()

    search.blur()
    const other = document.createElement('input')
    document.body.appendChild(other)
    other.focus()
    fireEvent.keyDown(other, { key: '/' })
    expect(other).toHaveFocus()
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(other).toHaveFocus()
    other.remove()
  })

  it('edits filters as rules that push the URL on page 1', () => {
    renderToolbar({ type: 'expired', bidsMin: '5', page: '3' })

    expect(screen.getByRole('group', { name: 'Type rule' })).toHaveTextContent('Expired')
    expect(screen.getByRole('link', { name: 'Clear all' })).toHaveAttribute(
      'href',
      '/?sort=price&direction=desc&page=1'
    )
    const bids = screen.getByRole('spinbutton', { name: 'Bids value' })
    fireEvent.change(bids, { target: { value: '8' } })
    fireEvent.keyDown(bids, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/?type=expired&bidsMin=8&sort=price&direction=desc&page=1')
  })

  it('gives phones a Filters link counting every filter and a sort list', () => {
    renderToolbar({ tld: 'com', bidsMin: '5' })

    expect(screen.getByRole('link', { name: 'Filters 2' })).toHaveAttribute(
      'href',
      '/filters/?tld=com&bidsMin=5&sort=price&direction=desc&page=1'
    )
    const sort = screen.getByRole('combobox', { name: 'Sort' })
    expect(sort).toHaveValue('price:desc')
    fireEvent.change(sort, { target: { value: 'domainRating:desc' } })
    expect(push).toHaveBeenLastCalledWith(
      '/?tld=com&bidsMin=5&sort=domainRating&direction=desc&page=1'
    )
    expect(screen.getByRole('button', { name: 'Fields shown' })).toBeInTheDocument()
  })

  it('names a sort the list does not offer', () => {
    renderToolbar({ sort: 'links', direction: 'asc' })
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveDisplayValue(
      'Sorted by Inbound links (ascending)'
    )
    cleanup()
    renderToolbar({ sort: 'visitors', direction: 'desc' })
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveDisplayValue(
      'Sorted by Visitors (descending)'
    )
    cleanup()
    renderToolbar({ sort: 'domain', direction: 'desc' })
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveDisplayValue(
      'Sorted by Domain (descending)'
    )
    expect(screen.getByRole('link', { name: 'Filters' })).toBeInTheDocument()
  })
})
