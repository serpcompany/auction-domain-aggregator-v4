import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ProviderCard } from '@/components/sync/provider-card'
import { SyncStatusPage } from '@/components/sync/sync-status-page'
import type { IngestionRun, ProviderSyncSummary } from '@/server/queries/sync-status'

afterEach(cleanup)

const now = new Date('2026-10-07T02:19:00.000Z')

function run(overrides: Partial<IngestionRun>): IngestionRun {
  return {
    id: 1,
    provider: 'godaddy',
    status: 'succeeded',
    startedAt: new Date('2026-10-06T15:31:00.000Z'),
    completedAt: new Date('2026-10-06T15:33:19.000Z'),
    pagesFetched: 587,
    nextPage: 588,
    recordsFetched: 586_958,
    recordsUpserted: 586_958,
    recordsInactivated: 0,
    recordsRejected: 0,
    errorCode: null,
    failedPage: null,
    ...overrides
  }
}

const success = run({})
const summary = (overrides: Partial<ProviderSyncSummary> = {}): ProviderSyncSummary => ({
  provider: 'godaddy',
  activeListings: 472_855,
  latestRun: success,
  latestSuccess: success,
  ...overrides
})

describe('ProviderCard', () => {
  it('summarizes a provider whose last sync succeeded', () => {
    render(<ProviderCard summary={summary()} now={now} />)

    expect(screen.getByText('GoDaddy')).toBeInTheDocument()
    expect(screen.getByText('Daily inventory file')).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('472,855')).toBeInTheDocument()
    expect(screen.getByText('Last success').nextSibling).toHaveTextContent(
      'Oct 6, 2026, 15:33 UTC · 10h 45m ago'
    )
    expect(screen.getByText('Duration').nextSibling).toHaveTextContent('2m 19s')
    expect(screen.getByText('Fetched').nextSibling).toHaveTextContent('586,958 records · 587 pages')
    expect(screen.getByText('Next run').nextSibling).toHaveTextContent(
      'Daily at 15:30 UTC · in 13h 11m'
    )
    expect(screen.getByText('corepack pnpm sync godaddy')).toBeInTheDocument()
  })

  it('shows progress while a sync runs', () => {
    const running = run({
      id: 2,
      status: 'running',
      startedAt: new Date('2026-10-07T02:12:00.000Z'),
      completedAt: null,
      pagesFetched: 214,
      recordsFetched: 213_000
    })
    render(<ProviderCard summary={summary({ latestRun: running })} now={now} />)

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Page 214 · 213,000 records')).toBeInTheDocument()
    expect(screen.getByText('~36%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'GoDaddy sync progress' })).toBeInTheDocument()
    cleanup()

    render(
      <ProviderCard summary={summary({ latestRun: running, latestSuccess: null })} now={now} />
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('names the failed attempt and keeps the last success', () => {
    const failed = run({
      id: 3,
      provider: 'dynadot',
      status: 'failed',
      startedAt: new Date('2026-10-07T01:30:00.000Z'),
      errorCode: 'dynadot_sync_failed',
      failedPage: 1
    })
    render(
      <ProviderCard
        summary={summary({ provider: 'dynadot', latestRun: failed, latestSuccess: null })}
        now={now}
      />
    )

    expect(screen.getByText('Auction API')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Last attempt').nextSibling).toHaveTextContent(
      'Oct 7, 2026, 01:30 UTC · failed on page 1'
    )
    expect(screen.getByText('Last success').nextSibling).toHaveTextContent('Never')
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    cleanup()

    render(
      <ProviderCard
        summary={summary({ latestRun: { ...failed, failedPage: null }, latestSuccess: null })}
        now={now}
      />
    )
    expect(screen.getByText('Last attempt').nextSibling).toHaveTextContent('· failed')
  })

  it('shows a provider without runs', () => {
    render(<ProviderCard summary={summary({ latestRun: null, latestSuccess: null })} now={now} />)
    expect(screen.queryByText('Succeeded')).not.toBeInTheDocument()
  })
})

describe('SyncStatusPage', () => {
  it('flags failed syncs and lists recent runs', () => {
    const failed = run({
      id: 5,
      provider: 'dynadot',
      status: 'failed',
      errorCode: 'dynadot_sync_failed',
      failedPage: 1,
      recordsFetched: 1_000
    })
    render(
      <SyncStatusPage
        status={{
          providers: [
            summary(),
            summary({
              provider: 'dynadot',
              latestRun: failed,
              latestSuccess: run({ id: 4, provider: 'dynadot' })
            }),
            summary({
              provider: 'namejet',
              latestRun: { ...failed, failedPage: null, errorCode: null },
              latestSuccess: null
            })
          ],
          recentRuns: [failed, success]
        }}
        now={now}
      />
    )

    const alerts = screen.getAllByRole('alert')
    expect(alerts[0]).toHaveTextContent('Dynadot’s last sync failed')
    expect(alerts[0]).toHaveTextContent(
      'Error dynadot_sync_failed on page 1. Dynadot listings from the run on Oct 6, 2026, 15:33 UTC stay in the table; nothing was marked inactive.'
    )
    expect(alerts[1]).toHaveTextContent('Error unknown. Nothing was marked inactive.')

    expect(screen.getByRole('heading', { name: 'Recent runs' })).toBeInTheDocument()
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent(
      'DynadotFailedOct 6, 2026, 15:31 UTC2m 19s5871,00000dynadot_sync_failed'
    )
    expect(rows[2]).toHaveTextContent('GoDaddySucceededOct 6, 2026, 15:31 UTC2m 19s587586,95800—')
    const list = screen.getByRole('list', { name: 'Recent runs' })
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('dynadot_sync_failed')
  })

  it('explains a database with no syncs', () => {
    render(<SyncStatusPage status={{ providers: [], recentRuns: [] }} now={now} />)
    expect(screen.getByRole('heading', { name: 'No syncs have run yet' })).toBeInTheDocument()
    expect(screen.getByText('corepack pnpm sync godaddy')).toBeInTheDocument()
  })
})
