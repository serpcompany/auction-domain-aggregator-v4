import { RunStatusBadge } from '@/components/sync/run-status-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { formatDateTime, formatProvider } from '@/domain/domain-table'
import { formatRunDuration } from '@/domain/sync-schedule'
import type { IngestionRun } from '@/server/queries/sync-status'

const number = (value: number) => value.toLocaleString('en-US')

function ErrorCode({ code }: { code: string | null }) {
  if (!code) return <span className="text-muted-foreground">—</span>
  return <code className="font-mono text-xs text-destructive">{code}</code>
}

// Every Workflow run, newest first: a table from md up, a list on phones.
export function RunsTable({ runs, now }: { runs: IngestionRun[]; now: Date }) {
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started (UTC)</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead className="text-right">Pages</TableHead>
              <TableHead className="text-right">Records</TableHead>
              <TableHead className="text-right">Marked inactive</TableHead>
              <TableHead className="text-right">Rejected</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {runs.map(run => (
              <TableRow key={run.id}>
                <TableCell className="pl-4 font-medium">{formatProvider(run.provider)}</TableCell>
                <TableCell>
                  <RunStatusBadge status={run.status} />
                </TableCell>
                <TableCell>{formatDateTime(run.startedAt)}</TableCell>
                <TableCell>{formatRunDuration(run.startedAt, run.completedAt, now)}</TableCell>
                <TableCell className="text-right">{number(run.pagesFetched)}</TableCell>
                <TableCell className="text-right">{number(run.recordsFetched)}</TableCell>
                <TableCell className="text-right">{number(run.recordsInactivated)}</TableCell>
                <TableCell className="text-right">{number(run.recordsRejected)}</TableCell>
                <TableCell>
                  <ErrorCode code={run.errorCode} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul aria-label="Recent runs" className="divide-y md:hidden">
        {runs.map(run => (
          <li key={run.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <span className="font-medium">{formatProvider(run.provider)}</span>
            <RunStatusBadge status={run.status} />
            <span className="text-xs text-muted-foreground">
              {formatDateTime(run.startedAt)} ·{' '}
              {formatRunDuration(run.startedAt, run.completedAt, now)}
            </span>
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {number(run.recordsFetched)} records
            </span>
            {run.errorCode ? (
              <span className="col-span-2">
                <ErrorCode code={run.errorCode} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  )
}
