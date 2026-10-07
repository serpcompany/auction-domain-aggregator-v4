import { TriangleAlertIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatSyncRecency, isInventoryStale } from '@/domain/domain-table'

export function FreshnessBadge({
  latestSuccessfulSync,
  now
}: {
  latestSuccessfulSync: Date | null
  now: Date
}) {
  const stale = isInventoryStale(latestSuccessfulSync, now)
  return (
    <Badge
      variant="outline"
      role="status"
      aria-label="Data freshness"
      title={
        latestSuccessfulSync
          ? `Last successful sync ${formatDateTime(latestSuccessfulSync)}`
          : undefined
      }
      className={
        stale ? 'border-warning-foreground/30 bg-warning text-warning-foreground' : undefined
      }
    >
      {stale ? (
        <TriangleAlertIcon aria-hidden="true" />
      ) : (
        <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
      )}
      {formatSyncRecency(latestSuccessfulSync, now)}
    </Badge>
  )
}
