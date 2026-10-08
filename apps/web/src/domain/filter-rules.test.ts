import { describe, expect, it } from 'vitest'

import {
  buildDomainTableHref,
  type DomainTableSearchParams,
  parseDomainTableFilters
} from '@/domain/domain-table'
import {
  applyRule,
  changeRuleOperator,
  describeRule,
  isRuleReady,
  RULE_FIELD_KEYS,
  type Rule,
  removeRule,
  ruleField,
  rulesFromFilters
} from '@/domain/filter-rules'

const filters = (params: DomainTableSearchParams = {}) =>
  parseDomainTableFilters({ sort: 'price', direction: 'desc', page: '3', ...params })
const href = (params: DomainTableSearchParams, rule: Rule) =>
  buildDomainTableHref(applyRule(filters(params), rule))

describe('rulesFromFilters', () => {
  it('reads no rules from navigation state alone', () => {
    expect(rulesFromFilters(filters())).toEqual([])
  })

  it('reads every applied filter as one rule, in field order, in the URL text', () => {
    expect(
      rulesFromFilters(
        filters({
          domainRatingMin: '30',
          q: 'Garden',
          noHyphens: '1',
          noDigits: '1',
          source: ['godaddy', 'dynadot'],
          type: 'auction',
          tld: 'com',
          priceMin: '20',
          priceMax: '30.5',
          endingWithin: '24h',
          bidsMin: '2',
          domainLengthMin: '8',
          domainLengthMax: '8',
          ageMin: '5',
          linksMin: '1',
          visitorsMin: '3',
          appraisalMin: '100',
          renewalMax: '12.99',
          majesticTfMin: '10',
          majesticCfMin: '11',
          majesticRefDomainsMin: '12',
          semrushAsMin: '13'
        })
      )
    ).toEqual([
      { field: 'query', operator: 'contains', values: ['garden'] },
      { field: 'noHyphens', operator: 'noHyphens', values: [] },
      { field: 'noDigits', operator: 'noDigits', values: [] },
      { field: 'source', operator: 'anyOf', values: ['godaddy', 'dynadot'] },
      { field: 'type', operator: 'anyOf', values: ['auction'] },
      { field: 'tld', operator: 'anyOf', values: ['com'] },
      { field: 'price', operator: 'between', values: ['20', '30.50'] },
      { field: 'endingWithin', operator: 'within', values: ['24h'] },
      { field: 'bids', operator: 'gte', values: ['2'] },
      { field: 'domainLength', operator: 'eq', values: ['8'] },
      { field: 'age', operator: 'gte', values: ['5'] },
      { field: 'links', operator: 'gte', values: ['1'] },
      { field: 'visitors', operator: 'gte', values: ['3'] },
      { field: 'appraisal', operator: 'gte', values: ['100'] },
      { field: 'renewal', operator: 'lte', values: ['12.99'] },
      { field: 'majesticTf', operator: 'gte', values: ['10'] },
      { field: 'majesticCf', operator: 'gte', values: ['11'] },
      { field: 'majesticRefDomains', operator: 'gte', values: ['12'] },
      { field: 'semrushAs', operator: 'gte', values: ['13'] },
      { field: 'domainRating', operator: 'gte', values: ['30'] }
    ])
  })

  it('reads a maximum alone as ≤', () => {
    expect(rulesFromFilters(filters({ ageMax: '4' }))).toEqual([
      { field: 'age', operator: 'lte', values: ['4'] }
    ])
  })

  it('round-trips every rule through applyRule to the same URL', () => {
    const old = filters({
      q: 'garden',
      noDigits: '1',
      source: 'godaddy',
      tld: ['com', 'net'],
      priceMax: '500',
      domainLengthMin: '4',
      domainLengthMax: '12',
      endingWithin: '6h',
      domainRatingMin: '20'
    })
    let rebuilt = parseDomainTableFilters({ sort: 'price', direction: 'desc' })
    for (const rule of rulesFromFilters(old)) rebuilt = applyRule(rebuilt, rule)
    expect(buildDomainTableHref(rebuilt)).toBe(buildDomainTableHref(old, { page: 1 }))
  })
})

