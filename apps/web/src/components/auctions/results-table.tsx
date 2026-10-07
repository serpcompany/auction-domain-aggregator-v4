import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'

import { PendingRating } from '@/components/auctions/domain-ratings'
import { ListingDetailsTrigger } from '@/components/auctions/listing-details'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  buildDomainTableHref,
  type DomainTableFilters,
  type DomainTableSort,
  type EndTimeState,
  formatAbsoluteEndTime,
  formatAuctionType,
  formatCompactCount,
  formatEndTime,
  formatMoney,
  formatProvider,
  nextSortDirection
} from '@/domain/domain-table'
import {
  type ColumnGroup,
  type ColumnKey,
  columnGroup,
  TABLE_COLUMNS,
  type TableColumn
} from '@/domain/table-columns'
import { cn } from '@/lib/utils'
import type { DomainListingRow } from '@/server/queries/domain-listings'

const GROUPS: ColumnGroup[] = ['Majestic', 'Semrush', 'Ahrefs']

type GroupedColumn = Extract<TableColumn, { group: ColumnGroup }>

const urgency: Record<EndTimeState, string> = {
  neutral: '',
  amber: 'font-medium text-warning-foreground',
  red: 'font-semibold text-destructive',
  ended: 'font-semibold text-destructive'
}

// The sticky Domain column: the stock cell styled through className.
const stickyColumn = 'sticky left-0 z-10 bg-background'

function NotCollected() {
  return (
    <span className="text-muted-foreground" title="Not collected">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not collected</span>
    </span>
  )
}

function Count({ value, unit }: { value: number | null; unit: string }) {
  if (value === null) return <NotCollected />
  const count = formatCompactCount(value)
  return (
    <span title={`${count.full} ${unit}`}>
      {count.compact}
      {count.compact === count.full ? null : <span className="sr-only"> ({count.full})</span>}
    </span>
  )
}

function DomainRating({ row }: { row: DomainListingRow }) {
  if (row.domainRating !== null)
    return <span title="Domain Rating by Ahrefs">{Math.round(row.domainRating)}</span>
  if (!row.domainRatingFetched)
    return (
      <PendingRating domain={row.domainName}>
        <NotCollected />
      </PendingRating>
    )
  return (
    <span className="text-muted-foreground" title="Ahrefs has no rating for this domain">
      <span aria-hidden="true">—</span>
      <span className="sr-only">No Ahrefs Domain Rating</span>
    </span>
  )
}

function cellContent(key: ColumnKey, row: DomainListingRow, now: Date): React.ReactNode {
  const seo = row.seoMetrics
  switch (key) {
    case 'source':
      return formatProvider(row.provider)
    case 'type':
      return formatAuctionType(row.auctionType)
    case 'price':
      return <span className="font-medium">{formatMoney(row.currentBidCents, row.currency)}</span>
    case 'bids':
      return row.bidCount.toLocaleString('en-US')
    case 'ends': {
      const end = formatEndTime(row.endsAt, now)
      return (
        <time dateTime={row.endsAt.toISOString()}>
          <span className={urgency[end.state]}>{end.relative}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">
            {formatAbsoluteEndTime(row.endsAt)}
          </span>
        </time>
      )
    }
    case 'age':
      return row.ageYears === null ? (
        <NotCollected />
      ) : (
        `${row.ageYears} yr${row.ageYears === 1 ? '' : 's'}`
      )
    case 'links':
      return <Count value={row.inboundLinks} unit="inbound links" />
    case 'appraisal':
      return row.appraisalCents === null ? (
        <NotCollected />
      ) : (
        <span title={`${formatProvider(row.provider)} appraisal`}>
          {formatMoney(row.appraisalCents, row.currency)}
        </span>
      )
    case 'renewal':
      return row.renewalPriceCents === null ? (
        <NotCollected />
      ) : (
        formatMoney(row.renewalPriceCents, row.currency)
      )
    case 'visitors':
      return <Count value={row.visitors} unit="visitors" />
    case 'length':
      return row.domainLength
    case 'majesticTf':
      return seo?.majesticTf ?? <NotCollected />
    case 'majesticCf':
      return seo?.majesticCf ?? <NotCollected />
    case 'majesticRefDomains':
      return <Count value={seo?.majesticRefDomains ?? null} unit="referring domains" />
    case 'semrushAs':
      return seo?.semrushAs ?? <NotCollected />
    case 'domainRating':
      return <DomainRating row={row} />
  }
}

