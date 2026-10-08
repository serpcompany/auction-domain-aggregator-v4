'use client'

import { useRouter } from 'next/navigation'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'

import { useVisibleColumns } from '@/components/auctions/table-layout'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'

// Domains per request, under the route's limit of 50: a 96-row page is two.
export const DOMAIN_RATING_PAGE_BATCH = 48

const Pending = createContext<ReadonlySet<string>>(new Set())

// Whether the server stored a rating for any of these domains. Enrichment is
// best effort, so a failure counts as nothing stored.
async function requestRatings(domains: string[], signal: AbortSignal) {
  try {
    const response = await fetch('/api/enrichment/domain-rating', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domains }),
      signal
    })
    const body = response.ok ? ((await response.json()) as { stored?: unknown }) : {}
    return typeof body.stored === 'number' && body.stored > 0
  } catch {
    return false
  }
}

// While the DR column shows, asks the server to fetch Ahrefs DR for the rows
// that have none stored, marks those cells as loading meanwhile, then
// re-renders the page from D1. Whether DR shows is the browser's layout, so
// showing the column again asks for the missing ratings without a page request.
// The requests go out together; the page refreshes once, after all of them
// settle, because a refresh re-runs every D1 read of the page. On any failure
// the cells go back to "not collected".
export function DomainRatingsProvider({
  domains,
  children
}: {
  domains: string[]
  children: ReactNode
}) {
  // The effect depends on the domains only; a ref keeps the router out of it.
  const router = useRef(useRouter())
  const { columns } = useVisibleColumns()
  const key = columns.includes('domainRating') ? domains.join(',') : ''
  const [pending, setPending] = useState<ReadonlySet<string>>(
    () => new Set(key === '' ? [] : domains)
  )

  useEffect(() => {
    if (key === '') return
    const all = key.split(',')
    setPending(new Set(all))
    const controller = new AbortController()
    const batches: string[][] = []
    for (let start = 0; start < all.length; start += DOMAIN_RATING_PAGE_BATCH) {
      batches.push(all.slice(start, start + DOMAIN_RATING_PAGE_BATCH))
    }
    void (async () => {
      const stored = await Promise.all(
        batches.map(batch => requestRatings(batch, controller.signal))
      )
      if (controller.signal.aborted) return
      if (stored.includes(true)) router.current.refresh()
      setPending(new Set())
    })()
    return () => controller.abort()
  }, [key])

  return <Pending.Provider value={pending}>{children}</Pending.Provider>
}

// A DR cell for a domain without a stored rating: a spinner while Ahrefs is
// asked, then what the server knows.
export function PendingRating({ domain, children }: { domain: string; children: ReactNode }) {
  const pending = useContext(Pending)
  if (!pending.has(domain)) return children
  return (
    <span className="inline-flex justify-end" title="Fetching from Ahrefs">
      <Spinner className="size-3.5 text-muted-foreground" aria-label="Fetching Domain Rating" />
    </span>
  )
}

// The phone list's DR badge for a domain without a stored rating, shown only
// while Ahrefs is asked.
export function PendingRatingBadge({ domain }: { domain: string }) {
  const pending = useContext(Pending)
  if (!pending.has(domain)) return null
  return (
    <Badge className="font-semibold" title="Domain Rating by Ahrefs">
      DR
      <Spinner className="size-3" aria-label="Fetching Domain Rating" />
    </Badge>
  )
}
