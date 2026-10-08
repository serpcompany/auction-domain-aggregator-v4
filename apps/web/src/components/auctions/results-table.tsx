'use client'

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowLeftToLineIcon,
  ArrowRightIcon,
  ArrowRightToLineIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  Columns3Icon,
  CopyIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  PanelRightOpenIcon,
  PinIcon,
  PinOffIcon
} from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'
import { useState } from 'react'

import { ColumnResizeHandle } from '@/components/auctions/column-resize'
import { ColumnCheckboxItems } from '@/components/auctions/columns-menu'
import { PendingRating } from '@/components/auctions/domain-ratings'
import {
  createEndTimeTooltip,
  EndsPill,
  type EndTimeTooltip,
  EndTimeTooltipContent,
  RatingRing,
  SourcePill,
  TypePill
} from '@/components/auctions/listing-cells'
import { copyDomain, useOpenListingDetails } from '@/components/auctions/listing-details'
import { useRowSelection } from '@/components/auctions/row-selection'
import { useColumnLayout, useVisibleColumns } from '@/components/auctions/table-layout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  formatCompactCount,
  formatMoney,
  formatProvider,
  listingKey
} from '@/domain/domain-table'
import {
  type ColumnKey,
  columnWidthCss,
  moveColumn,
  orderedColumns,
  type PinSide,
  pinColumn,
  type ResizableColumnKey,
  ROW_ACTIONS_COLUMN_WIDTH,
  SELECTION_COLUMN_WIDTH,
  type StickyOffset,
  stickyOffsets,
  type TableColumn
} from '@/domain/table-columns'
import { cn } from '@/lib/utils'
import type { DomainListingRow } from '@/server/queries/domain-listings'

// Sticky body cells: the stock cell styled through className, opaque so the
// scrolling cells pass beneath, and tinted with their row.
const stickyCell =
  'sticky z-10 bg-background group-hover:bg-muted group-data-[state=selected]:bg-muted'
// Headers stick to the top; sticky columns' headers sit above the rest.
const headCell = 'sticky top-0 z-20 bg-background'
// The shadow edge of the last left-pinned and the first right-pinned column.
const edgeShadow: Record<PinSide, string> = {
  left: 'shadow-[inset_-1px_0_0_var(--border),6px_0_8px_-6px_color-mix(in_oklab,var(--foreground)_20%,transparent)]',
  right:
    'shadow-[inset_1px_0_0_var(--border),-6px_0_8px_-6px_color-mix(in_oklab,var(--foreground)_20%,transparent)]'
}

// Where a sticky column sticks, and whether it carries the pinned edge.
type Sticky = { offset: StickyOffset; edge?: PinSide }

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
  if (row.domainRating !== null) return <RatingRing value={row.domainRating} />
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

function cellContent(
  key: ColumnKey,
  row: DomainListingRow,
  now: Date,
  endTimeTooltip: EndTimeTooltip
): React.ReactNode {
  const seo = row.seoMetrics
  switch (key) {
    case 'source':
      return <SourcePill provider={row.provider} />
    case 'type':
      return <TypePill auctionType={row.auctionType} />
    case 'price':
      return <span className="font-medium">{formatMoney(row.currentBidCents, row.currency)}</span>
    case 'bids':
      return row.bidCount.toLocaleString('en-US')
    case 'ends':
      return <EndsPill endsAt={row.endsAt} now={now} tooltip={endTimeTooltip} />
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

// Pin, unpin, and move items for a registry column's menu. Each changes only
// the browser's layout cookie, with no page request.
function LayoutItems({ column }: { column: ColumnKey }) {
  const { columns } = useVisibleColumns()
  const { layout, update } = useColumnLayout()
  const pinned = layout.pins[column]
  const moveTo = (direction: PinSide) => moveColumn(layout, column, direction, columns)
  const left = moveTo('left')
  const right = moveTo('right')
  return (
    <>
      <DropdownMenuGroup>
        {pinned ? (
          <DropdownMenuItem onClick={() => update(pinColumn(layout, column, null))}>
            <PinOffIcon aria-hidden="true" />
            Unpin
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => update(pinColumn(layout, column, 'left'))}>
              <ArrowLeftToLineIcon aria-hidden="true" />
              Pin to left
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => update(pinColumn(layout, column, 'right'))}>
              <ArrowRightToLineIcon aria-hidden="true" />
              Pin to right
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!left} onClick={left ? () => update(left) : undefined}>
          <ArrowLeftIcon aria-hidden="true" />
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!right} onClick={right ? () => update(right) : undefined}>
          <ArrowRightIcon aria-hidden="true" />
          Move right
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  )
}

