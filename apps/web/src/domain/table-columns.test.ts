import { describe, expect, it } from 'vitest'

import {
  clampColumnWidth,
  columnGroup,
  columnWidth,
  columnWidthCss,
  DEFAULT_COLUMNS,
  defaultColumnWidth,
  isDefaultColumnSet,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseColumnWidths,
  parseVisibleColumns,
  serializeColumnWidths,
  serializeVisibleColumns,
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
      'semrushAs',
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
    expect(defaultColumnWidth('domain')).toBe(240)
    for (const column of TABLE_COLUMNS) {
      expect(defaultColumnWidth(column.key)).toBe(column.width)
    }
    expect(columnWidth({ price: 120 }, 'price')).toBe(120)
    expect(columnWidth({}, 'price')).toBe(80)
    expect(columnWidthCss('price')).toBe('var(--column-price-width, 80px)')
    expect(clampColumnWidth(100.4)).toBe(100)
  })
})
