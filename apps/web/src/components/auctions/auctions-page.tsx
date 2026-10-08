import { DatabaseIcon, SearchXIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, Suspense } from 'react'

import { ActiveFilters } from '@/components/auctions/active-filters'
import { AuctionsToolbar } from '@/components/auctions/auctions-toolbar'
import { CopyCommand } from '@/components/auctions/copy-command'
import { DomainRatingsProvider } from '@/components/auctions/domain-ratings'
import { FetchDomainRatingsButton } from '@/components/auctions/fetch-domain-ratings'
import { ListingDetailsProvider } from '@/components/auctions/listing-details'
import { ResultsList } from '@/components/auctions/results-list'
import { ResultsPagination } from '@/components/auctions/results-pagination'
import { ResultsSkeleton } from '@/components/auctions/results-skeleton'
import { DomainRatingAttribution, ResultsTable } from '@/components/auctions/results-table'
import { TableLayoutProvider } from '@/components/auctions/table-layout'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  buildDomainTableHref,
  type DomainTableFilters,
  formatSyncRecency,
  getDomainTableFilterChips,
  isInventoryStale,
  parseDomainTableFilters
} from '@/domain/domain-table'
import { buildFiltersPageHref } from '@/domain/filter-form'
import type { ColumnKey, ColumnWidths } from '@/domain/table-columns'
import { DOMAIN_RATING_MATCHING_LIMIT } from '@/server/enrichment/domain-rating'
import type { DomainListingsResult, InventoryStatus } from '@/server/queries/domain-listings'

function EmptyFrame({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Domain results" className="rounded-lg border md:flex-1">
      <Empty className="min-h-80">{children}</Empty>
    </section>
  )
}

export async function ListingCount({ result }: { result: Promise<DomainListingsResult> }) {
  const { total } = await result
  return (
    <>
      <span className="font-medium text-foreground">{total.toLocaleString('en-US')}</span>{' '}
      {total === 1 ? 'listing' : 'listings'}
    </>
  )
}

export async function FetchDomainRatings({
  result,
  filters
}: {
  result: Promise<DomainListingsResult>
  filters: DomainTableFilters
}) {
  const { total } = await result
  return (
    <FetchDomainRatingsButton
      total={total}
      limit={DOMAIN_RATING_MATCHING_LIMIT}
      search={buildDomainTableHref(filters).slice('/?'.length)}
    />
  )
}

export async function Results({
  result: pending,
  filters,
  now
}: {
  result: Promise<DomainListingsResult>
  filters: DomainTableFilters
  now: Date
}) {
  const result = await pending
  const clearAll = buildDomainTableHref(parseDomainTableFilters({}), {
    sort: filters.sort,
    direction: filters.direction
  })
  const chips = getDomainTableFilterChips(filters).length

  if (result.rows.length === 0 && chips > 0) {
    return (
      <EmptyFrame>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h2>No listings match these filters</h2>
          </EmptyTitle>
          <EmptyDescription>
            Nothing in the active inventory meets all {chips} {chips === 1 ? 'filter' : 'filters'}.
            Remove one, or clear them all to see every listing.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Link
            prefetch={false}
            href={clearAll}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Clear all filters
          </Link>
          <Link
            prefetch={false}
            href={buildFiltersPageHref(filters)}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Edit filters
          </Link>
        </EmptyContent>
      </EmptyFrame>
    )
  }
  if (result.rows.length === 0) {
    return (
      <EmptyFrame>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DatabaseIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h2>No auctions collected yet</h2>
          </EmptyTitle>
          <EmptyDescription>
            Run a sync to load listings into the local database. GoDaddy needs no credentials and
            takes about 3 minutes.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <CopyCommand command="corepack pnpm sync godaddy" />
          <Link
            prefetch={false}
            href="/syncs/"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            View sync status
          </Link>
        </EmptyContent>
      </EmptyFrame>
    )
  }

  const effectiveFilters = { ...filters, page: result.page }
  return (
    <DomainRatingsProvider
      domains={result.rows.filter(row => !row.domainRatingFetched).map(row => row.domainName)}
    >
      <section
        aria-label="Domain results"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable to scroll.
        tabIndex={0}
        data-testid="domain-results-scroll-container"
        // The frame scrolls both ways so the header and Domain column stay
        // sticky; the stock Table's own scroll wrapper becomes a pass-through.
        className="relative hidden min-h-0 overflow-auto overscroll-contain rounded-lg border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:block md:flex-1 [&_[data-slot=table-container]]:overflow-visible"
      >
        <ResultsTable rows={result.rows} filters={effectiveFilters} now={now} />
      </section>
      {/* Phones get a list instead of the wide table. */}
      <div className="-mx-4 border-y md:hidden">
        <ResultsList rows={result.rows} now={now} />
      </div>
      <ResultsPagination filters={filters} page={result.page} total={result.total}>
        <DomainRatingAttribution />
      </ResultsPagination>
    </DomainRatingsProvider>
  )
}

// The toolbar, chips, and freshness come from the URL and a small status read,
// so they render at once. The listing query streams in behind a skeleton keyed
// by the URL, which also shows on every filter, sort, and page change.
export function AuctionsPage({
  filters,
  status,
  result,
  visibleColumns,
  columnWidths,
  now
}: {
  filters: DomainTableFilters
  status: InventoryStatus
  result: Promise<DomainListingsResult>
  visibleColumns: ColumnKey[]
  columnWidths: ColumnWidths
  now: Date
}) {
  // Layout changes never reach the server, so only the URL resets the skeleton.
  const key = buildDomainTableHref(filters)

  return (
    <TableLayoutProvider initialColumns={visibleColumns} initialWidths={columnWidths}>
      <ListingDetailsProvider now={now}>
        <div className="flex min-h-0 flex-col gap-3 px-4 pt-3 pb-3 md:h-[calc(100svh-3rem)]">
          <h1 className="sr-only">Auctions</h1>
          <AuctionsToolbar
            filters={filters}
            sources={status.sources}
            auctionTypes={status.auctionTypes}
            tlds={status.tlds}
            count={
              <Suspense
                key={key}
                fallback={<Skeleton className="inline-block h-4 w-24 align-middle" />}
              >
                <ListingCount result={result} />
              </Suspense>
            }
            actions={
              <Suspense key={key} fallback={null}>
                <FetchDomainRatings result={result} filters={filters} />
              </Suspense>
            }
          />
          <ActiveFilters
            filters={filters}
            className="md:hidden"
            actions={
              <Suspense key={key} fallback={null}>
                <FetchDomainRatings result={result} filters={filters} />
              </Suspense>
            }
          />
          {isInventoryStale(status.latestSuccessfulSync, now) ? (
            <Alert
              role="status"
              className="border-warning-foreground/30 bg-warning text-warning-foreground"
            >
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>The inventory is out of date</AlertTitle>
              <AlertAction>
                <Link
                  prefetch={false}
                  href="/syncs/"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Sync status
                </Link>
              </AlertAction>
              <AlertDescription className="text-warning-foreground/90">
                {formatSyncRecency(status.latestSuccessfulSync, now)}. Ended auctions are hidden,
                but prices, bids, and new listings may be out of date until the next sync.
              </AlertDescription>
            </Alert>
          ) : null}
          <Suspense key={key} fallback={<ResultsSkeleton visibleColumns={visibleColumns} />}>
            <Results result={result} filters={filters} now={now} />
          </Suspense>
        </div>
      </ListingDetailsProvider>
    </TableLayoutProvider>
  )
}
