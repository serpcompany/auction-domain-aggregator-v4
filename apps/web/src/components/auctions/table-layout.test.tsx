import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ColumnResizeHandle } from '@/components/auctions/column-resize'
import { TableLayoutProvider, useVisibleColumns } from '@/components/auctions/table-layout'

beforeEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookies the layout writes.
  document.cookie = 'columns=; max-age=0; path=/'
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookies the layout writes.
  document.cookie = 'column-widths=; max-age=0; path=/'
})
afterEach(cleanup)

function cookie(name: string) {
  return document.cookie
    .split('; ')
    .find(entry => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function Probe() {
  const { columns, toggle, resetLayout } = useVisibleColumns()
  return (
    <>
      <output>{columns.join(',')}</output>
      <button type="button" onClick={() => toggle('renewal', true)}>
        Show renewal
      </button>
      <button type="button" onClick={() => toggle('price', false)}>
        Hide price
      </button>
      <button type="button" onClick={resetLayout}>
        Reset
      </button>
      <ColumnResizeHandle column="price" label="Price" />
    </>
  )
}

describe('TableLayoutProvider', () => {
  it('shows, hides, and resets columns and widths in the browser and its cookies', () => {
    render(
      <TableLayoutProvider initialColumns={['price']} initialWidths={{ price: 200 }}>
        <Probe />
      </TableLayoutProvider>
    )
    const handle = screen.getByRole('separator', { name: 'Resize Price column' })
    expect(handle).toHaveAttribute('aria-valuenow', '200')

    fireEvent.click(screen.getByRole('button', { name: 'Show renewal' }))
    expect(screen.getByRole('status')).toHaveTextContent('price,renewal')
    expect(cookie('columns')).toBe('price,renewal')
    fireEvent.click(screen.getByRole('button', { name: 'Hide price' }))
    expect(cookie('columns')).toBe('renewal')

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'source,type,price,bids,ends,age,links,appraisal,majesticTf,majesticCf,domainRating'
    )
    expect(handle).toHaveAttribute('aria-valuenow', '80')
    expect(cookie('column-widths')).toBe('')
  })

  it('needs the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('Visible columns need a TableLayoutProvider')
    consoleError.mockRestore()
  })
})
