import { ArrowRightIcon, XIcon } from 'lucide-react'
import Link from 'next/link'

import { badgeVariants } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  buildDomainTableHref,
  type DomainTableFilters,
  getDomainTableFilterChips,
  parseDomainTableFilters
} from '@/domain/domain-table'
import { buildFiltersPageHref } from '@/domain/filter-form'
import { cn } from '@/lib/utils'

// Every applied constraint once, each removable, then Clear all and Edit.
export function ActiveFilters({ filters }: { filters: DomainTableFilters }) {
  const chips = getDomainTableFilterChips(filters)
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-xs text-muted-foreground">Filters</span>
      {chips.map(chip => (
        <Link
          key={chip.key}
          prefetch={false}
          href={chip.href}
          aria-label={`Remove ${chip.label} filter`}
          title={chip.label}
          className={cn(badgeVariants({ variant: 'outline' }), 'max-w-full pr-1')}
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <XIcon aria-hidden="true" />
        </Link>
      ))}
      <Link
        prefetch={false}
        href={buildDomainTableHref(parseDomainTableFilters({}), {
          sort: filters.sort,
          direction: filters.direction
        })}
        className={buttonVariants({ variant: 'ghost', size: 'xs' })}
      >
        Clear all
      </Link>
      <Link
        prefetch={false}
        href={buildFiltersPageHref(filters)}
        className={buttonVariants({ variant: 'ghost', size: 'xs' })}
      >
        Edit
        <ArrowRightIcon aria-hidden="true" />
      </Link>
    </div>
  )
}
