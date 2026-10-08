import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ColumnsMenu, FieldsDrawer } from '@/components/auctions/columns-menu'
import { TableLayoutProvider } from '@/components/auctions/table-layout'
import { type ColumnKey, type ColumnWidths, DEFAULT_COLUMNS } from '@/domain/table-columns'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

beforeAll(() => {
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
})
beforeEach(() => {
  refresh.mockClear()
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie the menu writes.
  document.cookie = 'columns=; max-age=0; path=/'
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie Reset layout writes.
  document.cookie = 'column-widths=; max-age=0; path=/'
})
afterEach(cleanup)

function renderWithLayout(
  ui: React.ReactNode,
  columns: readonly ColumnKey[] = DEFAULT_COLUMNS,
  widths: ColumnWidths = {}
) {
  return render(
    <TableLayoutProvider initialColumns={columns} initialWidths={widths}>
      {ui}
    </TableLayoutProvider>
  )
}

function cookie(name: string) {
  return document.cookie
    .split('; ')
    .find(entry => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /^Columns/ }))
  return screen.findByRole('menu')
}

describe('ColumnsMenu', () => {
  it('lists every column, Domain always on, with the optional ones marked', async () => {
    renderWithLayout(<ColumnsMenu />)
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
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Authority Score Semrush' })
    ).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Domain Rating Ahrefs' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('saves a change in the cookie the server reads, without a refresh', async () => {
    renderWithLayout(<ColumnsMenu />)
    await openMenu()

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Renewal Off by default' }))
    expect(cookie('columns')).toBe(
      'source,type,price,bids,ends,age,links,appraisal,renewal,majesticTf,majesticCf,domainRating'
    )
    expect(screen.getByRole('button', { name: /Columns/ })).toHaveTextContent('Custom')

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Price' }))
    expect(cookie('columns')).toBe(
      'source,type,bids,ends,age,links,appraisal,renewal,majesticTf,majesticCf,domainRating'
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it('resets the layout: default columns at default widths', async () => {
    renderWithLayout(<ColumnsMenu />, ['price'], { price: 200 })
    expect(screen.getByRole('button', { name: /Columns/ })).toHaveTextContent('Custom')
    await openMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset layout' }))
    expect(cookie('columns')).toBe(DEFAULT_COLUMNS.join(','))
    expect(cookie('column-widths')).toBe('')
    expect(screen.getByRole('button', { name: /Columns/ })).not.toHaveTextContent('Custom')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('lets phones choose the metrics under each listing', async () => {
    renderWithLayout(<FieldsDrawer />)
    fireEvent.click(screen.getByRole('button', { name: 'Fields shown' }))

    const drawer = await screen.findByRole('dialog')
    expect(drawer).toHaveTextContent('Price, source, bids, and end time always show.')
    expect(screen.queryByRole('checkbox', { name: 'Price' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Domain Rating/ })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Visitors' }))
    expect(cookie('columns')).toBe(
      'source,type,price,bids,ends,age,links,appraisal,visitors,majesticTf,majesticCf,domainRating'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(cookie('columns')).toBe(DEFAULT_COLUMNS.join(','))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('needs the layout provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ColumnsMenu />)).toThrow('Visible columns need a TableLayoutProvider')
    consoleError.mockRestore()
  })
})
