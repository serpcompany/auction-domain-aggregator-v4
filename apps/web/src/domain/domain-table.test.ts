import { describe, expect, it } from 'vitest'

import {
  buildDomainTableHref,
  countAdvancedDomainTableFilters,
  DOMAIN_TABLE_CATEGORY_VALUE_LIMIT,
  DOMAIN_TABLE_PAGE_SIZE,
  DOMAIN_TABLE_SORTS,
  formatAbsoluteEndTime,
  formatAge,
  formatAuctionType,
  formatCompactCount,
  formatDateTime,
  formatEndTime,
  formatMoney,
  formatProvider,
  formatSyncRecency,
  getDomainTableFilterChips,
  hasActiveDomainTableFilters,
  isInventoryStale,
  MAX_DOMAIN_TABLE_PAGE,
  nextSortDirection,
  parseDomainTableFilters
} from './domain-table'

describe('domain table filters', () => {
  it('uses stable defaults', () => {
    expect(parseDomainTableFilters({})).toEqual({
      query: undefined,
      sources: [],
      auctionTypes: [],
      tlds: [],
      domainLengthMin: undefined,
      domainLengthMax: undefined,
      noHyphens: false,
      noDigits: false,
      priceMinCents: undefined,
      priceMaxCents: undefined,
      bidsMin: undefined,
      ageMin: undefined,
      ageMax: undefined,
      linksMin: undefined,
      visitorsMin: undefined,
      appraisalMinCents: undefined,
      renewalMaxCents: undefined,
      majesticTfMin: undefined,
      majesticCfMin: undefined,
      majesticRefDomainsMin: undefined,
      semrushAsMin: undefined,
      endingWithin: undefined,
      sort: 'endsAt',
      direction: 'asc',
      page: 1,
      pageSize: DOMAIN_TABLE_PAGE_SIZE
    })
  })

  it('normalizes repeated categories, flags, ranges, money, and navigation', () => {
    expect(
      parseDomainTableFilters({
        q: [' Garden ', 'ignored'],
        source: ['DYNADOT', 'dynadot', 'unknown'],
        type: ['EXPIRED', 'expired', 'unsupported'],
        tld: ['.COM', 'org', 'com'],
        domainLengthMin: '20',
        domainLengthMax: '5',
        noHyphens: 'on',
        noDigits: ['false', 'TRUE'],
        priceMin: '500.5',
        priceMax: '12.34',
        bidsMin: '2',
        ageMin: '25',
        ageMax: '4',
        linksMin: '10',
        visitorsMin: '11',
        appraisalMin: '99.09',
        renewalMax: '15',
        majesticTfMin: '100',
        majesticCfMin: '0',
        majesticRefDomainsMin: '250',
        semrushAsMin: '12',
        endingWithin: '24H',
        sort: 'appraisal',
        direction: 'desc',
        page: String(MAX_DOMAIN_TABLE_PAGE + 1)
      })
    ).toEqual({
      query: 'garden',
      sources: ['dynadot'],
      auctionTypes: ['expired'],
      tlds: ['com', 'org'],
      domainLengthMin: 5,
      domainLengthMax: 20,
      noHyphens: true,
      noDigits: true,
      priceMinCents: 1234,
      priceMaxCents: 50050,
      bidsMin: 2,
      ageMin: 4,
      ageMax: 25,
      linksMin: 10,
      visitorsMin: 11,
      appraisalMinCents: 9909,
      renewalMaxCents: 1500,
      majesticTfMin: 100,
      majesticCfMin: 0,
      majesticRefDomainsMin: 250,
      semrushAsMin: 12,
      endingWithin: '24h',
      sort: 'appraisal',
      direction: 'desc',
      page: MAX_DOMAIN_TABLE_PAGE,
      pageSize: DOMAIN_TABLE_PAGE_SIZE
    })
  })

  it.each(DOMAIN_TABLE_SORTS)('accepts the %s sort', sort => {
    expect(parseDomainTableFilters({ sort }).sort).toBe(sort)
  })

  it.each(['1h', '6h', '24h', '3d', '7d'])('accepts the %s ending window', endingWithin => {
    expect(parseDomainTableFilters({ endingWithin }).endingWithin).toBe(endingWithin)
  })

  it('discards invalid, negative, overlong, and unsupported values', () => {
    const invalid = parseDomainTableFilters({
      q: 'a'.repeat(254),
      source: ['other'],
      type: ['unsupported'],
      tld: ['.bad!', '-com', `a${'-'.repeat(63)}z`],
      domainLengthMin: '-1',
      domainLengthMax: '254',
      noHyphens: 'yes',
      noDigits: '0',
      priceMin: '-1',
      priceMax: '1.234',
      bidsMin: '1e2',
      ageMin: 'NaN',
      ageMax: '',
      linksMin: '-2',
      visitorsMin: '1.5',
      appraisalMin: '99999999999999',
      renewalMax: 'Infinity',
      majesticTfMin: '101',
      majesticCfMin: '-1',
      majesticRefDomainsMin: 'many',
      semrushAsMin: '1.5',
      endingWithin: '2d',
      sort: 'drop table',
      direction: 'sideways',
      page: '-2'
    })

    expect(invalid).toEqual(parseDomainTableFilters({}))
    expect(parseDomainTableFilters({ q: [] }).query).toBeUndefined()
    expect(parseDomainTableFilters({ page: '999999999999999999999999' }).page).toBe(1)
  })

  it('caps repeated categories to one centralized D1 bind budget', () => {
    const tlds = Array.from({ length: 80 }, (_, index) => `tld${index}`)
    const filters = parseDomainTableFilters({
      source: ['dynadot', 'godaddy'],
      type: ['expired', 'closeout'],
      tld: [...tlds, 'tld0']
    })

    expect(filters.sources).toEqual(['dynadot', 'godaddy'])
    expect(filters.auctionTypes).toEqual(['expired', 'closeout'])
    expect(filters.tlds).toEqual(tlds.slice(0, DOMAIN_TABLE_CATEGORY_VALUE_LIMIT - 4))
    expect(filters.sources.length + filters.auctionTypes.length + filters.tlds.length).toBe(
      DOMAIN_TABLE_CATEGORY_VALUE_LIMIT
    )
    expect(parseDomainTableFilters({ tld: tlds }).tlds).toEqual(
      tlds.slice(0, DOMAIN_TABLE_CATEGORY_VALUE_LIMIT)
    )
  })
})