describe('applyRule', () => {
  it('sets one field on page 1 and keeps the others and the sort', () => {
    expect(href({ tld: 'com' }, { field: 'price', operator: 'lte', values: ['500'] })).toBe(
      '/?tld=com&priceMax=500&sort=price&direction=desc&page=1'
    )
  })

  it('replaces the field it sets, whatever the operator was', () => {
    const params = { priceMin: '10', priceMax: '90' }
    expect(href(params, { field: 'price', operator: 'gte', values: ['25'] })).toBe(
      '/?priceMin=25&sort=price&direction=desc&page=1'
    )
    expect(href(params, { field: 'price', operator: 'eq', values: ['40'] })).toBe(
      '/?priceMin=40&priceMax=40&sort=price&direction=desc&page=1'
    )
    expect(href(params, { field: 'price', operator: 'between', values: ['5', '7.5'] })).toBe(
      '/?priceMin=5&priceMax=7.50&sort=price&direction=desc&page=1'
    )
  })

  it('applies lists, flags, windows, single minimums, and the renewal maximum', () => {
    expect(
      href({ source: 'godaddy' }, { field: 'source', operator: 'anyOf', values: ['dynadot'] })
    ).toBe('/?source=dynadot&sort=price&direction=desc&page=1')
    expect(href({}, { field: 'noHyphens', operator: 'noHyphens', values: [] })).toBe(
      '/?noHyphens=1&sort=price&direction=desc&page=1'
    )
    expect(href({}, { field: 'endingWithin', operator: 'within', values: ['3d'] })).toBe(
      '/?endingWithin=3d&sort=price&direction=desc&page=1'
    )
    expect(href({}, { field: 'majesticTf', operator: 'gte', values: ['25'] })).toBe(
      '/?majesticTfMin=25&sort=price&direction=desc&page=1'
    )
    expect(href({}, { field: 'renewal', operator: 'lte', values: ['9.99'] })).toBe(
      '/?renewalMax=9.99&sort=price&direction=desc&page=1'
    )
    expect(href({}, { field: 'query', operator: 'contains', values: [' Garden '] })).toBe(
      '/?q=garden&sort=price&direction=desc&page=1'
    )
  })

  it('clears the field for blank or invalid values, and swaps a reversed range', () => {
    expect(href({ bidsMin: '3' }, { field: 'bids', operator: 'gte', values: [' '] })).toBe(
      '/?sort=price&direction=desc&page=1'
    )
    expect(href({ bidsMin: '3' }, { field: 'bids', operator: 'gte', values: ['-1'] })).toBe(
      '/?sort=price&direction=desc&page=1'
    )
    expect(href({}, { field: 'tld', operator: 'anyOf', values: [] })).toBe(
      '/?sort=price&direction=desc&page=1'
    )
    expect(href({}, { field: 'age', operator: 'between', values: ['9', '2'] })).toBe(
      '/?ageMin=2&ageMax=9&sort=price&direction=desc&page=1'
    )
    expect(href({}, { field: 'age', operator: 'between', values: ['9'] })).toBe(
      '/?ageMin=9&sort=price&direction=desc&page=1'
    )
  })

  it('keeps the shared category cap', () => {
    const many = Array.from({ length: 70 }, (_, index) => `t${index}`)
    const next = applyRule(filters({ source: 'godaddy', type: 'auction' }), {
      field: 'tld',
      operator: 'anyOf',
      values: many
    })
    expect(next.sources.length + next.auctionTypes.length + next.tlds.length).toBe(64)
  })
})

describe('removeRule', () => {
  it('removes every parameter of one field on page 1', () => {
    expect(
      buildDomainTableHref(
        removeRule(filters({ priceMin: '1', priceMax: '2', tld: 'com' }), 'price')
      )
    ).toBe('/?tld=com&sort=price&direction=desc&page=1')
  })
})

describe('rule helpers', () => {
  it('waits for both ends of a between rule only', () => {
    const price = (operator: Rule['operator'], values: string[]): Rule => ({
      field: 'price',
      operator,
      values
    })
    expect(isRuleReady(price('between', ['1', '']))).toBe(false)
    expect(isRuleReady(price('between', ['', '2']))).toBe(false)
    expect(isRuleReady(price('between', ['1', '2']))).toBe(true)
    expect(isRuleReady(price('between', ['', '']))).toBe(true)
    expect(isRuleReady(price('gte', ['']))).toBe(true)
  })

  it('keeps the value the new operator names', () => {
    const rule: Rule = { field: 'price', operator: 'gte', values: ['10'] }
    expect(changeRuleOperator(rule, 'lte')).toEqual({ ...rule, operator: 'lte', values: ['10'] })
    expect(changeRuleOperator(rule, 'between')).toEqual({
      ...rule,
      operator: 'between',
      values: ['10', '']
    })
    expect(changeRuleOperator({ ...rule, operator: 'lte' }, 'between')).toEqual({
      ...rule,
      operator: 'between',
      values: ['', '10']
    })
    const between: Rule = { field: 'price', operator: 'between', values: ['10', '20'] }
    expect(changeRuleOperator(between, 'lte').values).toEqual(['20'])
    expect(changeRuleOperator(between, 'gte').values).toEqual(['10'])
    expect(changeRuleOperator({ ...rule, values: [] }, 'eq').values).toEqual([''])
  })

  it('names each field and lists them in order', () => {
    expect(RULE_FIELD_KEYS[0]).toBe('query')
    expect(ruleField('domainRating')).toMatchObject({
      label: 'Ahrefs DR',
      description: 'Domain Rating'
    })
  })
})

describe('describeRule', () => {
  it('reads every rule as words', () => {
    const described = rulesFromFilters(
      filters({
        q: 'garden',
        noHyphens: '1',
        source: ['godaddy', 'dynadot'],
        type: 'buy_now',
        tld: 'com',
        priceMax: '12.5',
        endingWithin: '24h',
        ageMin: '3',
        ageMax: '3',
        majesticTfMin: '25'
      })
    ).map(describeRule)
    expect(described).toEqual([
      'Domain contains garden',
      'Domain has no hyphens',
      'Source is any of GoDaddy, Dynadot',
      'Type is Buy Now',
      'TLD is .com',
      'Price ≤ $12.50',
      'Ends within 24 hours',
      'Age = 3',
      'Majestic TF ≥ 25'
    ])
  })
})
