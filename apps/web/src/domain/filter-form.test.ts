import { describe, expect, it } from 'vitest'

import { parseDomainTableFilters } from '@/domain/domain-table'
import {
  countFiltersBySection,
  findInvalidRange,
  formDataToSearchParams,
  rangeErrorMessage
} from '@/domain/filter-form'

function form(entries: Array<[string, string]>) {
  const data = new FormData()
  for (const [name, value] of entries) data.append(name, value)
  return data
}

describe('formDataToSearchParams', () => {
  it('keeps repeated values and drops empty fields', () => {
    expect(
      formDataToSearchParams(
        form([
          ['q', 'garden'],
          ['tld', 'com'],
          ['tld', 'co'],
          ['priceMax', ''],
          ['bidsMin', '  ']
        ])
      )
    ).toEqual({ q: ['garden'], tld: ['com', 'co'] })
  })

  it('ignores uploaded files', () => {
    const data = form([['q', 'a']])
    data.append('file', new Blob(['x']))
    expect(formDataToSearchParams(data)).toEqual({ q: ['a'] })
  })
})

describe('findInvalidRange', () => {
  it('finds a minimum above its maximum', () => {
    const range = findInvalidRange({ domainLengthMin: ['14'], domainLengthMax: ['8'] })
    expect(range?.label).toBe('domain length')
    expect(rangeErrorMessage(range!)).toBe(
      'Minimum domain length cannot exceed maximum domain length. Lower the minimum or raise the maximum.'
    )
  })

  it('accepts open, equal, single-value, and non-numeric ranges', () => {
    expect(findInvalidRange({})).toBeUndefined()
    expect(findInvalidRange({ ageMin: '3', ageMax: '3' })).toBeUndefined()
    expect(findInvalidRange({ priceMin: ['500'] })).toBeUndefined()
    expect(findInvalidRange({ priceMin: ['x'], priceMax: ['1'] })).toBeUndefined()
  })
})

describe('countFiltersBySection', () => {
  it('counts each set filter once in its section', () => {
    expect(countFiltersBySection(parseDomainTableFilters({}))).toEqual({
      general: 0,
      auction: 0,
      name: 0,
      activity: 0,
      seo: 0
    })
    expect(
      countFiltersBySection(
        parseDomainTableFilters({
          q: 'garden',
          source: 'godaddy',
          tld: ['com', 'co'],
          endingWithin: '24h',
          type: 'auction',
          priceMax: '50',
          renewalMax: '20',
          domainLengthMax: '10',
          ageMin: '5',
          noHyphens: '1',
          noDigits: '1',
          bidsMin: '5',
          visitorsMin: '1',
          linksMin: '1',
          appraisalMin: '100',
          majesticTfMin: '10',
          majesticCfMin: '10',
          majesticRefDomainsMin: '5',
          semrushAsMin: '5'
        })
      )
    ).toEqual({ general: 4, auction: 3, name: 4, activity: 4, seo: 4 })
  })
})