describe('domain table links and sort direction', () => {
  const filters = parseDomainTableFilters({
    q: 'garden',
    source: ['dynadot'],
    type: ['expired'],
    tld: ['com', 'org'],
    domainLengthMin: '5',
    domainLengthMax: '20',
    noHyphens: '1',
    noDigits: '1',
    priceMin: '12.34',
    priceMax: '500.50',
    bidsMin: '2',
    ageMin: '4',
    ageMax: '25',
    linksMin: '10',
    visitorsMin: '11',
    appraisalMin: '99.09',
    renewalMax: '15',
    majesticTfMin: '10',
    majesticCfMin: '15',
    majesticRefDomainsMin: '20',
    semrushAsMin: '5',
    endingWithin: '24h',
    sort: 'domain',
    direction: 'asc',
    page: '2'
  })

  it('preserves every normalized filter while applying an override', () => {
    const href = buildDomainTableHref(filters, { page: 3 })
    const url = new URL(href, 'https://example.test')

    expect(url.searchParams.get('q')).toBe('garden')
    expect(url.searchParams.getAll('source')).toEqual(['dynadot'])
    expect(url.searchParams.getAll('type')).toEqual(['expired'])
    expect(url.searchParams.getAll('tld')).toEqual(['com', 'org'])
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      domainLengthMin: '5',
      domainLengthMax: '20',
      noHyphens: '1',
      noDigits: '1',
      priceMin: '12.34',
      priceMax: '500.50',
      bidsMin: '2',
      ageMin: '4',
      ageMax: '25',
      linksMin: '10',
      visitorsMin: '11',
      appraisalMin: '99.09',
      renewalMax: '15',
      majesticTfMin: '10',
      majesticCfMin: '15',
      majesticRefDomainsMin: '20',
      semrushAsMin: '5',
      endingWithin: '24h',
      sort: 'domain',
      direction: 'asc',
      page: '3'
    })
    expect(parseDomainTableFilters(Object.fromEntries(url.searchParams))).toEqual({
      ...filters,
      tlds: ['org'],
      page: 3
    })
  })

  it('can remove or replace every filter field and leaves page resets explicit', () => {
    const href = buildDomainTableHref(filters, {
      query: undefined,
      sources: [],
      auctionTypes: [],
      tlds: [],
      domainLengthMin: undefined,
      domainLengthMax: undefined,
      noHyphens: false,
      noDigits: false,
      priceMinCents: undefined,
      priceMaxCents: undefined,
      bidsMin: undefined,
      ageMin: undefined,
      ageMax: undefined,
      linksMin: undefined,
      visitorsMin: undefined,
      appraisalMinCents: undefined,
      renewalMaxCents: undefined,
      majesticTfMin: undefined,
      majesticCfMin: undefined,
      majesticRefDomainsMin: undefined,
      semrushAsMin: undefined,
      endingWithin: undefined,
      sort: 'bids',
      direction: 'desc',
      page: 1
    })

    expect(href).toBe('/?sort=bids&direction=desc&page=1')
    expect(buildDomainTableHref(filters, { query: undefined })).toContain('page=2')
  })

  it('toggles an active sort and starts a new sort ascending', () => {
    expect(nextSortDirection(filters, 'domain')).toBe('desc')
    expect(nextSortDirection({ ...filters, direction: 'desc' }, 'domain')).toBe('asc')
    expect(nextSortDirection(filters, 'age')).toBe('asc')
  })
})

