import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ListingDetailsProvider,
  ListingDetailsTrigger
} from '@/components/auctions/listing-details'
import { emptyRow, fullRow, now } from '@/components/auctions/test-rows'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

let width = 1440
beforeAll(() => {
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => width })
  toast.success.mockClear()
  toast.error.mockClear()
})
afterEach(cleanup)

function renderTriggers() {
  render(
    <ListingDetailsProvider now={now}>
      <ListingDetailsTrigger row={fullRow} />
      <ListingDetailsTrigger row={emptyRow} />
    </ListingDetailsProvider>
  )
}

describe('ListingDetails', () => {
  it('does nothing outside a provider', () => {
    render(<ListingDetailsTrigger row={fullRow} />)
    fireEvent.click(screen.getByRole('button', { name: 'Details for garden-example.com' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens a side sheet with every collected value on desktop', async () => {
    width = 1440
    renderTriggers()
    fireEvent.click(screen.getByRole('button', { name: 'Details for garden-example.com' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('garden-example.com')).toBeInTheDocument()
    expect(within(dialog).getByText('Dynadot · Expired · ends in 30m')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Open auction on Dynadot/ })).toHaveAttribute(
      'href',
      fullRow.auctionUrl
    )
    const auction = within(dialog).getByRole('region', { name: 'Auction' })
    expect(auction).toHaveTextContent('Current price$12.50')
    expect(auction).toHaveTextContent('Bids3')
    expect(auction).toHaveTextContent('Ends30m · Jul 13, 10:30 UTC')
    expect(auction).toHaveTextContent('Renewal$10.88')
    expect(auction).toHaveTextContent('Appraisal$2,000 · Dynadot')
    const domain = within(dialog).getByRole('region', { name: 'Domain' })
    expect(domain).toHaveTextContent('TLD.com')
    expect(domain).toHaveTextContent('Length18 characters')
    expect(domain).toHaveTextContent('Hyphens · DigitsYes · No')
    expect(domain).toHaveTextContent('Age12 years')
    expect(domain).toHaveTextContent('Inbound links1,500')
    const seo = within(dialog).getByRole('region', { name: 'SEO metrics' })
    expect(within(seo).getByTitle('Majestic Trust Flow')).toHaveTextContent('12')
    expect(seo).toHaveTextContent('DR42Domain Rating by Ahrefs')
    expect(within(seo).getByRole('link', { name: 'Domain Rating by Ahrefs' })).toHaveAttribute(
      'href',
      'https://ahrefs.com/'
    )
    expect(seo).toHaveTextContent('Majestic referring domains28')
    expect(seo).toHaveTextContent('from the GoDaddy feed, updated Jul 12, 2026')
  })

  it('says what was not collected, and closes', async () => {
    width = 1440
    renderTriggers()
    fireEvent.click(screen.getByRole('button', { name: 'Details for fresh2example.net' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('region', { name: 'Auction' })).toHaveTextContent(
      'RenewalNot collected'
    )
    expect(within(dialog).getByRole('region', { name: 'Domain' })).toHaveTextContent(
      'VisitorsNot collected'
    )
    expect(dialog).toHaveTextContent('No feed has published Majestic or Semrush metrics')
    expect(within(dialog).getByRole('region', { name: 'Domain' })).toHaveTextContent(
      'Hyphens · DigitsNo · Yes'
    )
    expect(within(dialog).getByRole('region', { name: 'Domain' })).toHaveTextContent(
      'AgeNot collected'
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('copies the domain and confirms with a toast', async () => {
    width = 1440
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderTriggers()
    fireEvent.click(screen.getByRole('button', { name: 'Details for garden-example.com' }))

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Copy domain' }))
    })
    expect(writeText).toHaveBeenCalledWith('garden-example.com')
    expect(toast.success).toHaveBeenCalledWith('Copied garden-example.com')

    writeText.mockRejectedValueOnce(new Error('blocked'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy domain' }))
    })
    expect(toast.error).toHaveBeenCalledWith('Copying is blocked in this browser.')
  })

  it('opens a drawer from a whole list item on phones, with Ahrefs "no rating"', async () => {
    width = 390
    renderTriggers()
    fireEvent.click(screen.getByRole('button', { name: 'Details for fresh2example.net' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-slot', 'drawer-popup')
    expect(dialog).toHaveTextContent('GoDaddy · Auction · ends in 2d 2h')
    cleanup()

    renderTriggersWithRating()
    fireEvent.click(screen.getByRole('button', { name: 'Details for fresh2example.net' }))
    expect(await screen.findByText('No rating')).toBeInTheDocument()
  })
})

function renderTriggersWithRating() {
  render(
    <ListingDetailsProvider now={now}>
      <ListingDetailsTrigger row={{ ...emptyRow, domainRatingFetched: true }} />
    </ListingDetailsProvider>
  )
}
