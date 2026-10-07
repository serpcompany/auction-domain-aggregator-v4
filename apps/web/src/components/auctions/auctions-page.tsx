import { GlobeIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'

import { ActiveFilters } from '@/components/auctions/active-filters'
import { AuctionsToolbar } from '@/components/auctions/auctions-toolbar'
import { ResultsPagination } from '@/components/auctions/results-pagination'
import { ResultsTable } from '@/components/auctions/results-table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import {
  buildDomainTableHref,
  type DomainTableFilters,
  hasActiveDomainTableFilters,
  isInventoryStale,
  parseDomainTableFilters
} from '@/domain/domain-table'
import type { ColumnKey } from '@/domain/table-columns'
import type { DomainListingsResult } from '@/server/queries/domain-listings'

export function AuctionsPage({
  filters,
  result,
  visibleColumns,
  now
}: {
  filters: DomainTableFilters
  result: DomainListingsResult
  visibleColumns: ColumnKey[]
  now: Date
}) {
  const effectiveFilters = { ...filters, page: result.page }
  const hasFilters = hasActiveDomainTableFilters(filters)

  return (
    <div className="flex min-h-0 flex-col gap-3 px-4 pt-3 pb-3 md:h-[calc(100svh-3rem)]">
      <h1 className="sr-only">Auctions</h1>
      <AuctionsToolbar
        filters={effectiveFilters}
        sources={result.sources}
        tlds={result.tlds}
        total={result.total}
        visibleColumns={visibleColumns}
      />
      <ActiveFilters filters={filters} />
      {isInventoryStale(result.latestSuccessfulSync, now) ? (
        <Alert
          role="status"
          className="border-warning-foreground/30 bg-warning text-warning-foreground"
        >
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>The inventory is out of date</AlertTitle>
          <AlertDescription className="text-warning-foreground/90">
            Auctions that have ended since the last sync are hidden, but prices, bids, and new
            listings may be out of date until the next sync.
          </AlertDescription>
        </Alert>
      ) : null}
      <section
        aria-label="Domain results"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable to scroll.
        tabIndex={0}
        data-testid="domain-results-scroll-container"
        // The frame scrolls both ways so the header and Domain column stay
        // sticky; the stock Table's own scroll wrapper becomes a pass-through.
        className="relative max-h-[70svh] min-h-0 overflow-auto overscroll-contain rounded-lg border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:max-h-none md:flex-1 [&_[data-slot=table-container]]:overflow-visible"
      >
        {result.rows.length === 0 ? (
          <Empty className="min-h-72">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GlobeIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h2>No domains found</h2>
              </EmptyTitle>
              <EmptyDescription>
                {hasFilters
                  ? 'No listings match all applied filters. Clear all filters to return to the full active inventory.'
                  : 'No active listings have been collected. If this is a new database, run a local sync first.'}
              </EmptyDescription>
            </EmptyHeader>
            {hasFilters ? (
              <EmptyContent>
                <Link
                  prefetch={false}
                  href={buildDomainTableHref(parseDomainTableFilters({}), {
                    sort: filters.sort,
                    direction: filters.direction
                  })}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Clear all filters
                </Link>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <ResultsTable
            rows={result.rows}
            filters={effectiveFilters}
            visibleColumns={visibleColumns}
            now={now}
          />
        )}
      </section>
      <ResultsPagination filters={filters} page={result.page} total={result.total} />
    </div>
  )
}
