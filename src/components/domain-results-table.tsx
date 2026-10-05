import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  buildDomainTableHref,
  formatAbsoluteEndTime,
  formatAge,
  formatAuctionType,
  formatCompactCount,
  formatEndTime,
  formatMoney,
  formatProvider,
  nextSortDirection,
  type DomainTableFilters,
  type DomainTableSort,
  type EndTimeState,
} from '@/domain/domain-table';
import { cn } from '@/lib/utils';
import type { DomainListingRow } from '@/server/queries/domain-listings';

const sortableColumns = {
  domain: 'domain',
  auction: 'source',
  price: 'price',
  interest: 'bids',
  ends: 'endsAt',
  age: 'age',
  links: 'links',
  appraisal: 'appraisal',
} satisfies Record<string, DomainTableSort>;

const urgencyClasses: Record<EndTimeState, string> = {
  neutral: 'text-foreground',
  amber: 'text-amber-700 dark:text-amber-300',
  red: 'font-semibold text-red-700 dark:text-red-300',
  ended: 'font-semibold text-red-700 dark:text-red-300',
};

function SortableHead({
  filters,
  sort,
  children,
  align = 'left',
  sticky = false,
}: {
  filters: DomainTableFilters;
  sort: DomainTableSort;
  children: React.ReactNode;
  align?: 'left' | 'right';
  sticky?: boolean;
}) {
  const active = filters.sort === sort;
  const direction = nextSortDirection(filters, sort);
  const SortIcon = active
    ? filters.direction === 'asc'
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <th
      scope="col"
      aria-sort={
        active
          ? filters.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
      className={cn(
        'sticky top-0 z-20 h-11 bg-muted px-3 text-xs font-semibold tracking-wide whitespace-nowrap text-foreground uppercase',
        align === 'right' ? 'text-right' : 'text-left',
        sticky &&
          'left-0 z-30 w-64 max-w-64 border-r bg-muted shadow-[4px_0_8px_-7px_color-mix(in_oklab,var(--foreground)_45%,transparent)]',
      )}
    >
      <Link
        prefetch={false}
        href={buildDomainTableHref(filters, {
          sort,
          direction,
          page: 1,
        })}
        className={cn(
          'inline-flex min-h-11 items-center gap-1.5 rounded-sm px-1.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:min-h-9 motion-reduce:transition-none',
          align === 'right' && 'justify-end',
        )}
      >
        {children}
        <SortIcon
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
    </th>
  );
}

