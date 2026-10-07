'use client'

import { CopyIcon, ExternalLinkIcon, PanelRightOpenIcon } from 'lucide-react'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  type EndTimeState,
  formatAbsoluteEndTime,
  formatAuctionType,
  formatDateTime,
  formatEndTime,
  formatMoney,
  formatProvider
} from '@/domain/domain-table'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import type { DomainListingRow } from '@/server/queries/domain-listings'

const OpenDetails = createContext<(row: DomainListingRow) => void>(() => {})

const urgency: Record<EndTimeState, string> = {
  neutral: '',
  amber: 'font-medium text-warning-foreground',
  red: 'font-semibold text-destructive',
  ended: 'font-semibold text-destructive'
}

// Opens the panel for one row. `stretched` makes the whole list item the
// target while links inside it (raised above it) keep working.
export function ListingDetailsTrigger({
  row,
  stretched = false
}: {
  row: DomainListingRow
  stretched?: boolean
}) {
  const open = useContext(OpenDetails)
  if (stretched) {
    return (
      <button
        type="button"
        onClick={() => open(row)}
        className="absolute inset-0 rounded-[inherit] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="sr-only">Details for {row.domainName}</span>
      </button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => open(row)}
      aria-label={`Details for ${row.domainName}`}
      className="text-muted-foreground"
    >
      <PanelRightOpenIcon aria-hidden="true" />
    </Button>
  )
}

function Value({ children }: { children: ReactNode }) {
  return children ?? <span className="text-muted-foreground">Not collected</span>
}

function Facts({ title, facts }: { title: string; facts: Array<[string, ReactNode]> }) {
  return (
    <section aria-label={title} className="grid gap-2.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right tabular-nums">
              <Value>{value}</Value>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Metric({ label, title, value }: { label: string; title: string; value: ReactNode }) {
  return (
    <div className="grid gap-0.5 rounded-lg border p-2.5" title={title}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-medium tabular-nums">
        {value ?? <span className="text-muted-foreground">—</span>}
      </span>
    </div>
  )
}

function DetailsBody({ row, now }: { row: DomainListingRow; now: Date }) {
  const provider = formatProvider(row.provider)
  const end = formatEndTime(row.endsAt, now)
  const seo = row.seoMetrics
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(row.domainName)
      toast.success(`Copied ${row.domainName}`)
    } catch {
      toast.error('Copying is blocked in this browser.')
    }
  }
  const rating =
    row.domainRating !== null ? (
      Math.round(row.domainRating)
    ) : row.domainRatingFetched ? (
      <span className="text-sm text-muted-foreground">No rating</span>
    ) : null

  return (
    <div className="grid gap-5 overflow-y-auto px-4 pb-6">
      <div className="flex gap-2">
        <a
          href={row.auctionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants(), 'flex-1')}
        >
          Open auction on {provider}
          <ExternalLinkIcon aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <Button variant="outline" size="icon" onClick={copy} aria-label="Copy domain">
          <CopyIcon aria-hidden="true" />
        </Button>
      </div>
      <Facts
        title="Auction"
        facts={[
          ['Current price', formatMoney(row.currentBidCents, row.currency)],
          ['Bids', row.bidCount.toLocaleString('en-US')],
          [
            'Ends',
            <>
              <span className={urgency[end.state]}>{end.relative}</span>
              <span className="text-muted-foreground"> · {formatAbsoluteEndTime(row.endsAt)}</span>
            </>
          ],
          [
            'Renewal',
            row.renewalPriceCents === null ? null : formatMoney(row.renewalPriceCents, row.currency)
          ],
          [
            'Appraisal',
            row.appraisalCents === null ? null : (
              <>
                {formatMoney(row.appraisalCents, row.currency)}
                <span className="text-muted-foreground"> · {provider}</span>
              </>
            )
          ]
        ]}
      />
      <Separator />
      <Facts
        title="Domain"
        facts={[
          [
            'TLD',
            <span key="tld" className="font-mono">
              .{row.tld}
            </span>
          ],
          ['Length', `${row.domainLength} characters`],
          ['Hyphens · Digits', `${row.hasHyphen ? 'Yes' : 'No'} · ${row.hasDigit ? 'Yes' : 'No'}`],
          ['Age', row.ageYears === null ? null : `${row.ageYears} years`],
          ['Visitors', row.visitors?.toLocaleString('en-US')],
          ['Inbound links', row.inboundLinks?.toLocaleString('en-US')]
        ]}
      />
      <Separator />
      <section aria-label="SEO metrics" className="grid gap-2.5">
        <h3 className="text-xs font-medium text-muted-foreground">SEO metrics</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1.4fr]">
          <Metric label="Trust Flow" title="Majestic Trust Flow" value={seo?.majesticTf} />
          <Metric label="Citation Flow" title="Majestic Citation Flow" value={seo?.majesticCf} />
          <Metric label="Authority" title="Semrush Authority Score" value={seo?.semrushAs} />
          <div className="grid gap-0.5 rounded-lg border p-2.5">
            <span className="text-xs text-muted-foreground">DR</span>
            <span className="text-lg font-medium tabular-nums">
              {rating ?? <span className="text-muted-foreground">—</span>}
            </span>
            {/* Required by the Ahrefs Domain Rating licence. */}
            <a
              href="https://ahrefs.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Domain Rating by Ahrefs
            </a>
          </div>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-sm">
          <dt className="text-muted-foreground">Majestic referring domains</dt>
          <dd className="text-right tabular-nums">
            <Value>{seo?.majesticRefDomains?.toLocaleString('en-US')}</Value>
          </dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          {seo
            ? `Majestic and Semrush values from the ${formatProvider(seo.source)} feed, updated ${formatDateTime(seo.updatedAt)}.`
            : 'No feed has published Majestic or Semrush metrics for this domain.'}
        </p>
      </section>
    </div>
  )
}

// Holds the open row. The panel uses the row the page already loaded, so
// opening it costs no request. A Sheet on desktop, a Drawer on phones.
export function ListingDetailsProvider({ now, children }: { now: Date; children: ReactNode }) {
  const [row, setRow] = useState<DomainListingRow | null>(null)
  const isMobile = useIsMobile()
  // The panel only opens from a trigger, so any change it reports is a close.
  const close = () => setRow(null)
  const title = row ? (
    <>
      <span className="font-mono">{row.domainName}</span>
    </>
  ) : null
  const description = row
    ? `${formatProvider(row.provider)} · ${formatAuctionType(row.auctionType)} · ends in ${formatEndTime(row.endsAt, now).relative}`
    : null

  return (
    <OpenDetails.Provider value={setRow}>
      {children}
      {isMobile ? (
        <Drawer open={row !== null} onOpenChange={close}>
          <DrawerContent className="max-h-[88svh]">
            <DrawerHeader>
              <DrawerTitle>{title}</DrawerTitle>
              <DrawerDescription>{description}</DrawerDescription>
            </DrawerHeader>
            {row ? <DetailsBody row={row} now={now} /> : null}
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open={row !== null} onOpenChange={close}>
          <SheetContent className="data-[side=right]:sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="text-lg">{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </SheetHeader>
            {row ? <DetailsBody row={row} now={now} /> : null}
          </SheetContent>
        </Sheet>
      )}
    </OpenDetails.Provider>
  )
}
