import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  TriangleAlert,
  X,
} from 'lucide-react';

import {
  buildDomainTableHref,
  formatSyncRecency,
  getDomainTableFilterChips,
  hasActiveDomainTableFilters,
  isInventoryStale,
  type DomainTableFilters,
} from '@/domain/domain-table';
import { DomainFilters } from '@/components/domain-filters';
import { DomainResultsTable } from '@/components/domain-results-table';
import type { DomainListingsResult } from '@/server/queries/domain-listings';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

// Page links are Next links styled as shadcn buttons. The stock
// PaginationLink renders through a client Button whose attributes differ
// between server and client output (a hydration mismatch) and announces
// page links as buttons.
function PageLink({
  href,
  label,
  direction,
}: {
  href?: string;
  label: string;
  direction: 'previous' | 'next';
}) {
  const content =
    direction === 'previous' ? (
      <>
        <ChevronLeft aria-hidden="true" />
        Previous
      </>
    ) : (
      <>
        Next
        <ChevronRight aria-hidden="true" />
      </>
    );
  const className = buttonVariants({ variant: 'ghost', size: 'sm' });
  return href ? (
    <Link prefetch={false} href={href} aria-label={label} className={className}>
      {content}
    </Link>
  ) : (
    <span
      aria-label={label}
      aria-disabled="true"
      className={cn(className, 'pointer-events-none opacity-50')}
    >
      {content}
    </span>
  );
}

export function DomainDiscovery({
  filters,
  result,
  now,
}: {
  filters: DomainTableFilters;
  result: DomainListingsResult;
  now: Date;
}) {
  const effectiveFilters = { ...filters, page: result.page };
  const firstResult =
    result.total === 0 ? 0 : (result.page - 1) * filters.pageSize + 1;
  const lastResult = Math.min(result.page * filters.pageSize, result.total);
  const hasPrevious = result.page > 1;
  const hasNext = result.page * filters.pageSize < result.total;
  const filterChips = getDomainTableFilterChips(filters);
  const hasActiveFilters = hasActiveDomainTableFilters(filters);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Auction inventory
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Domain discovery
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Search and compare active domain auctions from the local
              inventory.
            </p>
          </div>
          <p
            className="text-sm text-muted-foreground"
            aria-label="Data freshness"
          >
            {formatSyncRecency(result.latestSuccessfulSync, now)}
          </p>
        </header>

        {isInventoryStale(result.latestSuccessfulSync, now) ? (
          <Alert
            role="status"
            className="border-warning-foreground/30 bg-warning text-warning-foreground"
          >
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>The inventory is out of date</AlertTitle>
            <AlertDescription className="text-warning-foreground/90">
              Auctions that have ended since the last sync are hidden, but
              prices, bids, and new listings may be stale until the next sync.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card
          className="min-w-0 gap-0 overflow-hidden py-0"
          aria-labelledby="inventory-heading"
          role="region"
        >
          <div className="border-b p-4 sm:p-5">
            <DomainFilters
              key={buildDomainTableHref(filters)}
              filters={filters}
              sources={result.sources}
              auctionTypes={result.auctionTypes}
              tlds={result.tlds}
            />

            <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap gap-2">
                {filterChips.map((chip) => (
                  <Link
                    key={chip.key}
                    prefetch={false}
                    href={chip.href}
                    aria-label={`Remove ${chip.label} filter`}
                    title={chip.label}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'min-h-11 max-w-full min-w-0 rounded-full sm:min-h-8',
                    )}
                  >
                    <span className="min-w-0 truncate">{chip.label}</span>
                    <X aria-hidden="true" />
                  </Link>
                ))}
                {filterChips.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    No filters applied
                  </span>
                ) : null}
              </div>
              <div
                id="inventory-heading"
                className="shrink-0 text-sm text-muted-foreground"
              >
                <span className="font-semibold text-foreground">
                  {result.total.toLocaleString('en-US')}
                </span>{' '}
                active {result.total === 1 ? 'listing' : 'listings'}
              </div>
            </div>
          </div>

          {result.rows.length === 0 ? (
            <Empty className="min-h-72">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Globe aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>
                  <h2>No domains found</h2>
                </EmptyTitle>
                <EmptyDescription>
                  {hasActiveFilters
                    ? 'No listings match all applied filters. Clear all filters to return to the full active inventory.'
                    : 'No active listings have been collected. If this is a new database, run a local sync first.'}
                </EmptyDescription>
              </EmptyHeader>
              {hasActiveFilters ? (
                <EmptyContent>
                  <Link
                    href="/"
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                    })}
                  >
                    Clear all filters
                  </Link>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <DomainResultsTable
              rows={result.rows}
              filters={effectiveFilters}
              now={now}
            />
          )}

          <footer className="flex flex-col gap-3 border-t p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground" aria-live="polite">
              Showing {firstResult.toLocaleString('en-US')}–
              {lastResult.toLocaleString('en-US')} of{' '}
              {result.total.toLocaleString('en-US')}
            </p>
            <Pagination
              aria-label="Domain results pages"
              className="mx-0 w-auto justify-end"
            >
              <PaginationContent>
                <PaginationItem>
                  <PageLink
                    direction="previous"
                    label="Go to previous page"
                    href={
                      hasPrevious
                        ? buildDomainTableHref(filters, {
                            page: result.page - 1,
                          })
                        : undefined
                    }
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="px-2 font-medium tabular-nums">
                    Page {result.page.toLocaleString('en-US')}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PageLink
                    direction="next"
                    label="Go to next page"
                    href={
                      hasNext
                        ? buildDomainTableHref(filters, {
                            page: result.page + 1,
                          })
                        : undefined
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </footer>
        </Card>
      </div>
    </main>
  );
}
