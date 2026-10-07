import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuctionsToolbar } from '@/components/auctions/auctions-toolbar'
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

function renderToolbar(params: Record<string, string | string[]> = {}) {
  return render(
    <AuctionsToolbar
      filters={parseDomainTableFilters({ sort: 'price', direction: 'desc', ...params })}
      sources={['dynadot', 'godaddy']}
      auctionTypes={['auction', 'buy_now', 'expired']}
      tlds={['co', 'com', 'net']}
      count={<span>857,412 listings</span>}
      visibleColumns={DEFAULT_COLUMNS}
    />
  )
}

async function choose(trigger: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${trigger}`) }))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

describe('AuctionsToolbar', () => {
  it('shows the count, the All filters link, and no Reset without filters', () => {
    renderToolbar()

    expect(screen.getByText('857,412 listings')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All filters' })).toHaveAttribute(
      'href',
      '/filters/?sort=price&direction=desc&page=1'
    )
    expect(screen.queryByRole('link', { name: 'Reset' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument()
  })

  it('searches on Enter and returns to page 1', () => {
    renderToolbar({ page: '4' })

    const search = screen.getByRole('searchbox', { name: 'Domain contains' })
    fireEvent.change(search, { target: { value: '  Garden ' } })
    fireEvent.submit(search.closest('form') as HTMLFormElement)
    expect(push).toHaveBeenCalledWith('/?q=garden&sort=price&direction=desc&page=1')
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

  it('applies a source as soon as it is chosen and clears it again', async () => {
    renderToolbar({ source: 'godaddy' })
    expect(screen.getByRole('button', { name: /^Source/ })).toHaveTextContent('GoDaddy')

    await choose('Source', 'Dynadot')
    expect(push).toHaveBeenLastCalledWith(
      '/?source=godaddy&source=dynadot&sort=price&direction=desc&page=1'
    )
    fireEvent.click(screen.getByRole('option', { name: 'GoDaddy' }))
    expect(push).toHaveBeenLastCalledWith('/?sort=price&direction=desc&page=1')
    fireEvent.click(screen.getByRole('option', { name: 'Clear filter' }))
    expect(push).toHaveBeenLastCalledWith('/?sort=price&direction=desc&page=1')
  })

  it('applies an auction type as soon as it is chosen', async () => {
    renderToolbar()

    await choose('Type', 'Expired')
    expect(push).toHaveBeenLastCalledWith('/?type=expired&sort=price&direction=desc&page=1')
  })

  it('searches TLDs, summarizes many choices, and keeps a TLD the facets dropped', async () => {
    renderToolbar({ tld: ['com', 'co', 'org'] })
    const trigger = screen.getByRole('button', { name: /^TLD/ })
    expect(trigger).toHaveTextContent('3 selected')

    fireEvent.click(trigger)
    expect(await screen.findByPlaceholderText('TLD')).toBeInTheDocument()
    expect(screen.getByText('3 TLDs in the inventory')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'org' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: '.net' }))
    expect(push).toHaveBeenLastCalledWith(
      '/?tld=com&tld=co&tld=org&tld=net&sort=price&direction=desc&page=1'
    )
  })

  it('applies and clears a maximum bid', async () => {
    renderToolbar({ priceMax: '50' })
    const trigger = screen.getByRole('button', { name: /^Max bid/ })
    expect(trigger).toHaveTextContent('$50')

    fireEvent.click(trigger)
    const input = await screen.findByRole('spinbutton', { name: 'Max bid' })
    expect(input).toHaveValue(50)
    fireEvent.change(input, { target: { value: '120.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(push).toHaveBeenLastCalledWith('/?priceMax=120.50&sort=price&direction=desc&page=1')

    fireEvent.click(screen.getByRole('button', { name: /^Max bid/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }))
    expect(push).toHaveBeenLastCalledWith('/?sort=price&direction=desc&page=1')
  })

  it('opens an empty maximum bid without Clear', async () => {
    renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: /^Max bid/ }))
    expect(await screen.findByRole('spinbutton', { name: 'Max bid' })).toHaveValue(null)
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('picks an ending window and returns to any time', async () => {
    renderToolbar({ endingWithin: '6h' })
    expect(screen.getByRole('button', { name: /^Ends/ })).toHaveTextContent('6 hours')

    await choose('Ends', 'Within 24 hours')
    expect(push).toHaveBeenLastCalledWith('/?endingWithin=24h&sort=price&direction=desc&page=1')
    await choose('Ends', 'Any time')
    expect(push).toHaveBeenLastCalledWith('/?sort=price&direction=desc&page=1')
    fireEvent.click(screen.getByRole('button', { name: /^Ends/ }))
    expect(
      within(await screen.findByRole('option', { name: /Within 6 hours/ })).getByText('(selected)')
    ).toBeInTheDocument()
  })

  it('counts the filters only the Filters page sets and offers Reset', () => {
    renderToolbar({ bidsMin: '5', noDigits: '1', tld: 'com', type: 'expired' })

    expect(screen.getByRole('link', { name: 'All filters 2' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reset' })).toHaveAttribute(
      'href',
      '/?sort=price&direction=desc&page=1'
    )
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