describe('domain table formatting', () => {
  const now = new Date('2026-07-13T10:00:00.000Z')

  it('omits meaningless money decimals and keeps meaningful cents', () => {
    expect(formatMoney(12_500, 'USD')).toBe('$125')
    expect(formatMoney(12_550, 'USD')).toBe('$125.50')
    expect(formatMoney(1234, 'USD')).toBe('$12.34')
    expect(formatMoney(1234, 'NOT_A_CURRENCY')).toBe('NOT_A_CURRENCY 12.34')
    expect(formatMoney(1200, 'NOT_A_CURRENCY')).toBe('NOT_A_CURRENCY 12')
  })

  it('formats long and compact timestamps in UTC', () => {
    expect(formatDateTime(new Date('2026-07-13T09:05:00.000Z'))).toContain('Jul 13, 2026')
    expect(formatDateTime(new Date('2026-07-13T09:05:00.000Z'))).toContain('UTC')
    expect(formatAbsoluteEndTime(new Date('2026-07-14T18:30:00.000Z'))).toBe('Jul 14, 18:30 UTC')
  })

  it.each([
    [12_400, '12.4K', '12,400'],
    [999, '999', '999'],
    [1_250_000, '1.3M', '1,250,000']
  ])('formats compact count %i while retaining its full value', (value, compact, full) => {
    expect(formatCompactCount(value)).toEqual({ compact, full })
  })

  it.each([
    ['dynadot', 'Dynadot'],
    ['dropcatch', 'DropCatch'],
    ['godaddy', 'GoDaddy'],
    ['namecheap', 'Namecheap'],
    ['namejet', 'NameJet'],
    ['namesilo', 'NameSilo'],
    ['other-provider', 'Other Provider']
  ])('normalizes provider %s for display', (value, expected) => {
    expect(formatProvider(value)).toBe(expected)
  })

  it.each([
    ['auction', 'Auction'],
    ['closeout', 'Closeout'],
    ['expired', 'Expired'],
    ['pending_delete', 'Pending Delete'],
    ['EXPIRED', 'Expired']
  ])('normalizes auction type %s for display', (value, expected) => {
    expect(formatAuctionType(value)).toBe(expected)
  })

  it.each([
    [null, null],
    [0, '0 years'],
    [1, '1 year'],
    [12, '12 years']
  ])('formats age %s with a full unit', (value, expected) => {
    expect(formatAge(value)).toBe(expected)
  })

  it.each([
    ['2026-07-13T10:48:59.999Z', '48m', 'red'],
    ['2026-07-13T12:14:59.999Z', '2h 14m', 'amber'],
    ['2026-07-16T16:00:59.999Z', '3d 6h', 'neutral'],
    ['2026-07-13T09:47:01.000Z', 'Ended 12m ago', 'ended'],
    ['2026-07-13T10:00:30.000Z', '<1m', 'red'],
    ['2026-07-13T09:59:30.000Z', 'Ended <1m ago', 'ended'],
    ['2026-07-13T11:00:00.000Z', '1h', 'red'],
    ['2026-07-13T11:00:00.001Z', '1h', 'amber'],
    ['2026-07-14T10:00:00.000Z', '1d', 'amber'],
    ['2026-07-14T10:00:00.001Z', '1d', 'neutral'],
    ['2026-07-13T10:00:00.000Z', 'Ended <1m ago', 'ended']
  ])(
    'formats end %s using floor-rounded whole minutes and exact urgency boundaries',
    (value, relative, state) => {
      expect(formatEndTime(new Date(value), now)).toEqual({ relative, state })
    }
  )

  it('omits zero-value trailing duration units', () => {
    expect(formatEndTime(new Date('2026-07-13T12:00:00.000Z'), now).relative).toBe('2h')
    expect(formatEndTime(new Date('2026-07-15T10:00:00.000Z'), now).relative).toBe('2d')
  })

  it.each([
    [null, 'No successful sync yet'],
    ['2026-07-13T09:59:30.000Z', 'Synced just now'],
    ['2026-07-13T09:59:00.000Z', 'Synced 1 minute ago'],
    ['2026-07-13T09:58:00.000Z', 'Synced 2 minutes ago'],
    ['2026-07-13T09:00:00.000Z', 'Synced 1 hour ago'],
    ['2026-07-13T08:00:00.000Z', 'Synced 2 hours ago'],
    ['2026-07-12T10:00:00.000Z', 'Synced 1 day ago'],
    ['2026-07-11T10:00:00.000Z', 'Synced 2 days ago'],
    ['2026-07-13T10:01:00.000Z', 'Synced just now']
  ])('formats sync recency for %s', (value, expected) => {
    expect(
      formatSyncRecency(
        value === null ? null : new Date(value),
        new Date('2026-07-13T10:00:00.000Z')
      )
    ).toBe(expected)
  })
})

