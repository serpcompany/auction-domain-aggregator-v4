import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { RuleBar, ruleOptions } from '@/components/auctions/rule-bar'
import { type DomainTableSearchParams, parseDomainTableFilters } from '@/domain/domain-table'

const navigate = vi.fn()

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
beforeEach(() => navigate.mockClear())
afterEach(cleanup)

const options = ruleOptions({
  sources: ['dynadot', 'godaddy'],
  auctionTypes: ['auction', 'expired'],
  tlds: ['com', 'net']
})

function bar(params: DomainTableSearchParams = {}) {
  return (
    <RuleBar
      filters={parseDomainTableFilters({ sort: 'price', direction: 'desc', page: '3', ...params })}
      options={options}
      onNavigate={navigate}
    />
  )
}

const url = (query: string) => `/?${query}${query ? '&' : ''}sort=price&direction=desc&page=1`

async function addRule(field: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${field}`) }))
}

async function choose(trigger: string, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: trigger }))
  // Base UI's Select takes a click that starts on the item.
  const option = await screen.findByRole('option', { name })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
}

describe('RuleBar', () => {
  it('shows one rule per applied filter and Clear all, which keeps the sort', () => {
    render(
      bar({
        q: 'garden',
        type: 'auction',
        tld: ['com', 'org'],
        noDigits: '1',
        priceMin: '10',
        priceMax: '20',
        endingWithin: '24h',
        bidsMin: '2'
      })
    )

    // The search is the toolbar's own permanent rule.
    expect(screen.queryByRole('group', { name: 'Domain rule' })).not.toBeInTheDocument()
    const type = screen.getByRole('group', { name: 'Type rule' })
    expect(type).toHaveTextContent('is any of')
    expect(within(type).getByText('Auction')).toBeInTheDocument()
    // An applied TLD the facets no longer list keeps its own name.
    const tld = screen.getByRole('group', { name: 'TLD rule' })
    expect(within(tld).getByText('.com')).toBeInTheDocument()
    expect(within(tld).getByText('org')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Domain has no digits rule' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Price minimum' })).toHaveValue(10)
    expect(screen.getByRole('spinbutton', { name: 'Price maximum' })).toHaveValue(20)
    expect(screen.getByRole('combobox', { name: 'Price operator' })).toHaveTextContent('between')
    expect(screen.getByRole('combobox', { name: 'Ends value' })).toHaveTextContent('24 hours')
    const bids = screen.getByRole('group', { name: 'Bids rule' })
    expect(within(bids).getByText('≥')).toBeInTheDocument()
    expect(within(bids).queryByText('$')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clear all' })).toHaveAttribute('href', url(''))
  })

  it('names metric rules by their vendor and metric', () => {
    render(
      bar({
        majesticTfMin: '25',
        majesticCfMin: '20',
        majesticRefDomainsMin: '10',
        semrushAsMin: '30',
        domainRatingMin: '40'
      })
    )

    expect(screen.getAllByRole('group').map(group => group.getAttribute('aria-label'))).toEqual([
      'Majestic TF rule',
      'Majestic CF rule',
      'Majestic ref. domains rule',
      'Semrush AS rule',
      'Ahrefs DR rule'
    ])
    expect(screen.getByRole('spinbutton', { name: 'Majestic TF value' })).toHaveValue(25)
  })

  it('has no Clear all without filters', () => {
    render(bar())
    expect(screen.queryByRole('link', { name: 'Clear all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('lists the unused fields, with what a metric measures', async () => {
    render(bar({ tld: 'com', noHyphens: '1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const listed = (await screen.findAllByRole('option')).map(option => option.textContent)
    expect(listed).toContain('Domain has no digits')
    expect(listed).toContain('Majestic TFTrust Flow')
    expect(listed).not.toContain('Domain has no hyphens')
    expect(listed).not.toContain('TLD')
    expect(listed.some(label => label?.startsWith('Domain contains'))).toBe(false)
  })

  it('adds a rule with its value focused and applies it only on Enter', async () => {
    render(bar())
    await addRule('Price')

    const value = screen.getByRole('spinbutton', { name: 'Price value' })
    await waitFor(() => expect(value).toHaveFocus())
    expect(screen.getByRole('group', { name: 'Price rule' })).toHaveTextContent('$')
    fireEvent.change(value, { target: { value: '500' } })
    fireEvent.keyDown(value, { key: '5' })
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.keyDown(value, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith(url('priceMin=500'))
    // The blur the navigation causes pushes nothing more.
    fireEvent.blur(value)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('applies a new operator at once when the rule has a value', async () => {
    render(bar({ priceMin: '10' }))
    await choose('Price operator', '≤')
    expect(navigate).toHaveBeenLastCalledWith(url('priceMax=10'))
  })

  it('waits for both ends of between', async () => {
    render(bar({ priceMax: '30' }))
    await choose('Price operator', 'between')
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('spinbutton', { name: 'Price maximum' })).toHaveValue(30)

    const minimum = screen.getByRole('spinbutton', { name: 'Price minimum' })
    fireEvent.keyDown(minimum, { key: 'Enter' })
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.change(minimum, { target: { value: '20' } })
    fireEvent.keyDown(minimum, { key: 'Enter' })
    expect(navigate).toHaveBeenLastCalledWith(url('priceMin=20&priceMax=30'))
  })

  it('applies on leaving the rule, not on moving within it or into its lists', () => {
    render(
      <>
        {bar({ bidsMin: '2', priceMin: '1', priceMax: '9' })}
        <button type="button">Elsewhere</button>
        <div data-rule-popup="">
          <button type="button">In a list</button>
        </div>
      </>
    )
    const minimum = screen.getByRole('spinbutton', { name: 'Price minimum' })
    fireEvent.change(minimum, { target: { value: '3' } })
    fireEvent.blur(minimum, {
      relatedTarget: screen.getByRole('spinbutton', { name: 'Price maximum' })
    })
    fireEvent.blur(minimum, { relatedTarget: screen.getByRole('button', { name: 'In a list' }) })
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.blur(minimum, { relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }) })
    expect(navigate).toHaveBeenLastCalledWith(url('priceMin=3&priceMax=9&bidsMin=2'))

    // An unchanged value pushes nothing.
    const bids = screen.getByRole('spinbutton', { name: 'Bids value' })
    fireEvent.blur(bids)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('removes an applied rule by navigating and a new one in place', async () => {
    render(bar({ bidsMin: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bids rule' }))
    expect(navigate).toHaveBeenLastCalledWith(url(''))

    await addRule('Links')
    await addRule('Visitors')
    // Only the newest rule takes focus.
    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: 'Visitors value' })).toHaveFocus()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Links rule' }))
    expect(screen.queryByRole('group', { name: 'Links rule' })).not.toBeInTheDocument()
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('applies a flag as soon as it is chosen', async () => {
    render(bar())
    await addRule('Domain has no hyphens')
    expect(navigate).toHaveBeenCalledWith(url('noHyphens=1'))
    expect(screen.queryByRole('group', { name: /hyphens/ })).not.toBeInTheDocument()
  })

  it('applies an ending window on choosing it', async () => {
    render(bar())
    await addRule('Ends')
    const trigger = screen.getByRole('combobox', { name: 'Ends value' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(trigger).toHaveTextContent('Choose…')
    await choose('Ends value', '6 hours')
    expect(navigate).toHaveBeenCalledWith(url('endingWithin=6h'))
  })

  it('applies chosen values when the list closes, and a removed chip at once', async () => {
    render(bar({ source: 'godaddy' }))
    const input = screen.getByRole('combobox', { name: 'Source values' })
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Dynadot' }))
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() =>
      expect(navigate).toHaveBeenLastCalledWith(url('source=godaddy&source=dynadot'))
    )

    cleanup()
    navigate.mockClear()
    render(bar({ source: ['godaddy', 'dynadot'] }))
    const group = screen.getByRole('group', { name: 'Source rule' })
    fireEvent.click(group.querySelector('[data-slot=combobox-chip-remove]') as HTMLElement)
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(url('source=dynadot')))
    // Leaving a list rule is its list's business.
    fireEvent.blur(screen.getByRole('combobox', { name: 'Source values' }))
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('offers an empty list rule its choices', async () => {
    render(bar())
    await addRule('TLD')
    const input = screen.getByRole('combobox', { name: 'TLD values' })
    await waitFor(() => expect(input).toHaveFocus())
    expect(input).toHaveAttribute('placeholder', 'Choose…')
  })

  it('drops a new rule once its field is applied, and on Clear all', async () => {
    const { rerender } = render(bar({ tld: 'com' }))
    await addRule('Bids')
    expect(screen.getByRole('group', { name: 'Bids rule' })).toBeInTheDocument()
    rerender(bar({ tld: 'com', bidsMin: '4' }))
    expect(screen.getAllByRole('group', { name: 'Bids rule' })).toHaveLength(1)
    expect(screen.getByRole('spinbutton', { name: 'Bids value' })).toHaveValue(4)

    await addRule('Links')
    const clearAll = screen.getByRole('link', { name: 'Clear all' })
    // jsdom cannot follow the link; the page's next render comes from the server.
    clearAll.addEventListener('click', event => event.preventDefault())
    act(() => {
      fireEvent.click(clearAll)
    })
    expect(screen.queryByRole('group', { name: 'Links rule' })).not.toBeInTheDocument()
  })

  it('returns focus to Filters when it closes without adding', async () => {
    render(bar())
    const trigger = screen.getByRole('button', { name: 'Filters' })
    fireEvent.click(trigger)
    const search = await screen.findByPlaceholderText('Filter by…')
    fireEvent.keyDown(search, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByPlaceholderText('Filter by…')).not.toBeInTheDocument())
  })
})
