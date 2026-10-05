import Link from 'next/link';
import { X } from 'lucide-react';

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
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
      className="min-h-screen bg-[radial-gradient(circle_at_top_left,oklch(0.97_0.02_155),transparent_32rem)] px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_oklch(0.9_0.06_155)]" />
              <span className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                Auction inventory
              </span>
            </div>
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
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          >
            The inventory is out of date. Auctions that have ended since the
            last sync are hidden, but prices, bids, and new listings may be
            stale until the next sync.
          </p>
        ) : null}

        <section
          className="min-w-0 overflow-hidden rounded-xl border bg-card/95 shadow-sm"
          aria-labelledby="inventory-heading"
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
                    className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
                  >
                    <span className="min-w-0 truncate">{chip.label}</span>
                    <X className="size-3.5 shrink-0" aria-hidden="true" />
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
            <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 rounded-full bg-muted px-4 py-2 font-mono text-lg">
                .com
              </div>
              <h2 className="text-lg font-semibold">No domains found</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {hasActiveFilters
                  ? 'No listings match all applied filters. Clear all filters to return to the full active inventory.'
                  : 'No active listings have been collected. If this is a new database, run the local Dynadot sync first.'}
              </p>
              {hasActiveFilters ? (
                <Link
                  href="/"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'mt-4',
                  )}
                >
                  Clear all filters
                </Link>
              ) : null}
            </div>
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
            <nav
              className="flex items-center gap-2"
              aria-label="Domain results pages"
            >
              {hasPrevious ? (
                <Link
                  prefetch={false}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  href={buildDomainTableHref(filters, {
                    page: result.page - 1,
                  })}
                >
                  Previous
                </Link>
              ) : (
                <span
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'pointer-events-none opacity-50',
                  )}
                  aria-disabled="true"
                >
                  Previous
                </span>
              )}
              <span className="px-2 font-medium tabular-nums">
                Page {result.page.toLocaleString('en-US')}
              </span>
              {hasNext ? (
                <Link
                  prefetch={false}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  href={buildDomainTableHref(filters, {
                    page: result.page + 1,
                  })}
                >
                  Next
                </Link>
              ) : (
                <span
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'pointer-events-none opacity-50',
                  )}
                  aria-disabled="true"
                >
                  Next
                </span>
              )}
            </nav>
          </footer>
        </section>
      </div>
    </main>
  );
}
