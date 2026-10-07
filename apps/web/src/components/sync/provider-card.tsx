import { CopyCommand } from '@/components/auctions/copy-command'
import { RunStatusBadge } from '@/components/sync/run-status-badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { formatDateTime, formatProvider } from '@/domain/domain-table'
import {
  formatAgo,
  formatIn,
  formatRunDuration,
  nextScheduledSync,
  providerFeed,
  SYNC_SCHEDULE_LABEL
} from '@/domain/sync-schedule'
import type { ProviderSyncSummary } from '@/server/queries/sync-status'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  )
}

export function ProviderCard({ summary, now }: { summary: ProviderSyncSummary; now: Date }) {
  const { provider, latestRun, latestSuccess } = summary
  const running = latestRun?.status === 'running'
  const failed = latestRun?.status === 'failed'
  // Progress is a guess from the last successful run's page count.
  const expectedPages = latestSuccess?.pagesFetched ?? 0
  const progress =
    running && expectedPages > 0
      ? Math.min(99, Math.round((latestRun.pagesFetched / expectedPages) * 100))
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{formatProvider(provider)}</CardTitle>
        <CardDescription>{providerFeed(provider)}</CardDescription>
        {latestRun ? (
          <CardAction>
            <RunStatusBadge status={latestRun.status} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="grid flex-1 content-start gap-4">
        <div>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {summary.activeListings.toLocaleString('en-US')}
          </p>
          <p className="text-sm text-muted-foreground">active listings</p>
        </div>
        {running ? (
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span>
                Page {latestRun.pagesFetched.toLocaleString('en-US')} ·{' '}
                {latestRun.recordsFetched.toLocaleString('en-US')} records
              </span>
              {progress === null ? null : (
                <span className="text-muted-foreground">~{progress}%</span>
              )}
            </div>
            {progress === null ? null : (
              <Progress value={progress} aria-label={`${formatProvider(provider)} sync progress`} />
            )}
            <p className="text-muted-foreground">
              Started {formatDateTime(latestRun.startedAt)}. The table keeps showing the last
              successful run until this one finishes.
            </p>
          </div>
        ) : (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            {failed ? (
              <Fact label="Last attempt">
                <span className="text-destructive">
                  {formatDateTime(latestRun.startedAt)} · failed
                  {latestRun.failedPage === null ? '' : ` on page ${latestRun.failedPage}`}
                </span>
              </Fact>
            ) : null}
            <Fact label="Last success">
              {latestSuccess?.completedAt ? (
                <>
                  {formatDateTime(latestSuccess.completedAt)}
                  <span className="text-muted-foreground">
                    {' '}
                    · {formatAgo(latestSuccess.completedAt, now)}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Never</span>
              )}
            </Fact>
            {latestSuccess ? (
              <>
                <Fact label="Duration">
                  {formatRunDuration(latestSuccess.startedAt, latestSuccess.completedAt, now)}
                </Fact>
                <Fact label="Fetched">
                  {latestSuccess.recordsFetched.toLocaleString('en-US')} records ·{' '}
                  {latestSuccess.pagesFetched.toLocaleString('en-US')} pages
                </Fact>
              </>
            ) : null}
            <Fact label="Next run">
              {SYNC_SCHEDULE_LABEL}
              <span className="text-muted-foreground">
                {' '}
                · {formatIn(nextScheduledSync(now), now)}
              </span>
            </Fact>
          </dl>
        )}
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <span className="text-xs text-muted-foreground">Run locally</span>
        <CopyCommand command={`corepack pnpm sync ${provider}`} />
      </CardFooter>
    </Card>
  )
}