function StaticHead({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'sticky top-0 z-20 h-11 bg-muted px-3 text-xs font-semibold tracking-wide whitespace-nowrap text-foreground uppercase',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Secondary({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 text-xs leading-4 font-normal text-muted-foreground">
      {children}
    </div>
  );
}

function UnknownValue({ label }: { label: string }) {
  return (
    <span aria-label={`${label} not collected`} title="Not collected">
      <span aria-hidden="true">—</span>
    </span>
  );
}

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value.toLocaleString('en-US')} ${value === 1 ? singular : plural}`;
}

function DomainCell({ row }: { row: DomainListingRow }) {
  return (
    <td className="sticky left-0 z-10 h-16 w-64 max-w-64 border-r bg-background px-3 py-2 align-middle shadow-[4px_0_8px_-7px_color-mix(in_oklab,var(--foreground)_45%,transparent)] group-hover:bg-muted">
      <a
        href={row.auctionUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-full items-center gap-1 rounded-sm font-mono font-semibold text-emerald-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300"
      >
        <span className="min-w-0 truncate">{row.domainName}</span>
        <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="sr-only"> (opens auction in a new tab)</span>
      </a>
      <Secondary>
        <span>.{row.tld}</span>
        <span aria-hidden="true"> · </span>
        <span>{countLabel(row.domainLength, 'character')}</span>
        {row.hasHyphen ? (
          <span className="ml-2 rounded border px-1 py-0.5">hyphen</span>
        ) : null}
        {row.hasDigit ? (
          <span className="ml-1 rounded border px-1 py-0.5">digits</span>
        ) : null}
      </Secondary>
    </td>
  );
}

function AuctionCell({ row }: { row: DomainListingRow }) {
  return (
    <td className="h-16 px-3 py-2 align-middle">
      <Badge variant="secondary">{formatProvider(row.provider)}</Badge>
      <Secondary>{formatAuctionType(row.auctionType)}</Secondary>
    </td>
  );
}

function PriceCell({ row }: { row: DomainListingRow }) {
  return (
    <td className="h-16 px-3 py-2 text-right align-middle tabular-nums">
      <div className="font-semibold">
        {formatMoney(row.currentBidCents, row.currency)}
      </div>
      {row.renewalPriceCents === null ? null : (
        <Secondary>
          {formatMoney(row.renewalPriceCents, row.currency)} renewal
        </Secondary>
      )}
    </td>
  );
}

function InterestCell({ row }: { row: DomainListingRow }) {
  return (
    <td className="h-16 px-3 py-2 text-right align-middle tabular-nums">
      <div className="font-medium">
        <span>{countLabel(row.bidCount, 'bid')}</span>
        <span aria-hidden="true"> · </span>
        <span>{countLabel(row.bidderCount, 'bidder')}</span>
      </div>
      {row.visitors === null
        ? null
        : (() => {
            const visitors = formatCompactCount(row.visitors);
            return (
              <Secondary>
                <span
                  aria-label={`${visitors.full} visitors`}
                  title={`${visitors.full} visitors`}
                >
                  {visitors.compact} visitors
                </span>
              </Secondary>
            );
          })()}
    </td>
  );
}

function EndsCell({ row, now }: { row: DomainListingRow; now: Date }) {
  const endTime = formatEndTime(row.endsAt, now);
  return (
    <td className="h-16 px-3 py-2 align-middle tabular-nums">
      <time className="block" dateTime={row.endsAt.toISOString()}>
        <span className={cn('block', urgencyClasses[endTime.state])}>
          {endTime.relative}
        </span>
        <span className="mt-1 block text-xs leading-4 font-normal text-muted-foreground">
          {formatAbsoluteEndTime(row.endsAt)}
        </span>
      </time>
    </td>
  );
}

function LinksCell({ row }: { row: DomainListingRow }) {
  if (row.inboundLinks === null) {
    return (
      <td className="h-16 px-3 py-2 text-right align-middle">
        <UnknownValue label="Inbound links" />
      </td>
    );
  }
  const links = formatCompactCount(row.inboundLinks);
  return (
    <td className="h-16 px-3 py-2 text-right align-middle tabular-nums">
      <span
        aria-label={`${links.full} inbound links`}
        title={`${links.full} inbound links`}
      >
        {links.compact}
      </span>
    </td>
  );
}

function AppraisalCell({ row }: { row: DomainListingRow }) {
  return (
    <td className="h-16 px-3 py-2 text-right align-middle tabular-nums">
      {row.appraisalCents === null ? (
        <UnknownValue label={`${formatProvider(row.provider)} appraisal`} />
      ) : (
        <>
          <div className="font-medium">
            {formatMoney(row.appraisalCents, row.currency)}
          </div>
          <Secondary>{formatProvider(row.provider)} appraisal</Secondary>
        </>
      )}
    </td>
  );
}

export function DomainResultsTable({
  rows,
  filters,
  now,
}: {
  rows: DomainListingRow[];
  filters: DomainTableFilters;
  now: Date;
}) {
  return (
    <div
      data-testid="domain-results-scroll-container"
      role="region"
      aria-label="Domain results"
      tabIndex={0}
      className="relative max-w-full max-h-[70dvh] overflow-auto overscroll-contain rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <table className="w-full min-w-[1240px] border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <SortableHead
              filters={filters}
              sort={sortableColumns.domain}
              sticky
            >
              Domain
            </SortableHead>
            <SortableHead filters={filters} sort={sortableColumns.auction}>
              Auction
            </SortableHead>
            <SortableHead
              filters={filters}
              sort={sortableColumns.price}
              align="right"
            >
              Price
            </SortableHead>
            <SortableHead
              filters={filters}
              sort={sortableColumns.interest}
              align="right"
            >
              Interest
            </SortableHead>
            <SortableHead filters={filters} sort={sortableColumns.ends}>
              Ends
            </SortableHead>
            <SortableHead
              filters={filters}
              sort={sortableColumns.age}
              align="right"
            >
              Age
            </SortableHead>
            <SortableHead
              filters={filters}
              sort={sortableColumns.links}
              align="right"
            >
              Links
            </SortableHead>
            <SortableHead
              filters={filters}
              sort={sortableColumns.appraisal}
              align="right"
            >
              Appraisal
            </SortableHead>
            <StaticHead>Majestic topic</StaticHead>
            <StaticHead align="right">
              <span aria-label="Ahrefs Domain Rating">Ahrefs DR</span>
            </StaticHead>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.provider}:${row.externalId}`}
              className="group border-b transition-colors hover:bg-muted focus-within:bg-muted motion-reduce:transition-none"
            >
              <DomainCell row={row} />
              <AuctionCell row={row} />
              <PriceCell row={row} />
              <InterestCell row={row} />
              <EndsCell row={row} now={now} />
              <td className="h-16 px-3 py-2 text-right align-middle tabular-nums">
                {formatAge(row.ageYears) ?? <UnknownValue label="Domain age" />}
              </td>
              <LinksCell row={row} />
              <AppraisalCell row={row} />
              <td className="h-16 px-3 py-2 align-middle text-muted-foreground">
                <UnknownValue label="Majestic topic" />
              </td>
              <td className="h-16 px-3 py-2 text-right align-middle text-muted-foreground">
                <UnknownValue label="Ahrefs Domain Rating" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
