import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ActiveFilters } from '@/components/auctions/active-filters'
import { parseDomainTableFilters } from '@/domain/domain-table'

afterEach(cleanup)

describe('ActiveFilters', () => {
  it('lists each applied filter once as a removable chip, with Clear all and Edit', () => {
    render(
      <ActiveFilters
        filters={parseDomainTableFilters({
          tld: ['com', 'co'],
          bidsMin: '5',
          sort: 'price',
          direction: 'desc'
        })}
      />
    )

    expect(screen.getByRole('link', { name: 'Remove TLD: .com, .co filter' })).toHaveAttribute(
      'href',
      '/?bidsMin=5&sort=price&direction=desc&page=1'
    )
    expect(screen.getByRole('link', { name: 'Remove Bids: 5+ filter' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clear all' })).toHaveAttribute(
      'href',
      '/?sort=price&direction=desc&page=1'
    )
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/filters/?tld=com&tld=co&bidsMin=5&sort=price&direction=desc&page=1'
    )
  })

  it('renders nothing without filters', () => {
    const { container } = render(<ActiveFilters filters={parseDomainTableFilters({})} />)
    expect(container).toBeEmptyDOMElement()
  })
})