function SortLink({
  filters,
  sort,
  label,
  numeric
}: {
  filters: DomainTableFilters
  sort: DomainTableSort
  label: string
  numeric?: boolean
}) {
  const active = filters.sort === sort
  const Icon = active
    ? filters.direction === 'asc'
      ? ArrowUpIcon
      : ArrowDownIcon
    : ChevronsUpDownIcon
  return (
    <Link
      prefetch={false}
      href={buildDomainTableHref(filters, {
        sort,
        direction: nextSortDirection(filters, sort),
        page: 1
      })}
      className={cn(
        '-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        numeric && 'flex-row-reverse'
      )}
    >
      {label}
      <Icon
        className={cn('size-3.5', active ? 'text-foreground' : 'text-muted-foreground')}
        aria-hidden="true"
      />
    </Link>
  )
}

function ariaSort(filters: DomainTableFilters, sort: DomainTableSort) {
  if (filters.sort !== sort) return undefined
  return filters.direction === 'asc' ? 'ascending' : 'descending'
}

function groupLabel(group: ColumnGroup) {
  if (group !== 'Ahrefs') return group
  // Required by the Ahrefs Domain Rating licence: visible, linked, next to the values.
  return (
    <a
      href="https://ahrefs.com/"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block leading-tight underline-offset-2 hover:text-foreground hover:underline"
    >
      Domain Rating
      <br />
      by Ahrefs
    </a>
  )
}

export function ResultsTable({
  rows,
  filters,
  visibleColumns,
  now
}: {
  rows: DomainListingRow[]
  filters: DomainTableFilters
  visibleColumns: readonly ColumnKey[]
  now: Date
}) {
  const visible = TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key))
  // Metric columns sit under their group's header; the rest span both header rows.
  const listing = visible.filter(column => !('group' in column))
  const metrics = visible.filter((column): column is GroupedColumn => 'group' in column)
  const groups = GROUPS.map(group => ({
    group,
    columns: metrics.filter(column => column.group === group)
  })).filter(({ columns }) => columns.length > 0)
  const grouped = groups.flatMap(({ columns }) => columns)
  const firstInGroup = new Set<ColumnKey>(groups.map(({ columns }) => columns[0].key))
  const ordered: TableColumn[] = [...listing, ...grouped]
  const rowSpan = groups.length > 0 ? 2 : 1
  // Every header sticks to the top; the Domain header also sticks left, above the rest.
  const headClass = 'sticky top-0 z-20 bg-background'

  return (
    <>
      <Table className="[&_td]:h-10">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead
              scope="col"
              rowSpan={rowSpan}
              aria-sort={ariaSort(filters, 'domain')}
              className={cn(headClass, 'left-0 z-30 w-56')}
            >
              <SortLink filters={filters} sort="domain" label="Domain" />
            </TableHead>
            {listing.map(column => (
              <TableHead
                key={column.key}
                scope="col"
                rowSpan={rowSpan}
                aria-sort={ariaSort(filters, column.sort)}
                className={cn(headClass, 'numeric' in column && 'text-right')}
              >
                <SortLink
                  filters={filters}
                  sort={column.sort}
                  label={column.label}
                  numeric={'numeric' in column}
                />
              </TableHead>
            ))}
            {groups.map(({ group, columns }) => (
              <TableHead
                key={group}
                scope="colgroup"
                colSpan={columns.length}
                className={cn(
                  headClass,
                  'h-7 border-l text-center text-xs font-normal text-muted-foreground'
                )}
              >
                {groupLabel(group)}
              </TableHead>
            ))}
            <TableHead scope="col" rowSpan={rowSpan} className={cn(headClass, 'w-10')}>
              <span className="sr-only">Details</span>
            </TableHead>
          </TableRow>
          {groups.length > 0 ? (
            <TableRow className="hover:bg-transparent">
              {grouped.map(column => (
                <TableHead
                  key={column.key}
                  scope="col"
                  title={`${column.group} ${column.menuLabel}`}
                  aria-sort={ariaSort(filters, column.sort)}
                  className={cn(
                    headClass,
                    'top-7 h-8 text-right',
                    firstInGroup.has(column.key) && 'border-l'
                  )}
                >
                  <SortLink filters={filters} sort={column.sort} label={column.label} numeric />
                </TableHead>
              ))}
            </TableRow>
          ) : null}
        </TableHeader>
        <TableBody>
          {rows.map(row => (
            <TableRow key={`${row.provider}:${row.externalId}`} className="group">
              <TableCell className={cn(stickyColumn, 'group-hover:bg-muted')}>
                <a
                  href={row.auctionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-sm font-mono text-[13px] font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="min-w-0 truncate">{row.domainName}</span>
                  <ExternalLinkIcon
                    className="size-3 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="sr-only"> (opens auction in a new tab)</span>
                </a>
              </TableCell>
              {ordered.map(column => (
                <TableCell
                  key={column.key}
                  className={cn(
                    'tabular-nums',
                    'numeric' in column && 'text-right',
                    firstInGroup.has(column.key) && 'border-l'
                  )}
                >
                  {cellContent(column.key, row, now)}
                </TableCell>
              ))}
              <TableCell className="px-1">
                <ListingDetailsTrigger row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}
