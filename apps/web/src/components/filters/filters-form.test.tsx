import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { FiltersForm } from '@/components/filters/filters-form'
import { parseDomainTableFilters } from '@/domain/domain-table'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

afterEach(cleanup)
beforeEach(() => push.mockClear())
// jsdom has no PointerEvent; Base UI checkboxes create one on click.
beforeAll(() => {
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
})

function renderForm(params: Record<string, string | string[]> = {}) {
  return render(
    <FiltersForm
      filters={parseDomainTableFilters(params)}
      sources={['dynadot', 'godaddy']}
      auctionTypes={['auction', 'expired']}
      tlds={['co', 'com', 'net']}
    />
  )
}

const applied = { tld: 'com', noDigits: '1', bidsMin: '5', sort: 'price', direction: 'desc' }

describe('FiltersForm', () => {
  it('opens with the current filters filled in and counted per section', () => {
    renderForm(applied)

    expect(screen.getByLabelText('Min bids')).toHaveValue(5)
    expect(screen.getByRole('checkbox', { name: 'No digits' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'No hyphens' })).not.toBeChecked()
    expect(screen.getByText('.com')).toBeInTheDocument()
    expect(screen.getByText('3 filters set')).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Filter sections' })
    expect(within(nav).getByRole('link', { name: 'General 1' })).toHaveAttribute(
      'href',
      '#filters-general'
    )
    expect(within(nav).getByRole('link', { name: 'Auction' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Name 1' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Jump to a section' })).getByRole('link', {
        name: 'Activity and value · 1'
      })
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Name/ })).toBeInTheDocument()
  })

  it('shows money filters in dollars', () => {
    renderForm({ priceMax: '50', appraisalMin: '100.5' })

    expect(screen.getByLabelText('Maximum current bid')).toHaveValue(50)
    expect(screen.getByLabelText('Min provider appraisal')).toHaveValue(100.5)
  })

  it('applies the draft as a canonical URL on page 1, keeping the sort', async () => {
    renderForm({ ...applied, page: '4' })

    fireEvent.change(screen.getByLabelText('Domain contains'), { target: { value: 'Garden' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'GoDaddy' }))
    fireEvent.click(screen.getByRole('button', { name: '24 hours' }))
    fireEvent.change(screen.getByLabelText('Maximum current bid'), { target: { value: '50' } })
    await waitFor(() => expect(screen.getByText('7 filters set')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Show results' }))
    expect(push).toHaveBeenCalledWith(
      '/?q=garden&source=godaddy&tld=com&noDigits=1&priceMax=50&bidsMin=5&endingWithin=24h&sort=price&direction=desc&page=1'
    )
  })

  it('returns Ends within to any time', async () => {
    renderForm({ endingWithin: '6h' })
    expect(screen.getByText('1 filter set')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '6 hours' }))
    await waitFor(() => expect(screen.getByText('0 filters set')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Any time' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show results' }))
    expect(push).toHaveBeenCalledWith('/?sort=endsAt&direction=asc&page=1')
  })

  it('blocks a reversed range until it is fixed', async () => {
    renderForm()

    fireEvent.input(screen.getByLabelText('Minimum length (characters)'), {
      target: { value: '14' }
    })
    fireEvent.input(screen.getByLabelText('Maximum length (characters)'), {
      target: { value: '8' }
    })

    await waitFor(() =>
      expect(
        screen.getByText(
          'Minimum domain length cannot exceed maximum domain length. Lower the minimum or raise the maximum.'
        )
      ).toBeInTheDocument()
    )
    expect(screen.getByText('Fix the domain length range to apply')).toBeInTheDocument()
    expect(screen.getByLabelText('Minimum length (characters)')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Show results' })).toBeDisabled()

    fireEvent.submit(screen.getByRole('form', { name: 'All filters' }))
    expect(push).not.toHaveBeenCalled()

    fireEvent.input(screen.getByLabelText('Maximum length (characters)'), {
      target: { value: '20' }
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show results' })).toBeEnabled())
  })

  it('also refuses a reversed range submitted before the form re-reads it', () => {
    renderForm()
    const minimum = screen.getByLabelText('Minimum age (years)') as HTMLInputElement
    const maximum = screen.getByLabelText('Maximum age (years)') as HTMLInputElement
    minimum.value = '9'
    maximum.value = '2'

    fireEvent.submit(screen.getByRole('form', { name: 'All filters' }))
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByText('Fix the domain age range to apply')).toBeInTheDocument()
  })

  it('picks TLDs from the facet list and keeps an applied TLD the facets no longer offer', async () => {
    renderForm({ tld: 'org', noHyphens: '1' })
    expect(screen.getByText('org')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'No hyphens' })).toBeChecked()

    const input = screen.getByRole('combobox', { name: 'TLD' })
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: '.net' }))
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() =>
      expect(
        [...document.querySelectorAll<HTMLInputElement>('input[name="tld"]')].map(
          input => input.value
        )
      ).toEqual(['org', 'net'])
    )
  })

  it('cancels back to the unchanged results and resets to an empty draft', () => {
    renderForm({ ...applied, page: '2' })

    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '/?tld=com&noDigits=1&bidsMin=5&sort=price&direction=desc&page=2'
    )
    // Next's Link adds the trailing slash only when the app's trailingSlash config is loaded.
    expect(screen.getByRole('link', { name: 'Reset all' }).getAttribute('href')).toMatch(
      /^\/filters\/?\?sort=price&direction=desc$/
    )
  })
})
