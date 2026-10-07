import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ResultsPagination } from '@/components/auctions/results-pagination'
import { parseDomainTableFilters } from '@/domain/domain-table'

afterEach(cleanup)

const filters = parseDomainTableFilters({ tld: 'com', page: '3' })

describe('ResultsPagination', () => {
  it('links the first, previous, next, and last pages and keeps the filters', () => {
    render(<ResultsPagination filters={filters} page={3} total={857_412} />)

    expect(screen.getByText('Showing 101–150 of 857,412')).toBeInTheDocument()
    expect(screen.getByText('Page 3 of 17,149')).toBeInTheDocument()
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href')
    expect(href('Go to first page')).toBe('/?tld=com&sort=endsAt&direction=asc&page=1')
    expect(href('Go to previous page')).toBe('/?tld=com&sort=endsAt&direction=asc&page=2')
    expect(href('Go to next page')).toBe('/?tld=com&sort=endsAt&direction=asc&page=4')
    expect(href('Go to last page')).toBe('/?tld=com&sort=endsAt&direction=asc&page=17149')
  })

  it('disables the pages that do not exist', () => {
    render(<ResultsPagination filters={filters} page={1} total={0} />)

    expect(screen.getByText('Showing 0–0 of 0')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
    for (const name of [
      'Go to first page',
      'Go to previous page',
      'Go to next page',
      'Go to last page'
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })
})
