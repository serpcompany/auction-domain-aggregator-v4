import { FreshnessBadge } from '@/components/app-shell/freshness-badge'
import { SiteHeader } from '@/components/app-shell/site-header'
import { DomainDiscovery } from '@/components/domain-discovery'
import { type DomainTableSearchParams, parseDomainTableFilters } from '@/domain/domain-table'
import { queryDomainListings } from '@/server/queries/domain-listings'

export const dynamic = 'force-dynamic'

export default async function Home({
  searchParams
}: {
  searchParams: Promise<DomainTableSearchParams>
}) {
  const filters = parseDomainTableFilters(await searchParams)
  const result = await queryDomainListings(filters)
  const now = new Date()

  return (
    <>
      <SiteHeader title="Auctions">
        <FreshnessBadge latestSuccessfulSync={result.latestSuccessfulSync} now={now} />
      </SiteHeader>
      <DomainDiscovery filters={filters} result={result} now={now} />
    </>
  )
}
