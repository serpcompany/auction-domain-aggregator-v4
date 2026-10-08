// A load reads every matching row for the count whatever the page size, so a
// larger page shows more listings for nearly the same rows read. The page
// lookups bind one value per row plus at most one constant, so a page holds
// at most 99 rows under D1's 100 bound values; 96 is two DR requests of 48.
export const DOMAIN_TABLE_PAGE_SIZE = 96
export const MAX_DOMAIN_TABLE_PAGE = 100_000
// With active status, the reference time, every scalar filter (19 values),
// row limit, and offset, the worst accepted row query binds 87 values, below
// D1's 100-parameter statement limit.
export const DOMAIN_TABLE_CATEGORY_VALUE_LIMIT = 64

export const DOMAIN_TABLE_SORTS = [
  'domain',
  'source',
  'type',
  'price',
  'bids',
  'endsAt',
  'age',
  'links',
  'visitors',
  'appraisal',
  'renewal',
  'domainLength',
  'majesticTf',
  'majesticCf',
  'majesticRefDomains',
  'semrushAs',
  'domainRating'
] as const

export const DOMAIN_TABLE_ENDING_WINDOWS = ['1h', '6h', '24h', '3d', '7d'] as const

export const DOMAIN_TABLE_AUCTION_SOURCES = [
  'dynadot',
  'dropcatch',
  'godaddy',
  'namecheap',
  'namejet',
  'namesilo'
] as const
export const DOMAIN_TABLE_AUCTION_TYPES = ['auction', 'buy_now', 'closeout', 'expired'] as const

export type DomainTableSort = (typeof DOMAIN_TABLE_SORTS)[number]
export type DomainTableEndingWindow = (typeof DOMAIN_TABLE_ENDING_WINDOWS)[number]
export type SortDirection = 'asc' | 'desc'
export type AuctionSource = (typeof DOMAIN_TABLE_AUCTION_SOURCES)[number]
export type AuctionType = (typeof DOMAIN_TABLE_AUCTION_TYPES)[number]

export interface DomainTableFilters {
  query?: string
  sources: AuctionSource[]
  auctionTypes: AuctionType[]
  tlds: string[]
  domainLengthMin?: number
  domainLengthMax?: number
  noHyphens: boolean
  noDigits: boolean
  priceMinCents?: number
  priceMaxCents?: number
  bidsMin?: number
  ageMin?: number
  ageMax?: number
  linksMin?: number
  visitorsMin?: number
  appraisalMinCents?: number
  renewalMaxCents?: number
  // Feed-provided SEO metrics (domain_seo_metrics). Each minimum excludes
  // domains without that metric.
  majesticTfMin?: number
  majesticCfMin?: number
  majesticRefDomainsMin?: number
  semrushAsMin?: number
  // Ahrefs DR (domain_metrics). Matches only domains with a stored rating.
  domainRatingMin?: number
  endingWithin?: DomainTableEndingWindow
  sort: DomainTableSort
  direction: SortDirection
  page: number
  pageSize: typeof DOMAIN_TABLE_PAGE_SIZE
}

export type DomainTableSearchParams = Record<string, string | string[] | undefined>

type DomainTableHrefOverrides = Partial<Omit<DomainTableFilters, 'pageSize'>>

export interface DomainTableFilterChip {
  key: string
  label: string
  href: string
}

const MAX_INTEGER_FILTER = Number.MAX_SAFE_INTEGER
const MAX_MONEY_MAJOR_DIGITS = 13

function values(value: string | string[] | undefined) {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function firstValue(value: string | string[] | undefined) {
  return values(value)[0]
}

function normalizeQuery(value: string | undefined) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized || normalized.length > 253) return undefined
  return normalized
}

function normalizeAllowlist<const Value extends string>(
  value: string | string[] | undefined,
  allowlist: readonly Value[],
  maximum: number
) {
  const normalized: Value[] = []
  for (const item of values(value)) {
    const candidate = item.trim().toLowerCase() as Value
    if (
      allowlist.includes(candidate) &&
      !normalized.includes(candidate) &&
      normalized.length < maximum
    ) {
      normalized.push(candidate)
    }
  }
  return normalized
}

function normalizeTlds(value: string | string[] | undefined, maximum: number) {
  const normalized: string[] = []
  for (const item of values(value)) {
    const candidate = item.trim().toLowerCase().replace(/^\./, '')
    if (
      candidate.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(candidate) &&
      !normalized.includes(candidate) &&
      normalized.length < maximum
    ) {
      normalized.push(candidate)
    }
  }
  return normalized
}

