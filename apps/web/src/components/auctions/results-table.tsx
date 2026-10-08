'use client'

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  Columns3Icon,
  ExternalLinkIcon,
  EyeOffIcon
} from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'

import { ColumnResizeHandle } from '@/components/auctions/column-resize'
import { ColumnCheckboxItems } from '@/components/auctions/columns-menu'
import { PendingRating } from '@/components/auctions/domain-ratings'
import { ListingDetailsTrigger } from '@/components/auctions/listing-details'
import { useVisibleColumns } from '@/components/auctions/table-layout'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  formatProvider
} from '@/domain/domain-table'
import {
  type ColumnKey,
  columnWidthCss,
  type ResizableColumnKey,
  TABLE_COLUMNS,
  type TableColumn
} from '@/domain/table-columns'
import { cn } from '@/lib/utils'
import type { DomainListingRow } from '@/server/queries/domain-listings'

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

// What a header needs: Domain is not in the column registry and cannot be
// hidden.
type Header = {
  key: ResizableColumnKey
  label: string
  // The full name, for the tooltip of a short label and the resize handle.
  name: string
  tooltip?: string
  sort: DomainTableSort
  numeric: boolean
}

const domainHeader: Header = {
  key: 'domain',
  label: 'Domain',
  name: 'Domain',
  sort: 'domain',
  numeric: false
}

function header(column: TableColumn): Header {
  const tooltip = 'tooltip' in column ? column.tooltip : undefined
  return {
    key: column.key,
    label: column.label,
    name: tooltip ?? ('menuLabel' in column ? column.menuLabel : column.label),
    tooltip,
    sort: column.sort,
    numeric: 'numeric' in column
  }
}

function ariaSort(filters: DomainTableFilters, sort: DomainTableSort) {
  if (filters.sort !== sort) return undefined
  return filters.direction === 'asc' ? 'ascending' : 'descending'
}

// Sorting stays a server navigation: each item is a link to the sorted URL.
// The current order is marked and not a link, so it never re-reads D1.
function SortItem({
  filters,
  sort,
  direction
}: {
  filters: DomainTableFilters
  sort: DomainTableSort
  direction: 'asc' | 'desc'
}) {
  const Icon = direction === 'asc' ? ArrowUpIcon : ArrowDownIcon
  const label = direction === 'asc' ? 'Sort ascending' : 'Sort descending'
  if (filters.sort === sort && filters.direction === direction) {
    return (
      <DropdownMenuItem disabled>
        <Icon aria-hidden="true" />
        {label}
        <CheckIcon className="ml-auto" aria-label="Current order" />
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenuItem
      render={
        <Link prefetch={false} href={buildDomainTableHref(filters, { sort, direction, page: 1 })} />
      }
    >
      <Icon aria-hidden="true" />
      {label}
    </DropdownMenuItem>
  )
}

// A header: a menu button with the label and sort indicator, a tooltip with
// the full name of a short label, and the resize handle on its right edge.
function ColumnHeader({
  header,
  filters,
  className
}: {
  header: Header
  filters: DomainTableFilters
  className?: string
}) {
  const { toggle } = useVisibleColumns()
  const hideable = header.key === 'domain' ? null : header.key
  const active = filters.sort === header.sort
  const Icon = active
    ? filters.direction === 'asc'
      ? ArrowUpIcon
      : ArrowDownIcon
    : ChevronsUpDownIcon
  const trigger = (
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            '-mx-1 max-w-[calc(100%+0.5rem)] px-1 text-sm text-foreground',
            header.numeric && 'flex-row-reverse'
          )}
        />
      }
    >
      <span className="truncate">{header.label}</span>
      <Icon
        className={cn('size-3.5', active ? 'text-foreground' : 'text-muted-foreground')}
        aria-hidden="true"
      />
    </DropdownMenuTrigger>
  )

  return (
    <TableHead
      scope="col"
      // Keeps the resize handle's label out of the header's name.
      aria-label={header.label}
      aria-sort={ariaSort(filters, header.sort)}
      className={cn(
        'sticky top-0 z-20 truncate bg-background',
        header.numeric && 'text-right',
        className
      )}
    >
      <DropdownMenu>
        {header.tooltip ? (
          <Tooltip>
            <TooltipTrigger render={trigger} />
            <TooltipContent>{header.tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <DropdownMenuContent align={header.numeric ? 'end' : 'start'} className="w-48">
          <DropdownMenuGroup>
            <SortItem filters={filters} sort={header.sort} direction="asc" />
            <SortItem filters={filters} sort={header.sort} direction="desc" />
          </DropdownMenuGroup>
          {hideable ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => toggle(hideable, false)}>
                <EyeOffIcon aria-hidden="true" />
                Hide column
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Columns3Icon aria-hidden="true" />
                  Columns
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-64">
                  <ColumnCheckboxItems />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ColumnResizeHandle column={header.key} label={header.name} />
    </TableHead>
  )
}

// The licence-required Ahrefs attribution under the table: visible and linked
// whenever the DR column shows. Phones have it above the list instead.
export function DomainRatingAttribution() {
  const { columns } = useVisibleColumns()
  if (!columns.includes('domainRating')) return null
  return (
    <p className="hidden text-xs text-muted-foreground md:block">
      DR ={' '}
      <a
        href="https://ahrefs.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Domain Rating by Ahrefs
      </a>
    </p>
  )
}

// A client component the server renders first. The columns and their widths
// come from the browser's layout, so hiding a column re-renders here without
// a page request; sorting navigates.
export function ResultsTable({
  rows,
  filters,
  now
}: {
  rows: DomainListingRow[]
  filters: DomainTableFilters
  now: Date
}) {
  const { columns } = useVisibleColumns()
  const visible = TABLE_COLUMNS.filter(column => columns.includes(column.key))
  // Fixed layout takes each width from the `<col>` elements. The Details
  // column has none, so it absorbs the space the others leave.
  const resizable: ResizableColumnKey[] = ['domain', ...visible.map(column => column.key)]
  const tableWidth = `max(100%, calc(${resizable.map(columnWidthCss).join(' + ')} + 2.5rem))`

  return (
    <Table className="table-fixed [&_td]:h-10 [&_td]:truncate" style={{ width: tableWidth }}>
      <colgroup>
        {resizable.map(key => (
          <col key={key} style={{ width: columnWidthCss(key) }} />
        ))}
        <col />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {/* The Domain header sticks to the top and the left, above the rest. */}
          <ColumnHeader header={domainHeader} filters={filters} className="left-0 z-30" />
          {visible.map(column => (
            <ColumnHeader key={column.key} header={header(column)} filters={filters} />
          ))}
          <TableHead scope="col" className="sticky top-0 z-20 bg-background">
            <span className="sr-only">Details</span>
          </TableHead>
        </TableRow>
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
            {visible.map(column => (
              <TableCell
                key={column.key}
                className={cn('tabular-nums', 'numeric' in column && 'text-right')}
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
  )
}
