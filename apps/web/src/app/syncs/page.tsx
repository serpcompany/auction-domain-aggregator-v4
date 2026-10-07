import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Metadata } from 'next'

import { FreshnessBadge } from '@/components/app-shell/freshness-badge'
import { SiteHeader } from '@/components/app-shell/site-header'
import { SyncStatusPage } from '@/components/sync/sync-status-page'
import { syncSchedule } from '@/domain/sync-schedule'
import { querySyncStatus } from '@/server/queries/sync-status'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sync status · Auction Domain Aggregator' }

export default async function SyncsPage() {
  const status = await querySyncStatus()
  const now = new Date()
  const latestSuccessfulSync = status.providers
    .map(summary => summary.latestSuccess?.completedAt ?? null)
    .reduce<Date | null>(
      (latest, value) => (value && (!latest || value > latest) ? value : latest),
      null
    )

  return (
    <>
      <SiteHeader title="Sync status">
        <FreshnessBadge latestSuccessfulSync={latestSuccessfulSync} now={now} />
      </SiteHeader>
      <SyncStatusPage
        status={status}
        now={now}
        schedule={syncSchedule(getCloudflareContext().env.SYNC_TIME_UTC)}
      />
    </>
  )
}
