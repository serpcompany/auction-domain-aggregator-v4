'use client'

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import type * as React from 'react'

import { Badge, badgeVariants } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  type EndTimeState,
  formatAbsoluteEndTime,
  formatAuctionType,
  formatEndTime,
  formatProvider
} from '@/domain/domain-table'
import { cn } from '@/lib/utils'

// Each provider's dot, from its color token in globals.css. A provider
// without a token gets a neutral dot.
const providerDot: Record<string, string> = {
  namecheap: 'bg-provider-namecheap',
  godaddy: 'bg-provider-godaddy',
  dynadot: 'bg-provider-dynadot',
  namesilo: 'bg-provider-namesilo'
}

export function ProviderDot({ provider }: { provider: string }) {
  return (
    <span
      aria-hidden="true"
      data-provider-dot={provider.toLowerCase()}
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        providerDot[provider.toLowerCase()] ?? 'bg-muted-foreground'
      )}
    />
  )
}

export function SourcePill({ provider }: { provider: string }) {
  return (
    <Badge variant="outline" className="max-w-full font-normal">
      <ProviderDot provider={provider} />
      <span className="truncate">{formatProvider(provider)}</span>
    </Badge>
  )
}

export function TypePill({ auctionType }: { auctionType: string }) {
  return (
    <Badge variant="secondary" className="max-w-full font-normal">
      <span className="truncate">{formatAuctionType(auctionType)}</span>
    </Badge>
  )
}

// The countdown's color: amber under 48 hours, neutral otherwise, and
// destructive once the auction has ended.
export const endTimeText: Record<EndTimeState, string> = {
  neutral: '',
  soon: 'font-medium text-warning-foreground',
  ended: 'font-medium text-destructive'
}

const endTimePill: Record<EndTimeState, string> = {
  neutral: badgeVariants({ variant: 'secondary' }),
  soon: cn(badgeVariants({ variant: 'secondary' }), 'bg-warning text-warning-foreground'),
  ended: badgeVariants({ variant: 'destructive' })
}

export type EndTimeTooltip = TooltipPrimitive.Handle<string>

// One tooltip serves every countdown pill of a table, so a page of rows mounts
// one tooltip rather than one per row.
export function createEndTimeTooltip(): EndTimeTooltip {
  return TooltipPrimitive.createHandle<string>()
}

export function EndTimeTooltipContent({ tooltip }: { tooltip: EndTimeTooltip }) {
  return (
    <Tooltip handle={tooltip}>
      {({ payload }) => <TooltipContent>{payload as string}</TooltipContent>}
    </Tooltip>
  )
}

// The Ends cell: a countdown pill with no date. The exact end time is in the
// shared tooltip, and in the pill's text for screen readers.
export function EndsPill({
  endsAt,
  now,
  tooltip
}: {
  endsAt: Date
  now: Date
  tooltip: EndTimeTooltip
}) {
  const end = formatEndTime(endsAt, now)
  const exact = `${end.state === 'ended' ? 'Ended' : 'Ends'} ${formatAbsoluteEndTime(endsAt)}`
  return (
    <TooltipTrigger
      handle={tooltip}
      payload={exact}
      render={
        <time
          dateTime={endsAt.toISOString()}
          data-state={end.state}
          className={cn(endTimePill[end.state], 'max-w-full tabular-nums')}
        />
      }
    >
      <span className="truncate">{end.relative}</span>
      <span className="sr-only"> ({exact})</span>
    </TooltipTrigger>
  )
}

// A Domain Rating as its number inside a ring that fills to the value: a
// conic gradient of the foreground over a faint track, masked to a ring.
export function RatingRing({ value }: { value: number }) {
  const rating = Math.round(value)
  const fill = Math.min(100, Math.max(0, rating))
  return (
    <span
      title="Domain Rating by Ahrefs"
      data-fill={fill}
      style={{ '--rating-fill': `${fill}%` } as React.CSSProperties}
      className="relative -my-0.5 inline-grid size-7 place-items-center align-middle text-[11px] font-semibold tabular-nums"
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full [background:conic-gradient(var(--foreground)_var(--rating-fill),color-mix(in_oklab,var(--foreground)_14%,transparent)_0)] [mask:radial-gradient(farthest-side,transparent_calc(100%_-_3px),var(--foreground)_calc(100%_-_3px))]"
      />
      {rating}
    </span>
  )
}
