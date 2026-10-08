'use client'

import { CheckIcon, ListFilterIcon, SearchIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useEffect, useRef, useState, useTransition } from 'react'

import { ColumnsMenu, FieldsDrawer } from '@/components/auctions/columns-menu'
import { FacetedFilter, FacetTrigger } from '@/components/auctions/faceted-filter'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Popover, PopoverContent } from '@/components/ui/popover'
import {
  type AuctionSource,
  type AuctionType,
  buildDomainTableHref,
  countAdvancedDomainTableFilters,
  DOMAIN_TABLE_ENDING_WINDOWS,
  type DomainTableEndingWindow,
  type DomainTableFilters,
  type DomainTableSort,
  formatAuctionType,
  formatMoney,
  formatProvider,
  hasActiveDomainTableFilters,
  parseDomainTableFilters,
  type SortDirection
} from '@/domain/domain-table'
import { buildFiltersPageHref, countFiltersBySection } from '@/domain/filter-form'
import { type ColumnKey, TABLE_COLUMNS } from '@/domain/table-columns'
import { cn } from '@/lib/utils'

const ENDING_LABELS: Record<DomainTableEndingWindow, string> = {
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
  '3d': '3 days',
  '7d': '7 days'
}

function SearchField({ query, onSearch }: { query?: string; onSearch: (query: string) => void }) {
  const input = useRef<HTMLInputElement>(null)

  // "/" focuses search unless the user is already typing somewhere.
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key !== '/' || target.closest('input, textarea, select, [contenteditable]')) return
      event.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSearch(new FormData(event.currentTarget).get('q') as string)
  }

  return (
    <search className="w-full sm:w-60">
      <form onSubmit={submit}>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={input}
            name="q"
            type="search"
            aria-label="Domain contains"
            placeholder="Search domains…"
            autoComplete="off"
            maxLength={253}
            defaultValue={query}
          />
          <InputGroupAddon align="inline-end">
            <Kbd>/</Kbd>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </search>
  )
}

