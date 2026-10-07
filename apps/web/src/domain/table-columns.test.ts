import { describe, expect, it } from 'vitest'

import {
  columnGroup,
  DEFAULT_COLUMNS,
  isDefaultColumnSet,
  parseVisibleColumns,
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
})