function normalizeInteger(value: string | undefined, maximum = MAX_INTEGER_FILTER) {
  if (!value || !/^\d{1,16}$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined
}

function normalizeMoney(value: string | undefined) {
  if (!value) return undefined
  const match = new RegExp(`^(\\d{1,${MAX_MONEY_MAJOR_DIGITS}})(?:\\.(\\d{1,2}))?$`).exec(
    value.trim()
  )
  if (!match) return undefined
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

function normalizeBoolean(value: string | string[] | undefined) {
  return values(value).some(item => ['1', 'true', 'on'].includes(item.trim().toLowerCase()))
}

function ascendingRange(minimum: number | undefined, maximum: number | undefined) {
  return minimum !== undefined && maximum !== undefined && minimum > maximum
    ? ([maximum, minimum] as const)
    : ([minimum, maximum] as const)
}

export function parseDomainTableFilters(searchParams: DomainTableSearchParams): DomainTableFilters {
  const sortValue = firstValue(searchParams.sort)
  const directionValue = firstValue(searchParams.direction)
  const parsedPage = normalizeInteger(firstValue(searchParams.page))
  const endingWithin = firstValue(searchParams.endingWithin)?.toLowerCase()
  const [domainLengthMin, domainLengthMax] = ascendingRange(
    normalizeInteger(firstValue(searchParams.domainLengthMin), 253),
    normalizeInteger(firstValue(searchParams.domainLengthMax), 253)
  )
  const [priceMinCents, priceMaxCents] = ascendingRange(
    normalizeMoney(firstValue(searchParams.priceMin)),
    normalizeMoney(firstValue(searchParams.priceMax))
  )
  const [ageMin, ageMax] = ascendingRange(
    normalizeInteger(firstValue(searchParams.ageMin)),
    normalizeInteger(firstValue(searchParams.ageMax))
  )
  let categoryValuesRemaining = DOMAIN_TABLE_CATEGORY_VALUE_LIMIT
  const sources = normalizeAllowlist(
    searchParams.source,
    DOMAIN_TABLE_AUCTION_SOURCES,
    categoryValuesRemaining
  )
  categoryValuesRemaining -= sources.length
  const auctionTypes = normalizeAllowlist(
    searchParams.type,
    DOMAIN_TABLE_AUCTION_TYPES,
    categoryValuesRemaining
  )
  categoryValuesRemaining -= auctionTypes.length
  const tlds = normalizeTlds(searchParams.tld, categoryValuesRemaining)

  return {
    query: normalizeQuery(firstValue(searchParams.q)),
    sources,
    auctionTypes,
    tlds,
    domainLengthMin,
    domainLengthMax,
    noHyphens: normalizeBoolean(searchParams.noHyphens),
    noDigits: normalizeBoolean(searchParams.noDigits),
    priceMinCents,
    priceMaxCents,
    bidsMin: normalizeInteger(firstValue(searchParams.bidsMin)),
    ageMin,
    ageMax,
    linksMin: normalizeInteger(firstValue(searchParams.linksMin)),
    visitorsMin: normalizeInteger(firstValue(searchParams.visitorsMin)),
    appraisalMinCents: normalizeMoney(firstValue(searchParams.appraisalMin)),
    renewalMaxCents: normalizeMoney(firstValue(searchParams.renewalMax)),
    majesticTfMin: normalizeInteger(firstValue(searchParams.majesticTfMin), 100),
    majesticCfMin: normalizeInteger(firstValue(searchParams.majesticCfMin), 100),
    majesticRefDomainsMin: normalizeInteger(firstValue(searchParams.majesticRefDomainsMin)),
    semrushAsMin: normalizeInteger(firstValue(searchParams.semrushAsMin), 100),
    domainRatingMin: normalizeInteger(firstValue(searchParams.domainRatingMin), 100),
    endingWithin: DOMAIN_TABLE_ENDING_WINDOWS.includes(endingWithin as DomainTableEndingWindow)
      ? (endingWithin as DomainTableEndingWindow)
      : undefined,
    sort: DOMAIN_TABLE_SORTS.includes(sortValue as DomainTableSort)
      ? (sortValue as DomainTableSort)
      : 'endsAt',
    direction: directionValue === 'desc' || directionValue === 'asc' ? directionValue : 'asc',
    page: Math.min(Math.max(parsedPage ?? 1, 1), MAX_DOMAIN_TABLE_PAGE),
    pageSize: DOMAIN_TABLE_PAGE_SIZE
  }
}

// A table URL's query string, as the record `parseDomainTableFilters` reads.
export function queryStringToSearchParams(search: string): DomainTableSearchParams {
  const params: Record<string, string[]> = {}
  for (const [name, value] of new URLSearchParams(search)) {
    params[name] = [...(params[name] ?? []), value]
  }
  return params
}

// Cents as the dollar amount URLs and inputs use: "12" or "12.50".
export function centsToDollarsText(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

function appendMoney(params: URLSearchParams, key: string, cents?: number) {
  if (cents === undefined) return
  params.set(key, centsToDollarsText(cents))
}

export function buildDomainTableHref(
  filters: DomainTableFilters,
  overrides: DomainTableHrefOverrides = {}
) {
  const next = { ...filters, ...overrides }
  const params = new URLSearchParams()

  if (next.query) params.set('q', next.query)
  for (const source of next.sources) params.append('source', source)
  for (const auctionType of next.auctionTypes) params.append('type', auctionType)
  for (const tld of next.tlds) params.append('tld', tld)
  if (next.domainLengthMin !== undefined)
    params.set('domainLengthMin', String(next.domainLengthMin))
  if (next.domainLengthMax !== undefined)
    params.set('domainLengthMax', String(next.domainLengthMax))
  if (next.noHyphens) params.set('noHyphens', '1')
  if (next.noDigits) params.set('noDigits', '1')
  appendMoney(params, 'priceMin', next.priceMinCents)
  appendMoney(params, 'priceMax', next.priceMaxCents)
  if (next.bidsMin !== undefined) params.set('bidsMin', String(next.bidsMin))
  if (next.ageMin !== undefined) params.set('ageMin', String(next.ageMin))
  if (next.ageMax !== undefined) params.set('ageMax', String(next.ageMax))
  if (next.linksMin !== undefined) params.set('linksMin', String(next.linksMin))
  if (next.visitorsMin !== undefined) params.set('visitorsMin', String(next.visitorsMin))
  appendMoney(params, 'appraisalMin', next.appraisalMinCents)
  appendMoney(params, 'renewalMax', next.renewalMaxCents)
  if (next.majesticTfMin !== undefined) params.set('majesticTfMin', String(next.majesticTfMin))
  if (next.majesticCfMin !== undefined) params.set('majesticCfMin', String(next.majesticCfMin))
  if (next.majesticRefDomainsMin !== undefined)
    params.set('majesticRefDomainsMin', String(next.majesticRefDomainsMin))
  if (next.semrushAsMin !== undefined) params.set('semrushAsMin', String(next.semrushAsMin))
  if (next.domainRatingMin !== undefined)
    params.set('domainRatingMin', String(next.domainRatingMin))
  if (next.endingWithin) params.set('endingWithin', next.endingWithin)
  params.set('sort', next.sort)
  params.set('direction', next.direction)
  params.set('page', String(next.page))

  return `/?${params.toString()}`
}

// The table opens on auctions: expired-domain listings are one filter chip
// away. Only the bare address, with no parameters at all, opens there, so
// every other URL, including Clear all, keeps its meaning.
export function openingDomainTableHref(searchParams: DomainTableSearchParams) {
  return Object.keys(searchParams).length === 0
    ? buildDomainTableHref(parseDomainTableFilters({ type: 'auction' }))
    : null
}

export function hasActiveDomainTableFilters(filters: DomainTableFilters) {
  return (
    filters.query !== undefined ||
    filters.sources.length > 0 ||
    filters.auctionTypes.length > 0 ||
    filters.tlds.length > 0 ||
    filters.domainLengthMin !== undefined ||
    filters.domainLengthMax !== undefined ||
    filters.noHyphens ||
    filters.noDigits ||
    filters.priceMinCents !== undefined ||
    filters.priceMaxCents !== undefined ||
    filters.bidsMin !== undefined ||
    filters.ageMin !== undefined ||
    filters.ageMax !== undefined ||
    filters.linksMin !== undefined ||
    filters.visitorsMin !== undefined ||
    filters.appraisalMinCents !== undefined ||
    filters.renewalMaxCents !== undefined ||
    filters.majesticTfMin !== undefined ||
    filters.majesticCfMin !== undefined ||
    filters.majesticRefDomainsMin !== undefined ||
    filters.semrushAsMin !== undefined ||
    filters.domainRatingMin !== undefined ||
    filters.endingWithin !== undefined
  )
}

export function countAdvancedDomainTableFilters(filters: DomainTableFilters) {
  return [
    filters.domainLengthMin !== undefined || filters.domainLengthMax !== undefined,
    filters.ageMin !== undefined || filters.ageMax !== undefined,
    filters.noHyphens,
    filters.noDigits,
    filters.priceMinCents !== undefined,
    filters.renewalMaxCents !== undefined,
    filters.bidsMin !== undefined,
    filters.visitorsMin !== undefined,
    filters.linksMin !== undefined,
    filters.appraisalMinCents !== undefined,
    filters.majesticTfMin !== undefined,
    filters.majesticCfMin !== undefined,
    filters.majesticRefDomainsMin !== undefined,
    filters.semrushAsMin !== undefined,
    filters.domainRatingMin !== undefined
  ].filter(Boolean).length
}

function titleCase(value: string) {
  return value
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function filterMoney(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format(cents / 100)
}

function rangeLabel(minimum: number | undefined, maximum: number | undefined, unit = '') {
  if (minimum !== undefined && maximum !== undefined) return `${minimum}${unit}–${maximum}${unit}`
  if (minimum !== undefined) return `${minimum}${unit}+`
  return `up to ${maximum}${unit}`
}

const endingWindowLabels: Record<DomainTableEndingWindow, string> = {
  '1h': 'next 1 hour',
  '6h': 'next 6 hours',
  '24h': 'next 24 hours',
  '3d': 'next 3 days',
  '7d': 'next 7 days'
}

export function getDomainTableFilterChips(filters: DomainTableFilters): DomainTableFilterChip[] {
  const chips: DomainTableFilterChip[] = []
  const add = (key: string, label: string, overrides: DomainTableHrefOverrides) =>
    chips.push({
      key,
      label,
      href: buildDomainTableHref(filters, { ...overrides, page: 1 })
    })

  if (filters.query) add('query', `Search: ${filters.query}`, { query: undefined })
  if (filters.sources.length > 0)
    add('sources', `Source: ${filters.sources.map(formatProvider).join(', ')}`, {
      sources: []
    })
  if (filters.tlds.length > 0)
    add('tlds', `TLD: ${filters.tlds.map(tld => `.${tld}`).join(', ')}`, {
      tlds: []
    })
  if (filters.domainLengthMin !== undefined || filters.domainLengthMax !== undefined)
    add(
      'domain-length',
      `Length: ${rangeLabel(filters.domainLengthMin, filters.domainLengthMax)}`,
      { domainLengthMin: undefined, domainLengthMax: undefined }
    )
  if (filters.ageMin !== undefined || filters.ageMax !== undefined)
    add('age', `Age: ${rangeLabel(filters.ageMin, filters.ageMax, 'y')}`, {
      ageMin: undefined,
      ageMax: undefined
    })
  if (filters.noHyphens) add('no-hyphens', 'Domain: no hyphens', { noHyphens: false })
  if (filters.noDigits) add('no-digits', 'Domain: no digits', { noDigits: false })
  if (filters.auctionTypes.length > 0)
    add('auction-types', `Type: ${filters.auctionTypes.map(titleCase).join(', ')}`, {
      auctionTypes: []
    })
  if (filters.priceMinCents !== undefined || filters.priceMaxCents !== undefined) {
    const price =
      filters.priceMinCents !== undefined && filters.priceMaxCents !== undefined
        ? `${filterMoney(filters.priceMinCents)}–${filterMoney(filters.priceMaxCents)}`
        : filters.priceMinCents !== undefined
          ? `${filterMoney(filters.priceMinCents)}+`
          : `up to ${filterMoney(filters.priceMaxCents!)}`
    add('price', `Price: ${price}`, {
      priceMinCents: undefined,
      priceMaxCents: undefined
    })
  }
  if (filters.renewalMaxCents !== undefined)
    add('renewal', `Renewal: up to ${filterMoney(filters.renewalMaxCents)}`, {
      renewalMaxCents: undefined
    })
  if (filters.endingWithin)
    add('ending', `Ends: ${endingWindowLabels[filters.endingWithin]}`, {
      endingWithin: undefined
    })
  if (filters.bidsMin !== undefined)
    add('bids', `Bids: ${filters.bidsMin}+`, { bidsMin: undefined })
  if (filters.visitorsMin !== undefined)
    add('visitors', `Visitors: ${filters.visitorsMin}+`, {
      visitorsMin: undefined
    })
  if (filters.linksMin !== undefined)
    add('links', `Links: ${filters.linksMin}+`, { linksMin: undefined })
  if (filters.appraisalMinCents !== undefined)
    add('appraisal', `Appraisal: ${filterMoney(filters.appraisalMinCents)}+`, {
      appraisalMinCents: undefined
    })
  if (filters.majesticTfMin !== undefined)
    add('majestic-tf', `Majestic TF: ${filters.majesticTfMin}+`, {
      majesticTfMin: undefined
    })
  if (filters.majesticCfMin !== undefined)
    add('majestic-cf', `Majestic CF: ${filters.majesticCfMin}+`, {
      majesticCfMin: undefined
    })
  if (filters.majesticRefDomainsMin !== undefined)
    add('majestic-ref-domains', `Referring domains: ${filters.majesticRefDomainsMin}+`, {
      majesticRefDomainsMin: undefined
    })
  if (filters.semrushAsMin !== undefined)
    add('semrush-as', `SEMrush AS: ${filters.semrushAsMin}+`, {
      semrushAsMin: undefined
    })
  if (filters.domainRatingMin !== undefined)
    add('domain-rating', `Ahrefs DR: ${filters.domainRatingMin}+`, {
      domainRatingMin: undefined
    })

  return chips
}

// Quality metrics are read best-first, so a new metric sort starts high.
const DESCENDING_FIRST_SORTS: ReadonlyArray<DomainTableSort> = [
  'majesticTf',
  'majesticCf',
  'majesticRefDomains',
  'semrushAs',
  'domainRating'
]

export function nextSortDirection(
  filters: DomainTableFilters,
  sort: DomainTableSort
): SortDirection {
  if (filters.sort !== sort) return DESCENDING_FIRST_SORTS.includes(sort) ? 'desc' : 'asc'
  return filters.direction === 'asc' ? 'desc' : 'asc'
}

export function formatMoney(cents: number, currency: string) {
  const hasFraction = Math.abs(cents) % 100 !== 0
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: hasFraction ? 2 : 0
    }).format(cents / 100)
  } catch {
    return `${currency} ${(cents / 100).toFixed(hasFraction ? 2 : 0)}`
  }
}

export function formatCompactCount(value: number) {
  return {
    compact: new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(value),
    full: value.toLocaleString('en-US')
  }
}

const providerLabels: Record<AuctionSource, string> = {
  dynadot: 'Dynadot',
  dropcatch: 'DropCatch',
  godaddy: 'GoDaddy',
  namecheap: 'Namecheap',
  namejet: 'NameJet',
  namesilo: 'NameSilo'
}

export function formatProvider(value: string) {
  return providerLabels[value.toLowerCase() as AuctionSource] ?? titleCase(value)
}

export function formatAuctionType(value: string) {
  return titleCase(value.toLowerCase())
}

export function formatAbsoluteEndTime(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC'
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value
  return `${part('month')} ${part('day')}, ${part('hour')}:${part('minute')} UTC`
}

export type EndTimeState = 'neutral' | 'amber' | 'red' | 'ended'

export interface FormattedEndTime {
  relative: string
  state: EndTimeState
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function compactDuration(milliseconds: number) {
  const minutes = Math.floor(milliseconds / MINUTE_MS)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const remainingMinutes = minutes % 60
    return `${hours}h${remainingMinutes === 0 ? '' : ` ${remainingMinutes}m`}`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d${remainingHours === 0 ? '' : ` ${remainingHours}h`}`
}

/**
 * Durations floor elapsed whole minutes. Urgency uses the exact timestamp:
 * red through 1h, amber through 24h, and neutral beyond 24h.
 */
export function formatEndTime(value: Date, now: Date): FormattedEndTime {
  const remaining = value.getTime() - now.getTime()
  if (remaining <= 0) {
    return {
      relative: `Ended ${compactDuration(Math.abs(remaining))} ago`,
      state: 'ended'
    }
  }
  return {
    relative: compactDuration(remaining),
    state: remaining <= HOUR_MS ? 'red' : remaining <= DAY_MS ? 'amber' : 'neutral'
  }
}

export function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(value)
}

export const STALE_INVENTORY_MILLISECONDS = 24 * 60 * 60 * 1_000

export function isInventoryStale(value: Date | null, now = new Date()) {
  return value !== null && now.getTime() - value.getTime() > STALE_INVENTORY_MILLISECONDS
}

export function formatSyncRecency(value: Date | null, now = new Date()) {
  if (!value) return 'No successful sync yet'

  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1_000))
  if (elapsedSeconds < 60) return 'Synced just now'

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60)
    return `Synced ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `Synced ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`

  const elapsedDays = Math.floor(elapsedHours / 24)
  return `Synced ${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`
}