describe('domain table filter summaries', () => {
  const active = parseDomainTableFilters({
    q: 'garden',
    source: ['dynadot', 'godaddy'],
    tld: ['com', 'org'],
    domainLengthMin: '8',
    domainLengthMax: '15',
    ageMin: '3',
    noHyphens: '1',
    noDigits: '1',
    type: ['expired', 'closeout'],
    priceMin: '10.25',
    priceMax: '500',
    renewalMax: '18',
    endingWithin: '24h',
    bidsMin: '5',
    visitorsMin: '10',
    linksMin: '20',
    appraisalMin: '1000',
    majesticTfMin: '10',
    majesticCfMin: '15',
    majesticRefDomainsMin: '20',
    semrushAsMin: '5',
    sort: 'price',
    direction: 'desc',
    page: '4'
  })

  it('detects filters without treating navigation state as a filter', () => {
    expect(hasActiveDomainTableFilters(parseDomainTableFilters({}))).toBe(false)
    expect(
      hasActiveDomainTableFilters(
        parseDomainTableFilters({
          sort: 'domain',
          direction: 'desc',
          page: '9'
        })
      )
    ).toBe(false)
    expect(hasActiveDomainTableFilters(active)).toBe(true)
    for (const metric of [
      'majesticTfMin',
      'majesticCfMin',
      'majesticRefDomainsMin',
      'semrushAsMin'
    ]) {
      expect(hasActiveDomainTableFilters(parseDomainTableFilters({ [metric]: '1' }))).toBe(true)
    }
  })

  it('counts active advanced concepts without counting quick-only values', () => {
    expect(countAdvancedDomainTableFilters(active)).toBe(15)
    expect(
      countAdvancedDomainTableFilters(
        parseDomainTableFilters({
          q: 'garden',
          source: 'dynadot',
          tld: 'com',
          priceMax: '500',
          endingWithin: '24h'
        })
      )
    ).toBe(0)
  })

  it('builds stable human labels and removal links', () => {
    const chips = getDomainTableFilterChips(active)

    expect(chips.map(chip => chip.label)).toEqual([
      'Search: garden',
      'Source: Dynadot, GoDaddy',
      'TLD: .com, .org',
      'Length: 8–15',
      'Age: 3y+',
      'Domain: no hyphens',
      'Domain: no digits',
      'Type: Expired, Closeout',
      'Price: $10.25–$500',
      'Renewal: up to $18',
      'Ends: next 24 hours',
      'Bids: 5+',
      'Visitors: 10+',
      'Links: 20+',
      'Appraisal: $1,000+',
      'Majestic TF: 10+',
      'Majestic CF: 15+',
      'Referring domains: 20+',
      'SEMrush AS: 5+'
    ])

    const priceRemoval = new URL(
      chips.find(chip => chip.key === 'price')!.href,
      'https://example.test'
    )
    expect(priceRemoval.searchParams.has('priceMin')).toBe(false)
    expect(priceRemoval.searchParams.has('priceMax')).toBe(false)
    expect(priceRemoval.searchParams.get('q')).toBe('garden')
    expect(priceRemoval.searchParams.get('sort')).toBe('price')
    expect(priceRemoval.searchParams.get('direction')).toBe('desc')
    expect(priceRemoval.searchParams.get('page')).toBe('1')
  })

  it('labels one-sided maximum ranges', () => {
    const filters = parseDomainTableFilters({
      domainLengthMax: '15',
      ageMax: '20',
      priceMax: '500.50'
    })
    expect(getDomainTableFilterChips(filters).map(chip => chip.label)).toEqual([
      'Length: up to 15',
      'Age: up to 20y',
      'Price: up to $500.50'
    ])
    expect(
      getDomainTableFilterChips(parseDomainTableFilters({ priceMin: '25' })).map(chip => chip.label)
    ).toEqual(['Price: $25+'])
  })

  it.each([
    [null, false],
    ['2026-07-12T10:00:00.000Z', false],
    ['2026-07-12T09:59:59.000Z', true]
  ])('treats a sync at %s as stale: %s', (value, expected) => {
    expect(
      isInventoryStale(
        value === null ? null : new Date(value),
        new Date('2026-07-13T10:00:00.000Z')
      )
    ).toBe(expected)
  })
})
