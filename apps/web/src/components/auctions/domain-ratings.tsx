'use client'

import { useRouter } from 'next/navigation'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'

const Pending = createContext<ReadonlySet<string>>(new Set())

// Asks the server to fetch Ahrefs DR for the shown rows that have none stored,
// marks those cells as loading meanwhile, then re-renders the page from D1.
// On any failure the cells go back to "not collected".
export function DomainRatingsProvider({
  domains,
  children
}: {
  domains: string[]
  children: ReactNode
}) {
  // The effect depends on the domains only; a ref keeps the router out of it.
  const router = useRef(useRouter())
  const key = domains.join(',')
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set(domains))

  useEffect(() => {
    if (key === '') return
    setPending(new Set(key.split(',')))
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch('/api/enrichment/domain-rating', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domains: key.split(',') }),
          signal: controller.signal
        })
        const body = response.ok ? ((await response.json()) as { stored?: unknown }) : {}
        if (typeof body.stored === 'number' && body.stored > 0) router.current.refresh()
      } catch {
        // Enrichment is best effort.
      } finally {
        if (!controller.signal.aborted) setPending(new Set())
      }
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
    <Badge variant="secondary" className="font-normal" title="Domain Rating by Ahrefs">
      DR
      <Spinner className="size-3" aria-label="Fetching Domain Rating" />
    </Badge>
  )
}
