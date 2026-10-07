import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ColumnsMenu } from '@/components/auctions/columns-menu'
import { DEFAULT_COLUMNS } from '@/domain/table-columns'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

beforeAll(() => {
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
})
beforeEach(() => {
  refresh.mockClear()
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie the menu writes.
  document.cookie = 'columns=; max-age=0; path=/'
})
afterEach(cleanup)

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /^Columns/ }))
  return screen.findByRole('menu')
}

describe('ColumnsMenu', () => {
  it('lists every column, Domain always on, with the optional ones marked', async () => {
    render(<ColumnsMenu visibleColumns={DEFAULT_COLUMNS} />)
    expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument()
    await openMenu()

    const domain = screen.getByRole('menuitemcheckbox', { name: 'Domain Always shown' })
    expect(domain).toHaveAttribute('aria-checked', 'true')
    expect(domain).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Price' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Renewal Off by default' })
    ).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Domain Rating Ahrefs' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('saves a change in the cookie the server reads and refreshes the table', async () => {
    render(<ColumnsMenu visibleColumns={DEFAULT_COLUMNS} />)
    await openMenu()

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Renewal Off by default' }))
    expect(document.cookie).toContain(
      'columns=source,price,bids,ends,age,links,appraisal,renewal,majesticTf,majesticCf,semrushAs,domainRating'
    )
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Columns/ })).toHaveTextContent('Custom')

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Price' }))
    expect(document.cookie).toContain(
      'columns=source,bids,ends,age,links,appraisal,renewal,majesticTf,majesticCf,semrushAs,domainRating'
    )
  })

  it('resets to the default columns', async () => {
    render(<ColumnsMenu visibleColumns={['price']} />)
    expect(screen.getByRole('button', { name: /Columns/ })).toHaveTextContent('Custom')
    await openMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset to default' }))
    expect(document.cookie).toContain(`columns=${DEFAULT_COLUMNS.join(',')}`)
    expect(refresh).toHaveBeenCalled()
  })
})
