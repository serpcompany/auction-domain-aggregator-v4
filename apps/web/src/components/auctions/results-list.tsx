'use client'

import { ExternalLinkIcon } from 'lucide-react'

import { PendingRatingBadge } from '@/components/auctions/domain-ratings'
import { endTimeText, ProviderDot } from '@/components/auctions/listing-cells'
import { ListingDetailsTrigger } from '@/components/auctions/listing-details'
import { useVisibleColumns } from '@/components/auctions/table-layout'
import { Badge } from '@/components/ui/badge'
import {
  formatAuctionType,
  formatCompactCount,
  formatEndTime,
  formatMoney,
  formatProvider
} from '@/domain/domain-table'
import { type ColumnKey, TABLE_COLUMNS } from '@/domain/table-columns'
import { cn } from '@/lib/utils'
import type { DomainListingRow } from '@/server/queries/domain-listings'

// The metric badges under each listing follow the chosen columns. Source,
// price, bids, and the end time are always in the item itself.
function badge(key: ColumnKey, row: DomainListingRow): string | null {
  const seo = row.seoMetrics
  const count = (value: number) => formatCompactCount(value).compact
  switch (key) {
    case 'age':
      return row.ageYears === null ? null : `${row.ageYears} yrs`
    case 'links':
      return row.inboundLinks === null ? null : `${count(row.inboundLinks)} links`
    case 'appraisal':
      return row.appraisalCents === null
        ? null
        : `Appr. ${formatMoney(row.appraisalCents, row.currency)}`
    case 'renewal':
      return row.renewalPriceCents === null
        ? null
        : `Renews ${formatMoney(row.renewalPriceCents, row.currency)}`
    case 'visitors':
      return row.visitors === null ? null : `${count(row.visitors)} visitors`
    case 'length':
      return `${row.domainLength} chars`
    case 'majesticTf':
      return seo?.majesticTf == null ? null : `TF ${seo.majesticTf}`
    case 'majesticCf':
      return seo?.majesticCf == null ? null : `CF ${seo.majesticCf}`
    case 'majesticRefDomains':
      return seo?.majesticRefDomains == null
        ? null
        : `${count(seo.majesticRefDomains)} ref. domains`
    case 'semrushAs':
      return seo?.semrushAs == null ? null : `AS ${seo.semrushAs}`
    case 'domainRating':
      return row.domainRating === null ? null : `DR ${Math.round(row.domainRating)}`
    default:
      return null
  }
}

// The phone list. Its badges follow the browser's chosen columns, and the DR
// badge stands out from the rest.
export function ResultsList({ rows, now }: { rows: DomainListingRow[]; now: Date }) {
  const { columns: visibleColumns } = useVisibleColumns()
  const badgeColumns = TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key))
  return (
    <div>
      {visibleColumns.includes('domainRating') ? (
        <p className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          DR = {/* Required by the Ahrefs Domain Rating licence. */}
          <a
            href="https://ahrefs.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Domain Rating by Ahrefs
          </a>
          . Tap a listing for details.
        </p>
      ) : null}
      <ul aria-label="Domain results" className="divide-y">
        {rows.map(row => {
          const end = formatEndTime(row.endsAt, now)
          const badges = badgeColumns
            .map(column => [column.key, badge(column.key, row)] as const)
            .filter((entry): entry is [ColumnKey, string] => entry[1] !== null)
          const pendingRating = visibleColumns.includes('domainRating') && !row.domainRatingFetched
          return (
            <li
              key={`${row.provider}:${row.externalId}`}
              className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-3 hover:bg-muted/50"
            >
              <a
                href={row.auctionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative z-10 inline-flex max-w-full min-w-0 items-center gap-1.5 justify-self-start font-mono font-medium underline-offset-4 hover:underline"
              >
                <span className="truncate">{row.domainName}</span>
                <ExternalLinkIcon
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only"> (opens auction in a new tab)</span>
              </a>
              <span className="text-right font-semibold tabular-nums">
                {formatMoney(row.currentBidCents, row.currency)}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <ProviderDot provider={row.provider} />
                <span className="truncate">
                  {formatProvider(row.provider)} · {formatAuctionType(row.auctionType)} ·{' '}
                  {row.bidCount.toLocaleString('en-US')} {row.bidCount === 1 ? 'bid' : 'bids'}
                </span>
              </span>
              <time
                dateTime={row.endsAt.toISOString()}
                className={cn('text-right text-xs tabular-nums', endTimeText[end.state])}
              >
                {end.relative}
              </time>
              {badges.length > 0 || pendingRating ? (
                <div className="col-span-2 mt-1.5 flex flex-wrap gap-1">
                  {badges.map(([key, text]) => (
                    <Badge
                      key={key}
                      variant={key === 'domainRating' ? 'default' : 'secondary'}
                      className={cn(
                        'tabular-nums',
                        key === 'domainRating' ? 'font-semibold' : 'font-normal'
                      )}
                      title={key === 'domainRating' ? 'Domain Rating by Ahrefs' : undefined}
                    >
                      {text}
                    </Badge>
                  ))}
                  {pendingRating ? <PendingRatingBadge domain={row.domainName} /> : null}
                </div>
              ) : null}
              <ListingDetailsTrigger row={row} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
