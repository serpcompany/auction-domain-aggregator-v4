import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ListingDetailsProvider } from '@/components/auctions/listing-details'
import { ResultsList } from '@/components/auctions/results-list'
import { emptyRow, fullRow, now } from '@/components/auctions/test-rows'
import { DEFAULT_COLUMNS, TABLE_COLUMNS } from '@/domain/table-columns'

afterEach(cleanup)

function renderList(rows = [fullRow, emptyRow], columns = TABLE_COLUMNS.map(c => c.key)) {
  render(
    <ListingDetailsProvider now={now}>
      <ResultsList rows={rows} visibleColumns={columns} now={now} />
    </ListingDetailsProvider>
  )
  return within(screen.getByRole('list', { name: 'Domain results' })).getAllByRole('listitem')
}

describe('ResultsList', () => {
  it('shows each listing on two lines with badges for the chosen columns', () => {
    const [full, empty] = renderList()

    expect(within(full).getByRole('link', { name: /garden-example\.com/ })).toHaveAttribute(
      'target',
      '_blank'
    )
    expect(full).toHaveTextContent('$12.50')
    expect(full).toHaveTextContent('Dynadot · Expired · 3 bids')
    expect(within(full).getByText('30m')).toHaveClass('text-destructive')
    expect(
      within(full)
        .getAllByText(/./, { selector: '[data-slot=badge]' })
        .map(badge => badge.textContent)
    ).toEqual([
      '12 yrs',
      '1.5K links',
      'Appr. $2,000',
      'Renews $10.88',
      '20 visitors',
      '18 chars',
      'TF 12',
      'CF 15',
      '28 ref. domains',
      'AS 33',
      'DR 42'
    ])
    expect(within(full).getByText('DR 42')).toHaveAttribute('title', 'Domain Rating by Ahrefs')
    expect(
      within(full).getByRole('button', { name: 'Details for garden-example.com' })
    ).toBeInTheDocument()

    expect(empty).toHaveTextContent('GoDaddy · Auction · 1 bid')
    expect(
      within(empty)
        .getAllByText(/./, { selector: '[data-slot=badge]' })
        .map(badge => badge.textContent)
    ).toEqual(['17 chars'])
    expect(screen.getByRole('link', { name: 'Domain Rating by Ahrefs' })).toHaveAttribute(
      'href',
      'https://ahrefs.com/'
    )
  })

  it('drops the DR note and badges with their columns', () => {
    const [full] = renderList(
      [{ ...fullRow, ageYears: null, seoMetrics: null }],
      ['age', 'renewal']
    )

    expect(screen.queryByRole('link', { name: 'Domain Rating by Ahrefs' })).not.toBeInTheDocument()
    expect(within(full).getByText('Renews $10.88')).toBeInTheDocument()
    expect(within(full).queryByText(/^DR/)).not.toBeInTheDocument()
  })

  it('leaves out the badge row when nothing is chosen', () => {
    const [full] = renderList([fullRow], [])
    expect(within(full).queryByText('12 yrs')).not.toBeInTheDocument()
    expect(DEFAULT_COLUMNS).toContain('domainRating')
  })
})
