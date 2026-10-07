import { cookies } from 'next/headers'

import { FreshnessBadge } from '@/components/app-shell/freshness-badge'
import { SiteHeader } from '@/components/app-shell/site-header'
import { AuctionsPage } from '@/components/auctions/auctions-page'
import { type DomainTableSearchParams, parseDomainTableFilters } from '@/domain/domain-table'
import { COLUMNS_COOKIE, parseVisibleColumns } from '@/domain/table-columns'
import { queryDomainListings } from '@/server/queries/domain-listings'

export const dynamic = 'force-dynamic'

export default async function Home({
  searchParams
}: {
  searchParams: Promise<DomainTableSearchParams>
}) {
  const filters = parseDomainTableFilters(await searchParams)
  const visibleColumns = parseVisibleColumns((await cookies()).get(COLUMNS_COOKIE)?.value)
  const result = await queryDomainListings(filters)
  const now = new Date()

  return (
    <>
      <SiteHeader title="Auctions">
        <FreshnessBadge latestSuccessfulSync={result.latestSuccessfulSync} now={now} />
      </SiteHeader>
      <AuctionsPage filters={filters} result={result} visibleColumns={visibleColumns} now={now} />
    </>
  )
}
