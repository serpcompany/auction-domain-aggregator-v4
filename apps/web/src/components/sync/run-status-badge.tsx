import { CircleCheckIcon, CircleXIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import type { IngestionRun } from '@/server/queries/sync-status'

export function RunStatusBadge({ status }: { status: IngestionRun['status'] }) {
  if (status === 'succeeded')
    return (
      <Badge variant="outline">
        <CircleCheckIcon aria-hidden="true" />
        Succeeded
      </Badge>
    )
  if (status === 'running')
    return (
      <Badge variant="secondary">
        <Spinner aria-hidden="true" className="size-3" />
        Running
      </Badge>
    )
  return (
    <Badge variant="destructive">
      <CircleXIcon aria-hidden="true" />
      Failed
    </Badge>
  )
}
