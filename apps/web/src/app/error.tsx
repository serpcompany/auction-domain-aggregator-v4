'use client'

import { CircleAlertIcon, RotateCwIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { SiteHeader } from '@/components/app-shell/site-header'
import { CopyCommand } from '@/components/auctions/copy-command'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'

// Shown when a page cannot read D1, usually because local migrations have
// not been applied. Try again re-renders the page from the server.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const retry = () =>
    startTransition(() => {
      router.refresh()
      reset()
    })

  return (
    <>
      <SiteHeader title="Auctions" />
      <div className="flex flex-1 flex-col p-4 md:h-[calc(100svh-3rem)]">
        <section className="flex flex-1 rounded-lg border">
          <Empty className="min-h-80">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="text-destructive">
                <CircleAlertIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h1>The inventory couldn’t be read</h1>
              </EmptyTitle>
              <EmptyDescription>
                The local database didn’t respond. Apply the migrations, then try again.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <CopyCommand command="corepack pnpm db:migrate:local" />
              <Button variant="outline" size="sm" onClick={retry} disabled={pending}>
                <RotateCwIcon aria-hidden="true" />
                Try again
              </Button>
            </EmptyContent>
          </Empty>
        </section>
      </div>
    </>
  )
}
