import { describe, expect, it } from 'vitest'

import {
  COLUMN_LAYOUT_COOKIE,
  clampColumnWidth,
  columnGroup,
  columnWidth,
  columnWidthCss,
  DEFAULT_COLUMN_LAYOUT,
  DEFAULT_COLUMNS,
  defaultColumnWidth,
  isDefaultColumnLayout,
  isDefaultColumnSet,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveColumn,
  orderedColumns,
  parseColumnLayout,
  parseColumnWidths,
  parseVisibleColumns,
  pinColumn,
  ROW_ACTIONS_COLUMN_WIDTH,
  SELECTION_COLUMN_WIDTH,
  serializeColumnLayout,
  serializeColumnWidths,
  serializeVisibleColumns,
  stickyOffsets,
  TABLE_COLUMNS
} from '@/domain/table-columns'

describe('table columns', () => {
  it('shows the default set without a cookie', () => {
    expect(parseVisibleColumns(undefined)).toEqual([
      'source',
      'type',
      'price',
      'bids',
      'ends',
      'age',
      'links',
      'appraisal',
      'majesticTf',
      'majesticCf',
      'domainRating'
    ])
    expect(DEFAULT_COLUMNS).toEqual(parseVisibleColumns(undefined))
  })

  it('reads a cookie in registry order, ignoring unknown keys', () => {
    expect(parseVisibleColumns('domainRating,renewal,bogus,price')).toEqual([
      'price',
      'renewal',
      'domainRating'
    ])
    expect(parseVisibleColumns('')).toEqual([])
  })

  it('writes keys in registry order and recognizes the default set', () => {
    expect(serializeVisibleColumns(['visitors', 'price'])).toBe('price,visitors')
    expect(isDefaultColumnSet([...DEFAULT_COLUMNS].reverse())).toBe(true)
    expect(isDefaultColumnSet(['price'])).toBe(false)
  })

  it('names the metric group a column belongs to', () => {
    const byKey = Object.fromEntries(TABLE_COLUMNS.map(column => [column.key, column]))
    expect(columnGroup(byKey.majesticTf)).toBe('Majestic')
    expect(columnGroup(byKey.domainRating)).toBe('Ahrefs')
    expect(columnGroup(byKey.price)).toBeUndefined()
  })

  it('reads saved widths within the allowed range, ignoring unknown keys and bad values', () => {
    expect(parseColumnWidths(undefined)).toEqual({})
    expect(parseColumnWidths('')).toEqual({})
    expect(
      parseColumnWidths(
        'price:120,domain:9999,ends:10,bogus:100,constructor:100,age:abc,links:12.5,visitors'
      )
    ).toEqual({ price: 120, domain: MAX_COLUMN_WIDTH, ends: MIN_COLUMN_WIDTH })
  })

  it('writes widths and gives Domain and every column a default and a CSS width', () => {
    expect(serializeColumnWidths({ price: 120, domain: 300 })).toBe('price:120,domain:300')
    expect(parseColumnWidths(serializeColumnWidths({ price: 120 }))).toEqual({ price: 120 })
    expect(defaultColumnWidth('domain')).toBe(192)
    for (const column of TABLE_COLUMNS) {
      expect(defaultColumnWidth(column.key)).toBe(column.width)
    }
    expect(columnWidth({ price: 120 }, 'price')).toBe(120)
    expect(columnWidth({}, 'price')).toBe(80)
    expect(columnWidthCss('price')).toBe('var(--column-price-width, 80px)')
    expect(clampColumnWidth(100.4)).toBe(100)
  })
})

