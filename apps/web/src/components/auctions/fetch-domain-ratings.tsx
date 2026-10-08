'use client'

import { GaugeIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const ERROR_MESSAGES: Record<string, string> = {
  too_many_listings: 'Too many matching listings. Narrow the filters and try again.',
  ahrefs_not_configured: 'No Ahrefs key is set for this site.',
  ahrefs_cool_down: 'Ahrefs asked for a pause. Try again in a minute.',
  ahrefs_rate_limited: 'Ahrefs asked for a pause. Try again in a minute.'
}

// Asks the server to fetch Ahrefs DR for every listing the filters match, once
// they match at most `limit`, then re-renders the page from D1.
export function FetchDomainRatingsButton({
  total,
  limit,
  search
}: {
  total: number
  limit: number
  search: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  if (total === 0) return null

  const run = async () => {
    if (total > limit) {
      toast.info(
        `Narrow the filters to ${limit.toLocaleString('en-US')} listings or fewer to fetch DR.`
      )
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/enrichment/domain-rating/matching', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ search })
      })
      const body = (await response.json()) as {
        requested?: number
        stored?: number
        errorCode?: string
      }
      if (!response.ok) {
        toast.error(
          ERROR_MESSAGES[body.errorCode ?? ''] ?? 'Ahrefs did not answer. Try again later.'
        )
      } else if (!body.stored) {
        toast.success('Every matching domain already has DR.')
      } else {
        toast.success(`Fetched DR for ${body.stored.toLocaleString('en-US')} domains.`)
        router.refresh()
      }
    } catch {
      toast.error('Ahrefs did not answer. Try again later.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="xs"
      disabled={busy}
      onClick={run}
      title={`Fetch Ahrefs DR for every matching listing (up to ${limit.toLocaleString('en-US')})`}
    >
      {busy ? <Spinner /> : <GaugeIcon aria-hidden="true" />}
      Fetch DR
    </Button>
  )
}
