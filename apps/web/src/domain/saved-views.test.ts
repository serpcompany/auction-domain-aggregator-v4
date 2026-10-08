import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseDomainTableFilters } from '@/domain/domain-table'
import {
  deleteView,
  localSavedViewStore,
  normalizeViewName,
  noSavedViews,
  parseSavedViews,
  SAVED_VIEWS_KEY,
  SAVED_VIEWS_LIMIT,
  type SavedView,
  saveView,
  suggestViewName,
  viewHref,
  viewLayout,
  viewQuery
} from '@/domain/saved-views'

const view = (name: string, query = 'sort=endsAt&direction=asc&page=1'): SavedView => ({
  name,
  query,
  columns: 'source,price',
  layout: 'order:price,source',
  widths: 'price:120'
})

afterEach(() => localStorage.clear())

describe('suggestViewName', () => {
  it('names the active rules, or every auction with none', () => {
    expect(suggestViewName(parseDomainTableFilters({}))).toBe('All auctions')
    expect(suggestViewName(parseDomainTableFilters({ majesticTfMin: '25' }))).toBe(
      'Majestic TF ≥ 25'
    )
    expect(
      suggestViewName(
        parseDomainTableFilters({ type: 'auction', priceMin: '10', priceMax: '50.5' })
      )
    ).toBe('Type is Auction, Price between $10 and $50.50')
  })

  it('cuts a long name with an ellipsis', () => {
    const name = suggestViewName(
      parseDomainTableFilters({
        q: 'garden',
        noHyphens: '1',
        noDigits: '1',
        source: ['godaddy', 'dynadot'],
        tld: ['com', 'net']
      })
    )
    expect(name.length).toBeLessThanOrEqual(80)
    expect(name.endsWith('…')).toBe(true)
  })
})

describe('normalizeViewName', () => {
  it('collapses spaces, trims, and caps the length', () => {
    expect(normalizeViewName('  Big   TF  ')).toBe('Big TF')
    expect(normalizeViewName('x'.repeat(90))).toHaveLength(80)
  })
})

describe('view URLs and layouts', () => {
  it('stores the table query on page 1 and opens it through the URL parser', () => {
    const filters = parseDomainTableFilters({ tld: 'com', sort: 'price', page: '4' })
    expect(viewQuery(filters)).toBe('tld=com&sort=price&direction=asc&page=1')
    expect(viewHref({ query: 'tld=COM&bogus=1&page=9' })).toBe(
      '/?tld=com&sort=endsAt&direction=asc&page=1'
    )
  })

  it('reads a layout through the cookie parsers', () => {
    expect(
      viewLayout({ columns: 'price,nope;x', layout: 'left:bids', widths: 'price:9999' })
    ).toEqual({
      columns: 'price',
      layout: expect.stringMatching(/^order:.*\|left:bids$/),
      widths: 'price:640'
    })
  })
})

describe('saveView and deleteView', () => {
  it('adds a new name and replaces an existing one in place, in any case', () => {
    const first = saveView([], view('Big TF'))
    expect(first.result).toBe('added')
    const second = saveView([...first.views, view('Cheap')], view('big tf', 'tld=net'))
    expect(second.result).toBe('replaced')
    expect(second.views.map(saved => [saved.name, saved.query])).toEqual([
      ['big tf', 'tld=net'],
      ['Cheap', 'sort=endsAt&direction=asc&page=1']
    ])
  })

  it('refuses a new name at the limit but still replaces', () => {
    const full = Array.from({ length: SAVED_VIEWS_LIMIT }, (_, index) => view(`View ${index}`))
    expect(saveView(full, view('One more')).result).toBe('full')
    expect(saveView(full, view('View 3')).result).toBe('replaced')
  })

  it('deletes by name', () => {
    expect(deleteView([view('A'), view('B')], 'A').map(saved => saved.name)).toEqual(['B'])
  })
})

describe('parseSavedViews', () => {
  it('reads nothing from a missing, unreadable, or non-array value', () => {
    expect(parseSavedViews(null)).toEqual([])
    expect(parseSavedViews('{nope')).toEqual([])
    expect(parseSavedViews('{"views":[]}')).toEqual([])
  })

  it('skips malformed entries, blank and repeated names, and keeps the limit', () => {
    const raw = JSON.stringify([
      view(' A  '),
      null,
      'text',
      { ...view('B'), query: 3 },
      view('   '),
      view('a'),
      { ...view('C'), extra: true },
      ...Array.from({ length: SAVED_VIEWS_LIMIT }, (_, index) => view(`More ${index}`))
    ])
    const views = parseSavedViews(raw)
    expect(views).toHaveLength(SAVED_VIEWS_LIMIT)
    expect(views.slice(0, 2)).toEqual([view('A'), view('C')])
  })
})

describe('localSavedViewStore', () => {
  it('reads the same array until the stored value changes, and tells subscribers', () => {
    const store = localSavedViewStore(() => localStorage)
    expect(store.read()).toBe(noSavedViews())
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    expect(store.write([view('A')])).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) as string)).toEqual([view('A')])
    const read = store.read()
    expect(read).toEqual([view('A')])
    expect(store.read()).toBe(read)

    // Another tab's change to this key, or a clear, arrives as a storage event.
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }))
    window.dispatchEvent(new StorageEvent('storage', { key: SAVED_VIEWS_KEY }))
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    store.write([])
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('treats storage that throws as no views and a refused write', () => {
    const store = localSavedViewStore(() => {
      throw new Error('SecurityError')
    })
    expect(store.read()).toEqual([])
    expect(store.write([view('A')])).toBe(false)
  })
})
