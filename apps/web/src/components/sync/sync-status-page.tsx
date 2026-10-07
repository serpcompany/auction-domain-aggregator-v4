import { CircleAlertIcon, RefreshCwIcon } from 'lucide-react'

import { CopyCommand } from '@/components/auctions/copy-command'
import { ProviderCard } from '@/components/sync/provider-card'
import { RunsTable } from '@/components/sync/runs-table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { formatDateTime, formatProvider } from '@/domain/domain-table'
import type { SyncStatus } from '@/server/queries/sync-status'

export function SyncStatusPage({ status, now }: { status: SyncStatus; now: Date }) {
  const failed = status.providers.flatMap(({ provider, latestRun, latestSuccess }) =>
    latestRun?.status === 'failed' ? [{ provider, latestRun, latestSuccess }] : []
  )

  return (
    <div className="mx-auto grid w-full max-w-6xl content-start gap-4 p-4">
      <h1 className="sr-only">Sync status</h1>
      {failed.map(({ provider, latestRun, latestSuccess }) => (
        <Alert key={provider} variant="destructive" role="alert">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{formatProvider(provider)}’s last sync failed</AlertTitle>
          <AlertDescription>
            Error <code className="font-mono">{latestRun.errorCode ?? 'unknown'}</code>
            {latestRun.failedPage === null ? '' : ` on page ${latestRun.failedPage}`}.{' '}
            {latestSuccess?.completedAt
              ? `${formatProvider(provider)} listings from the run on ${formatDateTime(latestSuccess.completedAt)} stay in the table; nothing was marked inactive.`
              : 'Nothing was marked inactive.'}
          </AlertDescription>
        </Alert>
      ))}
      {status.providers.length === 0 ? (
        <Card>
          <Empty className="min-h-72">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RefreshCwIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h2>No syncs have run yet</h2>
              </EmptyTitle>
              <EmptyDescription>
                The ingestion Worker syncs every provider daily. To fill the local database now, run
                a sync; GoDaddy needs no credentials.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <CopyCommand command="corepack pnpm sync godaddy" />
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {status.providers.map(summary => (
              <ProviderCard key={summary.provider} summary={summary} now={now} />
            ))}
          </div>
          <Card className="gap-2 pb-0">
            <CardHeader>
              <CardTitle>
                <h2>Recent runs</h2>
              </CardTitle>
              <CardDescription>
                Every Workflow run, newest first. Failed and interrupted runs never mark listings
                inactive.
              </CardDescription>
            </CardHeader>
            <RunsTable runs={status.recentRuns} now={now} />
          </Card>
        </>
      )}
    </div>
  )
}