describe('column layout', () => {
  const registryOrder = TABLE_COLUMNS.map(column => column.key)
  const keys = (columns: readonly { key: string }[]) => columns.map(column => column.key)

  it('reads no cookie, an empty one, or a malformed one as the default', () => {
    for (const cookie of [undefined, '', 'garbage', 'order:', 'left:bogus|right:', ':|::']) {
      expect(parseColumnLayout(cookie)).toEqual(DEFAULT_COLUMN_LAYOUT)
    }
    expect(DEFAULT_COLUMN_LAYOUT).toEqual({ order: registryOrder, pins: {} })
    expect(isDefaultColumnLayout(parseColumnLayout('order:source'))).toBe(true)
  })

  it('reads order and pins, ignoring unknown keys and appending missing columns', () => {
    const layout = parseColumnLayout(
      'order:price,bogus,source,price|left:price,bids|right:bids,ends|order:age|extra:age'
    )
    expect(layout.order).toEqual([
      'price',
      'source',
      ...registryOrder.filter(key => key !== 'price' && key !== 'source')
    ])
    // A column in both lists stays on the first side read.
    expect(layout.pins).toEqual({ price: 'left', bids: 'left', ends: 'right' })
    expect(isDefaultColumnLayout(layout)).toBe(false)
  })

  it('writes order and pins, which read back the same', () => {
    const layout = pinColumn(
      pinColumn(parseColumnLayout('order:bids,price'), 'source', 'right'),
      'price',
      'left'
    )
    const cookie = serializeColumnLayout(layout)
    expect(cookie).toBe(`order:${layout.order.join(',')}|left:price|right:source`)
    expect(cookie.startsWith('order:bids,price,source,type,ends')).toBe(true)
    expect(cookie).not.toContain(';')
    expect(parseColumnLayout(cookie)).toEqual(layout)
    expect(serializeColumnLayout(DEFAULT_COLUMN_LAYOUT)).toBe(`order:${registryOrder.join(',')}`)
  })

  it('splits the visible columns into pinned and scrolling sections in order', () => {
    const layout = parseColumnLayout('order:ends,price,bids,source|left:bids,price|right:source')
    const sections = orderedColumns(layout, ['source', 'price', 'bids', 'ends', 'majesticTf'])
    expect(keys(sections.left)).toEqual(['price', 'bids'])
    expect(keys(sections.center)).toEqual(['ends', 'majesticTf'])
    expect(keys(sections.right)).toEqual(['source'])
  })

  it('pins, moves the pin to the other side, and unpins in place', () => {
    const left = pinColumn(DEFAULT_COLUMN_LAYOUT, 'price', 'left')
    expect(left.pins).toEqual({ price: 'left' })
    expect(pinColumn(left, 'price', 'right').pins).toEqual({ price: 'right' })
    const unpinned = pinColumn(left, 'price', null)
    expect(unpinned).toEqual(DEFAULT_COLUMN_LAYOUT)
    expect(DEFAULT_COLUMN_LAYOUT.pins).toEqual({})
  })

  it('moves a column past its visible unpinned neighbour only', () => {
    const visible = ['source', 'price', 'bids', 'ends'] as const
    const layout = pinColumn(DEFAULT_COLUMN_LAYOUT, 'ends', 'right')
    // Type is hidden, so Price trades places with Source.
    expect(moveColumn(layout, 'price', 'left', visible)?.order.slice(0, 4)).toEqual([
      'price',
      'type',
      'source',
      'bids'
    ])
    expect(moveColumn(layout, 'price', 'right', visible)?.order.slice(0, 4)).toEqual([
      'source',
      'type',
      'bids',
      'price'
    ])
    expect(moveColumn(layout, 'price', 'right', visible)?.pins).toEqual({ ends: 'right' })
    // The ends of the scrolling section, a pinned column, and a hidden one.
    expect(moveColumn(layout, 'source', 'left', visible)).toBeNull()
    expect(moveColumn(layout, 'bids', 'right', visible)).toBeNull()
    expect(moveColumn(layout, 'ends', 'left', visible)).toBeNull()
    expect(moveColumn(layout, 'type', 'right', visible)).toBeNull()
  })

  it('offsets sticky columns by the widths between them and the edge', () => {
    expect(stickyOffsets(['domain', 'price', 'bids'], ['links', 'majesticTf'])).toEqual({
      domain: { left: `${SELECTION_COLUMN_WIDTH}px` },
      price: { left: 'calc(40px + var(--column-domain-width, 192px))' },
      bids: {
        left: 'calc(40px + var(--column-domain-width, 192px) + var(--column-price-width, 80px))'
      },
      links: { right: 'calc(40px + var(--column-majesticTf-width, 56px))' },
      majesticTf: { right: `${ROW_ACTIONS_COLUMN_WIDTH}px` }
    })
    expect(COLUMN_LAYOUT_COOKIE).toBe('column-layout')
  })
})
