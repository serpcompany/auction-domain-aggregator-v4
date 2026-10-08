'use client'

import { ListFilterIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useEffect, useRef, useTransition } from 'react'

import { ColumnsMenu, FieldsDrawer } from '@/components/auctions/columns-menu'
import { RuleBar, ruleOptions } from '@/components/auctions/rule-bar'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  buildDomainTableHref,
  type DomainTableFilters,
  type DomainTableSort,
  parseDomainTableFilters,
  type SortDirection
} from '@/domain/domain-table'
import { buildFiltersPageHref, countFiltersBySection } from '@/domain/filter-form'
import { TABLE_COLUMNS } from '@/domain/table-columns'
import { cn } from '@/lib/utils'

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

  // On md and wider it is the rule bar's permanent first rule.
  return (
    <search className="w-full sm:w-60 md:w-72">
      <form onSubmit={submit}>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" className="md:hidden" />
            <InputGroupText aria-hidden="true" className="hidden gap-1 md:flex">
              <span className="text-foreground">Domain</span> contains
            </InputGroupText>
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
            onBlur={event => {
              const value = event.currentTarget.value
              if (parseDomainTableFilters({ q: value }).query !== query) onSearch(value)
            }}
          />
          <InputGroupAddon align="inline-end">
            <Kbd>/</Kbd>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </search>
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
  actions
}: {
  filters: DomainTableFilters
  sources: string[]
  auctionTypes: string[]
  tlds: string[]
  count: ReactNode
  // Actions on the matching listings, at the end of the row on md and wider.
  actions?: ReactNode
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const navigate = (href: string) => startTransition(() => router.push(href))
  const active = Object.values(countFiltersBySection(filters)).reduce((sum, n) => sum + n, 0)

  return (
    // On md and wider the rules wrap on the left while the count and the
    // listing actions keep the first row's right end.
    <div
      className="flex flex-col gap-2 md:flex-row md:items-start"
      aria-busy={pending || undefined}
      data-testid="auctions-toolbar"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <SearchField
          // Remount on navigation so Back, rules, and Clear all show the URL's query.
          key={filters.query ?? ''}
          query={filters.query}
          onSearch={query =>
            navigate(
              buildDomainTableHref(filters, {
                query: parseDomainTableFilters({ q: query }).query,
                page: 1
              })
            )
          }
        />
        <div className="hidden md:contents">
          <RuleBar
            filters={filters}
            options={ruleOptions({ sources, auctionTypes, tlds })}
            onNavigate={navigate}
          />
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
              navigate(buildDomainTableHref(filters, { sort, direction, page: 1 }))
            }
          />
          <FieldsDrawer />
        </div>
      </div>
      <div className="ml-auto flex h-8 shrink-0 items-center gap-2">
        <div
          className={cn(
            'text-sm whitespace-nowrap text-muted-foreground tabular-nums',
            pending && 'animate-pulse'
          )}
        >
          {count}
        </div>
        {actions ? <div className="hidden md:flex">{actions}</div> : null}
        <div className="hidden md:block">
          <ColumnsMenu />
        </div>
      </div>
    </div>
  )
}
