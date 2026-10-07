'use client'

import { CheckIcon, ListFilterIcon, SearchIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useRef, useState, useTransition } from 'react'

import { ColumnsMenu } from '@/components/auctions/columns-menu'
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
import { Popover, PopoverContent } from '@/components/ui/popover'
import {
  type AuctionSource,
  buildDomainTableHref,
  countAdvancedDomainTableFilters,
  DOMAIN_TABLE_ENDING_WINDOWS,
  type DomainTableEndingWindow,
  type DomainTableFilters,
  formatMoney,
  formatProvider,
  hasActiveDomainTableFilters,
  parseDomainTableFilters
} from '@/domain/domain-table'
import { buildFiltersPageHref } from '@/domain/filter-form'
import type { ColumnKey } from '@/domain/table-columns'
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
    <search className="w-full sm:w-72">
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
              aria-label="Maximum current bid"
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
                    <CheckIcon className="ml-auto" aria-label="Selected" />
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

export function AuctionsToolbar({
  filters,
  sources,
  tlds,
  total,
  visibleColumns
}: {
  filters: DomainTableFilters
  sources: string[]
  tlds: string[]
  total: number
  visibleColumns: ColumnKey[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const apply = (overrides: Partial<DomainTableFilters>) =>
    startTransition(() => router.push(buildDomainTableHref(filters, { ...overrides, page: 1 })))
  const advanced = countAdvancedDomainTableFilters(filters)

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      <SearchField
        // Remount on navigation so Back, chips, and Clear all show the URL's query.
        key={filters.query ?? ''}
        query={filters.query}
        onSearch={query => apply({ query: parseDomainTableFilters({ q: query }).query })}
      />
      <FacetedFilter
        title="Source"
        options={sources.map(value => ({ value, label: formatProvider(value) }))}
        selected={filters.sources}
        onChange={values => apply({ sources: values as AuctionSource[] })}
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
      <EndsFilter value={filters.endingWithin} onChange={endingWithin => apply({ endingWithin })} />
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
      <p
        className={cn(
          'ml-auto text-sm text-muted-foreground tabular-nums',
          pending && 'animate-pulse'
        )}
      >
        <span className="font-medium text-foreground">{total.toLocaleString('en-US')}</span>{' '}
        {total === 1 ? 'listing' : 'listings'}
      </p>
      <ColumnsMenu visibleColumns={visibleColumns} />
    </div>
  )
}
