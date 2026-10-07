import {
  buildDomainTableHref,
  type DomainTableFilters,
  type DomainTableSearchParams
} from '@/domain/domain-table'

// The Filters page (/filters/) groups every filter into these sections.
export const FILTER_SECTIONS = [
  { id: 'general', title: 'General', description: 'The same filters as the toolbar.' },
  { id: 'auction', title: 'Auction', description: 'Auction type and price.' },
  {
    id: 'name',
    title: 'Name',
    description: 'Shape and age of the domain name. Length counts the whole name, TLD included.'
  },
  {
    id: 'activity',
    title: 'Activity and value',
    description: 'Unknown values stay eligible until you set a limit.'
  },
  {
    id: 'seo',
    title: 'SEO metrics',
    description:
      'Majestic and Semrush values come from the GoDaddy auction feed. Domains without a value are excluded once you set a minimum.'
  }
] as const

export type FilterSectionId = (typeof FILTER_SECTIONS)[number]['id']

export const FILTER_RANGES = [
  { minimum: 'priceMin', maximum: 'priceMax', label: 'current bid' },
  { minimum: 'domainLengthMin', maximum: 'domainLengthMax', label: 'domain length' },
  { minimum: 'ageMin', maximum: 'ageMax', label: 'domain age' }
] as const

export type FilterRange = (typeof FILTER_RANGES)[number]

// Form fields carry the URL parameter names, so the form reads straight into
// the same parser the page uses for its URL.
export function formDataToSearchParams(data: FormData): DomainTableSearchParams {
  const params: Record<string, string[]> = {}
  for (const [name, value] of data.entries()) {
    if (typeof value !== 'string' || value.trim() === '') continue
    params[name] = [...(params[name] ?? []), value]
  }
  return params
}

function numberValue(params: DomainTableSearchParams, name: string) {
  const value = params[name]
  const first = Array.isArray(value) ? value[0] : value
  if (first === undefined) return undefined
  const parsed = Number(first)
  return Number.isFinite(parsed) ? parsed : undefined
}

// The URL parser quietly swaps a reversed range; the form asks for a fix instead.
export function findInvalidRange(params: DomainTableSearchParams): FilterRange | undefined {
  return FILTER_RANGES.find(range => {
    const minimum = numberValue(params, range.minimum)
    const maximum = numberValue(params, range.maximum)
    return minimum !== undefined && maximum !== undefined && minimum > maximum
  })
}

export function rangeErrorMessage(range: FilterRange) {
  return `Minimum ${range.label} cannot exceed maximum ${range.label}. Lower the minimum or raise the maximum.`
}

const count = (...set: boolean[]) => set.filter(Boolean).length

export function countFiltersBySection(
  filters: DomainTableFilters
): Record<FilterSectionId, number> {
  return {
    general: count(
      filters.query !== undefined,
      filters.sources.length > 0,
      filters.tlds.length > 0,
      filters.endingWithin !== undefined
    ),
    auction: count(
      filters.auctionTypes.length > 0,
      filters.priceMinCents !== undefined || filters.priceMaxCents !== undefined,
      filters.renewalMaxCents !== undefined
    ),
    name: count(
      filters.domainLengthMin !== undefined || filters.domainLengthMax !== undefined,
      filters.ageMin !== undefined || filters.ageMax !== undefined,
      filters.noHyphens,
      filters.noDigits
    ),
    activity: count(
      filters.bidsMin !== undefined,
      filters.visitorsMin !== undefined,
      filters.linksMin !== undefined,
      filters.appraisalMinCents !== undefined
    ),
    seo: count(
      filters.majesticTfMin !== undefined,
      filters.majesticCfMin !== undefined,
      filters.majesticRefDomainsMin !== undefined,
      filters.semrushAsMin !== undefined
    )
  }
}

// The Filters page carries the same query string as the table.
export function buildFiltersPageHref(filters: DomainTableFilters) {
  return `/filters/${buildDomainTableHref(filters).slice(1)}`
}