function MaxBidFilter({
  filters,
  onApply
}: {
  filters: DomainTableFilters
  onApply: (priceMaxCents?: number) => void
}) {
  const [open, setOpen] = useState(false)
  const current = filters.priceMaxCents
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('priceMax') as string
    setOpen(false)
    onApply(parseDomainTableFilters({ priceMax: value }).priceMaxCents)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <FacetTrigger
        title="Max bid"
        selectedLabels={current === undefined ? [] : [formatMoney(current, 'USD')]}
      />
      <PopoverContent className="w-60" align="start">
        <form onSubmit={submit} className="grid gap-3">
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              name="priceMax"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              autoComplete="off"
              aria-label="Max bid"
              placeholder="Any"
              defaultValue={current === undefined ? undefined : current / 100}
            />
          </InputGroup>
          <div className="flex justify-end gap-2">
            {current === undefined ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false)
                  onApply(undefined)
                }}
              >
                Clear
              </Button>
            )}
            <Button type="submit" size="sm">
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function EndsFilter({
  value,
  onChange
}: {
  value?: DomainTableEndingWindow
  onChange: (value?: DomainTableEndingWindow) => void
}) {
  const [open, setOpen] = useState(false)
  const options: Array<[DomainTableEndingWindow | undefined, string]> = [
    [undefined, 'Any time'],
    ...DOMAIN_TABLE_ENDING_WINDOWS.map(
      window => [window, `Within ${ENDING_LABELS[window]}`] as [DomainTableEndingWindow, string]
    )
  ]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <FacetTrigger title="Ends" selectedLabels={value ? [ENDING_LABELS[value]] : []} />
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {options.map(([option, label]) => (
                <CommandItem
                  key={label}
                  value={label}
                  onSelect={() => {
                    setOpen(false)
                    onChange(option)
                  }}
                >
                  {label}
                  {option === value ? (
                    <>
                      <CheckIcon className="ml-auto" aria-hidden="true" />
                      <span className="sr-only">(selected)</span>
                    </>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Phones sort from a list instead of column headers.
const SORT_OPTIONS: Array<[DomainTableSort, SortDirection, string]> = [
  ['endsAt', 'asc', 'Ends soonest'],
  ['price', 'asc', 'Price: low to high'],
  ['price', 'desc', 'Price: high to low'],
  ['bids', 'desc', 'Most bids'],
  ['appraisal', 'desc', 'Highest appraisal'],
  ['age', 'desc', 'Oldest'],
  ['domainRating', 'desc', 'Highest Ahrefs DR'],
  ['majesticTf', 'desc', 'Highest Trust Flow'],
  ['semrushAs', 'desc', 'Highest Authority Score'],
  ['domain', 'asc', 'Domain A–Z']
]

// The column a sort belongs to, as the Columns menu names it.
function sortName(sort: DomainTableSort) {
  const column = TABLE_COLUMNS.find(candidate => candidate.sort === sort)
  if (!column) return 'Domain'
  return 'menuLabel' in column ? column.menuLabel : column.label
}

function SortSelect({
  filters,
  onChange
}: {
  filters: DomainTableFilters
  onChange: (sort: DomainTableSort, direction: SortDirection) => void
}) {
  const current = `${filters.sort}:${filters.direction}`
  const listed = SORT_OPTIONS.some(([sort, direction]) => `${sort}:${direction}` === current)
  return (
    <NativeSelect
      size="sm"
      aria-label="Sort"
      value={current}
      onChange={event => {
        const [sort, direction] = event.target.value.split(':') as [DomainTableSort, SortDirection]
        onChange(sort, direction)
      }}
    >
      {listed ? null : (
        <NativeSelectOption value={current}>
          Sorted by {sortName(filters.sort)} (
          {filters.direction === 'asc' ? 'ascending' : 'descending'})
        </NativeSelectOption>
      )}
      {SORT_OPTIONS.map(([sort, direction, label]) => (
        <NativeSelectOption key={`${sort}:${direction}`} value={`${sort}:${direction}`}>
          {label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

export function AuctionsToolbar({
  filters,
  sources,
  auctionTypes,
  tlds,
  count,
  actions,
  visibleColumns
}: {
  filters: DomainTableFilters
  sources: string[]
  auctionTypes: string[]
  tlds: string[]
  count: ReactNode
  // Buttons that act on the matching listings, beside the count.
  actions?: ReactNode
  visibleColumns: ColumnKey[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const apply = (overrides: Partial<DomainTableFilters>) =>
    startTransition(() => router.push(buildDomainTableHref(filters, { ...overrides, page: 1 })))
  const advanced = countAdvancedDomainTableFilters(filters)
  const active = Object.values(countFiltersBySection(filters)).reduce((sum, n) => sum + n, 0)

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      <SearchField
        // Remount on navigation so Back, chips, and Clear all show the URL's query.
        key={filters.query ?? ''}
        query={filters.query}
        onSearch={query => apply({ query: parseDomainTableFilters({ q: query }).query })}
      />
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <FacetedFilter
          title="Source"
          options={sources.map(value => ({ value, label: formatProvider(value) }))}
          selected={filters.sources}
          onChange={values => apply({ sources: values as AuctionSource[] })}
        />
        <FacetedFilter
          title="Type"
          options={auctionTypes.map(value => ({ value, label: formatAuctionType(value) }))}
          selected={filters.auctionTypes}
          onChange={values => apply({ auctionTypes: values as AuctionType[] })}
        />
        <FacetedFilter
          title="TLD"
          options={tlds.map(value => ({ value, label: `.${value}` }))}
          selected={filters.tlds}
          onChange={values => apply({ tlds: values })}
          searchable
          footer={`${tlds.length.toLocaleString('en-US')} TLDs in the inventory`}
        />
        <MaxBidFilter filters={filters} onApply={priceMaxCents => apply({ priceMaxCents })} />
        <EndsFilter
          value={filters.endingWithin}
          onChange={endingWithin => apply({ endingWithin })}
        />
        <Link
          prefetch={false}
          href={buildFiltersPageHref(filters)}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <ListFilterIcon aria-hidden="true" />
          All filters
          {advanced > 0 ? (
            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
              {advanced}
            </Badge>
          ) : null}
        </Link>
        {hasActiveDomainTableFilters(filters) ? (
          <Link
            prefetch={false}
            href={buildDomainTableHref(parseDomainTableFilters({}), {
              sort: filters.sort,
              direction: filters.direction
            })}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Reset
            <XIcon aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <div className="flex items-center gap-2 md:hidden">
        <Link
          prefetch={false}
          href={buildFiltersPageHref(filters)}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <ListFilterIcon aria-hidden="true" />
          Filters
          {active > 0 ? (
            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
              {active}
            </Badge>
          ) : null}
        </Link>
        <SortSelect
          filters={filters}
          onChange={(sort, direction) =>
            startTransition(() =>
              router.push(buildDomainTableHref(filters, { sort, direction, page: 1 }))
            )
          }
        />
        <FieldsDrawer visibleColumns={visibleColumns} />
      </div>
      <div
        className={cn(
          'ml-auto text-sm text-muted-foreground tabular-nums',
          pending && 'animate-pulse'
        )}
      >
        {count}
      </div>
      {actions}
      <div className="hidden md:block">
        <ColumnsMenu visibleColumns={visibleColumns} />
      </div>
    </div>
  )
}
