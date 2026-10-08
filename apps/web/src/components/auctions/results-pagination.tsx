import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination'
import {
  buildDomainTableHref,
  type DomainTableFilters,
  MAX_DOMAIN_TABLE_PAGE
} from '@/domain/domain-table'

// Page links are Next links styled as buttons: the stock PaginationLink renders
// through a client Button that mismatches during hydration and reads as a button.
// A page that does not exist is a disabled button.
function PageLink({
  href,
  label,
  icon: Icon
}: {
  href?: string
  label: string
  icon: typeof ChevronLeftIcon
}) {
  const className = buttonVariants({ variant: 'outline', size: 'icon-sm' })
  if (!href) {
    return (
      <Button variant="outline" size="icon-sm" disabled aria-label={label}>
        <Icon aria-hidden="true" />
      </Button>
    )
  }
  return (
    <Link prefetch={false} href={href} className={className}>
      <Icon aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Link>
  )
}

export function ResultsPagination({
  filters,
  page,
  total,
  children
}: {
  filters: DomainTableFilters
  page: number
  total: number
  // Shown between the count and the page links: the DR attribution.
  children?: ReactNode
}) {
  const lastPage = Math.min(Math.max(1, Math.ceil(total / filters.pageSize)), MAX_DOMAIN_TABLE_PAGE)
  const first = total === 0 ? 0 : (page - 1) * filters.pageSize + 1
  const last = Math.min(page * filters.pageSize, total)
  const href = (target: number) =>
    target === page || target < 1 || target > lastPage
      ? undefined
      : buildDomainTableHref(filters, { page: target })

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground tabular-nums" aria-live="polite">
        Showing {first.toLocaleString('en-US')}–{last.toLocaleString('en-US')} of{' '}
        {total.toLocaleString('en-US')} · {filters.pageSize} per page
      </p>
      {children}
      <Pagination aria-label="Domain results pages" className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem className="mr-2 tabular-nums">
            Page {page.toLocaleString('en-US')} of {lastPage.toLocaleString('en-US')}
          </PaginationItem>
          <PaginationItem>
            <PageLink href={href(1)} label="Go to first page" icon={ChevronsLeftIcon} />
          </PaginationItem>
          <PaginationItem>
            <PageLink href={href(page - 1)} label="Go to previous page" icon={ChevronLeftIcon} />
          </PaginationItem>
          <PaginationItem>
            <PageLink href={href(page + 1)} label="Go to next page" icon={ChevronRightIcon} />
          </PaginationItem>
          <PaginationItem>
            <PageLink href={href(lastPage)} label="Go to last page" icon={ChevronsRightIcon} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
