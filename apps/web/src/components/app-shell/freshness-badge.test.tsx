import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FreshnessBadge } from '@/components/app-shell/freshness-badge'

const now = new Date('2026-07-13T10:00:00.000Z')

afterEach(cleanup)

describe('FreshnessBadge', () => {
  it('shows how long ago the last successful sync finished', () => {
    render(<FreshnessBadge latestSuccessfulSync={new Date('2026-07-13T09:58:00.000Z')} now={now} />)

    const badge = screen.getByRole('status', { name: 'Data freshness' })
    expect(badge).toHaveTextContent('Synced 2 minutes ago')
    expect(badge).toHaveAttribute('title', 'Last successful sync Jul 13, 2026, 09:58 UTC')
    expect(badge).not.toHaveClass('bg-warning')
  })

  it('says when nothing has synced yet', () => {
    render(<FreshnessBadge latestSuccessfulSync={null} now={now} />)

    const badge = screen.getByRole('status', { name: 'Data freshness' })
    expect(badge).toHaveTextContent('No successful sync yet')
    expect(badge).not.toHaveAttribute('title')
  })

  it('turns to a warning when the inventory is stale', () => {
    render(
      <FreshnessBadge latestSuccessfulSync={new Date(now.getTime() - 2 * 86_400_000)} now={now} />
    )

    const badge = screen.getByRole('status', { name: 'Data freshness' })
    expect(badge).toHaveTextContent('Synced 2 days ago')
    expect(badge).toHaveClass('bg-warning', 'text-warning-foreground')
  })
})
