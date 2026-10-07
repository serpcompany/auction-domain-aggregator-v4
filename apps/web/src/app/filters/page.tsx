import type { Metadata } from 'next'

import { SiteHeader } from '@/components/app-shell/site-header'
import { FiltersForm } from '@/components/filters/filters-form'
import {
  buildDomainTableHref,
  type DomainTableSearchParams,
  parseDomainTableFilters
} from '@/domain/domain-table'
import { queryListingFacets } from '@/server/queries/domain-listings'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Filters · Auction Domain Aggregator' }

export default async function FiltersPage({
  searchParams
}: {
  searchParams: Promise<DomainTableSearchParams>
}) {
  const filters = parseDomainTableFilters(await searchParams)
  const facets = await queryListingFacets()

  return (
    <>
      <SiteHeader
        title="Filters"
        parent={{ label: 'Auctions', href: buildDomainTableHref(filters) }}
      />
      <FiltersForm key={buildDomainTableHref(filters)} filters={filters} {...facets} />
    </>
  )
}
