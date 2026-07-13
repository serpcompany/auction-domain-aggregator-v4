import Link from 'next/link';

import {
  buildDomainTableHref,
  formatDateTime,
  formatMoney,
  formatSyncRecency,
  nextSortDirection,
  type DomainTableFilters,
  type DomainTableSort,
} from '@/domain/domain-table';
import type { DomainListingsResult } from '@/server/queries/domain-listings';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const sortableColumns: Array<{
  key: DomainTableSort;
  label: string;
  align?: 'right';
}> = [
  { key: 'domain', label: 'Domain' },
  { key: 'source', label: 'Source' },
  { key: 'price', label: 'Current bid', align: 'right' },
  { key: 'bids', label: 'Bids', align: 'right' },
  { key: 'endsAt', label: 'Ends' },
  { key: 'age', label: 'Age', align: 'right' },
];

function providerLabel(provider: string) {
  return provider === 'dynadot' ? 'Dynadot' : provider;
}

function SortableHead({
  filters,
  sort,
  label,
  align,
}: {
  filters: DomainTableFilters;
  sort: DomainTableSort;
  label: string;
  align?: 'right';
}) {
  const active = filters.sort === sort;
  const direction = nextSortDirection(filters, sort);

  return (
    <TableHead
      className={cn(align === 'right' && 'text-right')}
      aria-sort={
        active
          ? filters.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <Link
        prefetch={false}
        className={cn(
          'inline-flex rounded-sm px-1 py-1 font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          align === 'right' && 'justify-end',
        )}
        href={buildDomainTableHref(filters, {
          sort,
          direction,
          page: 1,
        })}
      >
        {label}
        <span className="ml-1 w-3 text-muted-foreground" aria-hidden="true">
          {active ? (filters.direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </Link>
    </TableHead>
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

        <section
          className="rounded-xl border bg-card/95 shadow-sm"
          aria-labelledby="inventory-heading"
        >
          <div className="border-b p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <form
                action="/"
                method="get"
                className="grid flex-1 gap-3 sm:grid-cols-[minmax(16rem,1fr)_13rem_auto_auto] sm:items-end"
              >
                <div className="space-y-1.5">
                  <label htmlFor="domain-query" className="text-sm font-medium">
                    Domain contains
                  </label>
                  <Input
                    id="domain-query"
                    name="q"
                    type="search"
                    autoComplete="off"
                    defaultValue={filters.query}
                    placeholder="e.g. example.com…"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="source" className="text-sm font-medium">
                    Auction source
                  </label>
                  <select
                    id="source"
                    name="source"
                    defaultValue={filters.source ?? ''}
                    className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="">All sources</option>
                    {result.sources.map((source) => (
                      <option key={source} value={source}>
                        {providerLabel(source)}
                      </option>
                    ))}
                  </select>
                </div>
                <input type="hidden" name="sort" value={filters.sort} />
                <input
                  type="hidden"
                  name="direction"
                  value={filters.direction}
                />
                <Button type="submit">Apply filters</Button>
                <Link
                  prefetch={false}
                  href="/"
                  className={cn(buttonVariants({ variant: 'outline' }), 'h-8')}
                >
                  Reset
                </Link>
              </form>

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
                Try a broader domain search or reset the source filter. If this
                is a new database, run the local Dynadot sync first.
              </p>
            </div>
          ) : (
            <Table className="min-w-[1120px]">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  {sortableColumns.slice(0, 2).map((column) => (
                    <SortableHead
                      key={column.key}
                      filters={effectiveFilters}
                      sort={column.key}
                      label={column.label}
                      align={column.align}
                    />
                  ))}
                  <TableHead>Auction type</TableHead>
                  {sortableColumns.slice(2).map((column) => (
                    <SortableHead
                      key={column.key}
                      filters={effectiveFilters}
                      sort={column.key}
                      label={column.label}
                      align={column.align}
                    />
                  ))}
                  <TableHead>Majestic topic</TableHead>
                  <TableHead className="text-right">Ahrefs DR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow key={`${row.provider}:${row.externalId}`}>
                    <TableCell className="max-w-80 font-mono font-medium">
                      <a
                        href={row.auctionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate rounded-sm text-emerald-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300"
                      >
                        {row.domainName}
                        <span className="sr-only">
                          {' '}
                          (opens auction in a new tab)
                        </span>
                      </a>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {providerLabel(row.provider)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.auctionType}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(row.currentBidCents, row.currency)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.bidCount.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell>
                      <time dateTime={row.endsAt.toISOString()}>
                        {formatDateTime(row.endsAt)}
                      </time>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.ageYears === null ? '—' : `${row.ageYears}y`}
                    </TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      —
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
