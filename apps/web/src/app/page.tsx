import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { FreshnessBadge } from '@/components/app-shell/freshness-badge'
import { SiteHeader } from '@/components/app-shell/site-header'
import { AuctionsPage } from '@/components/auctions/auctions-page'
import {
  type DomainTableSearchParams,
  openingDomainTableHref,
  parseDomainTableFilters
} from '@/domain/domain-table'
import {
  COLUMN_LAYOUT_COOKIE,
  COLUMN_WIDTHS_COOKIE,
  COLUMNS_COOKIE,
  parseColumnLayout,
  parseColumnWidths,
  parseVisibleColumns
} from '@/domain/table-columns'
import { queryDomainListings, queryInventoryStatus } from '@/server/queries/domain-listings'

export const dynamic = 'force-dynamic'

export default async function Home({
  searchParams
}: {
  searchParams: Promise<DomainTableSearchParams>
}) {
  const params = await searchParams
  const opening = openingDomainTableHref(params)
  if (opening) redirect(opening)
  const filters = parseDomainTableFilters(params)
  const cookieStore = await cookies()
  const visibleColumns = parseVisibleColumns(cookieStore.get(COLUMNS_COOKIE)?.value)
  const columnLayout = parseColumnLayout(cookieStore.get(COLUMN_LAYOUT_COOKIE)?.value)
  const columnWidths = parseColumnWidths(cookieStore.get(COLUMN_WIDTHS_COOKIE)?.value)
  // D1 reads stay sequential: the status read finishes before the listing
  // query starts, and the listing query streams in behind a skeleton.
  const status = await queryInventoryStatus()
  const result = queryDomainListings(filters)
  const now = new Date()

  return (
    <>
      <SiteHeader title="Auctions">
        <FreshnessBadge latestSuccessfulSync={status.latestSuccessfulSync} now={now} />
      </SiteHeader>
      <AuctionsPage
        filters={filters}
        status={status}
        result={result}
        visibleColumns={visibleColumns}
        columnLayout={columnLayout}
        columnWidths={columnWidths}
        now={now}
      />
    </>
  )
}