// A header: a menu button with the label, the sort indicator, and a pin icon
// when pinned, a tooltip with the full name of a short label, and the resize
// handle on its right edge.
function ColumnHeader({
  header,
  filters,
  sticky
}: {
  header: Header
  filters: DomainTableFilters
  sticky?: Sticky
}) {
  const { toggle } = useVisibleColumns()
  const { layout } = useColumnLayout()
  const column = header.key === 'domain' ? null : header.key
  const pinned = column !== null && layout.pins[column] !== undefined
  const active = filters.sort === header.sort
  // One indicator, so a pinned header keeps the room for its label: the sort
  // arrow on the sorted column, else a pin on a pinned one (its shadow edge
  // still marks it), else the idle sort icon.
  const Icon = active ? (filters.direction === 'asc' ? ArrowUpIcon : ArrowDownIcon) : null
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
      {Icon ? (
        <Icon className="size-3.5 text-foreground" aria-hidden="true" />
      ) : pinned ? (
        <PinIcon className="size-3.5 text-muted-foreground" aria-label="Pinned" role="img" />
      ) : (
        <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      )}
    </DropdownMenuTrigger>
  )

  return (
    <TableHead
      scope="col"
      // Keeps the resize handle's label out of the header's name.
      aria-label={header.label}
      aria-sort={ariaSort(filters, header.sort)}
      style={sticky?.offset}
      className={cn(
        headCell,
        'truncate',
        header.numeric && 'text-right',
        sticky && 'z-30',
        sticky?.edge && edgeShadow[sticky.edge]
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
          {column ? (
            <>
              <DropdownMenuSeparator />
              <LayoutItems column={column} />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => toggle(column, false)}>
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

// The ⋮ menu that ends each row: the details panel, the auction, and a copy
// of the domain name.
function RowActions({ row }: { row: DomainListingRow }) {
  const openDetails = useOpenListingDetails()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${row.domainName}`}
            className="text-muted-foreground"
          />
        }
      >
        <EllipsisVerticalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => openDetails(row)}>
          <PanelRightOpenIcon aria-hidden="true" />
          Details
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<a href={row.auctionUrl} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon aria-hidden="true" />
          Open auction
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => copyDomain(row.domainName)}>
          <CopyIcon aria-hidden="true" />
          Copy domain
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

// The selection checkbox in the header: every row of the page, indeterminate
// while only some are selected. The stock Checkbox shows a check for both, so
// the indeterminate state is drawn as a dash through its className.
function SelectAllCheckbox() {
  const { all, some, toggleAll } = useRowSelection()
  return (
    <Checkbox
      aria-label="Select all rows on this page"
      checked={all}
      indeterminate={some && !all}
      onCheckedChange={toggleAll}
      className="data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:data-indeterminate:bg-primary data-indeterminate:before:h-0.5 data-indeterminate:before:w-2 data-indeterminate:before:rounded-full data-indeterminate:before:bg-current data-indeterminate:[&_svg]:hidden"
    />
  )
}

// A client component the server renders first. The columns, their order, pins,
// and widths come from the browser's layout, so hiding, pinning, or moving a
// column re-renders here without a page request; sorting navigates. Row
// selection is client state for this page.
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
  const { layout } = useColumnLayout()
  const { selected, toggle } = useRowSelection()
  const [endTimeTooltip] = useState(createEndTimeTooltip)
  const { left, center, right } = orderedColumns(layout, columns)
  const leftKeys: ResizableColumnKey[] = ['domain', ...left.map(column => column.key)]
  const rightKeys = right.map(column => column.key)
  const offsets = stickyOffsets(leftKeys, rightKeys)
  const sticky = (key: ResizableColumnKey): Sticky | undefined => {
    const offset = offsets[key]
    if (!offset) return undefined
    const edge =
      left.length > 0 && key === leftKeys.at(-1)
        ? 'left'
        : key === rightKeys[0]
          ? 'right'
          : undefined
    return { offset, edge }
  }
  const stickyBodyCell = (key: ResizableColumnKey) => {
    const position = sticky(key)
    return position
      ? {
          style: position.offset,
          className: cn(stickyCell, position.edge && edgeShadow[position.edge])
        }
      : {}
  }
  const resizable: ResizableColumnKey[] = [...leftKeys, ...center.map(column => column.key)]
  // Fixed layout takes each width from the `<col>` elements. An empty column
  // without a width, before the right-pinned ones, absorbs the space the
  // others leave, so the row actions keep their width and stay at the edge.
  const fixed = `${SELECTION_COLUMN_WIDTH + ROW_ACTIONS_COLUMN_WIDTH}px`
  const tableWidth = `max(100%, calc(${[...resizable, ...rightKeys].map(columnWidthCss).join(' + ')} + ${fixed}))`
  const cell = (column: TableColumn, row: DomainListingRow) => {
    const position = stickyBodyCell(column.key)
    return (
      <TableCell
        key={column.key}
        style={position.style}
        className={cn('tabular-nums', 'numeric' in column && 'text-right', position.className)}
      >
        {cellContent(column.key, row, now, endTimeTooltip)}
      </TableCell>
    )
  }

  return (
    <>
      <EndTimeTooltipContent tooltip={endTimeTooltip} />
      <Table className="table-fixed [&_td]:h-10 [&_td]:truncate" style={{ width: tableWidth }}>
        <colgroup>
          <col style={{ width: `${SELECTION_COLUMN_WIDTH}px` }} />
          {resizable.map(key => (
            <col key={key} style={{ width: columnWidthCss(key) }} />
          ))}
          <col />
          {rightKeys.map(key => (
            <col key={key} style={{ width: columnWidthCss(key) }} />
          ))}
          <col style={{ width: `${ROW_ACTIONS_COLUMN_WIDTH}px` }} />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={cn(headCell, 'left-0 z-30')}>
              <SelectAllCheckbox />
            </TableHead>
            <ColumnHeader header={domainHeader} filters={filters} sticky={sticky('domain')} />
            {[...left, ...center].map(column => (
              <ColumnHeader
                key={column.key}
                header={header(column)}
                filters={filters}
                sticky={sticky(column.key)}
              />
            ))}
            <TableHead aria-hidden="true" className={cn(headCell, 'p-0')} />
            {right.map(column => (
              <ColumnHeader
                key={column.key}
                header={header(column)}
                filters={filters}
                sticky={sticky(column.key)}
              />
            ))}
            <TableHead scope="col" className={cn(headCell, 'right-0 z-30')}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => {
            const key = listingKey(row)
            const isSelected = selected.has(key)
            const domain = stickyBodyCell('domain')
            return (
              <TableRow
                key={key}
                data-state={isSelected ? 'selected' : undefined}
                className="group"
              >
                <TableCell className={cn(stickyCell, 'left-0')}>
                  <Checkbox
                    aria-label={`Select ${row.domainName}`}
                    checked={isSelected}
                    onCheckedChange={checked => toggle(key, checked)}
                  />
                </TableCell>
                <TableCell style={domain.style} className={domain.className}>
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
                {[...left, ...center].map(column => cell(column, row))}
                <TableCell aria-hidden="true" className="p-0" />
                {right.map(column => cell(column, row))}
                <TableCell className={cn(stickyCell, 'right-0 px-1')}>
                  <RowActions row={row} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </>
  )
}
