import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ColumnResizeHandle } from '@/components/auctions/column-resize'
import {
  TableLayoutProvider,
  useColumnLayout,
  useVisibleColumns
} from '@/components/auctions/table-layout'
import { parseColumnLayout, pinColumn } from '@/domain/table-columns'

beforeEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookies the layout writes.
  document.cookie = 'columns=; max-age=0; path=/'
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookies the layout writes.
  document.cookie = 'column-widths=; max-age=0; path=/'
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookies the layout writes.
  document.cookie = 'column-layout=; max-age=0; path=/'
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
  const { layout, update } = useColumnLayout()
  return (
    <>
      <output>{columns.join(',')}</output>
      <output aria-label="Pins">{JSON.stringify(layout.pins)}</output>
      <button type="button" onClick={() => update(pinColumn(layout, 'bids', 'right'))}>
        Pin bids
      </button>
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
      <TableLayoutProvider
        initialColumns={['price']}
        initialLayout={parseColumnLayout('order:bids|left:price')}
        initialWidths={{ price: 200 }}
      >
        <Probe />
      </TableLayoutProvider>
    )
    const handle = screen.getByRole('separator', { name: 'Resize Price column' })
    expect(handle).toHaveAttribute('aria-valuenow', '200')

    fireEvent.click(screen.getByRole('button', { name: 'Show renewal' }))
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('price,renewal')
    expect(cookie('columns')).toBe('price,renewal')
    fireEvent.click(screen.getByRole('button', { name: 'Hide price' }))
    expect(cookie('columns')).toBe('renewal')

    const pins = screen.getByRole('status', { name: 'Pins' })
    expect(pins).toHaveTextContent('{"price":"left"}')
    fireEvent.click(screen.getByRole('button', { name: 'Pin bids' }))
    expect(pins).toHaveTextContent('{"price":"left","bids":"right"}')
    expect(cookie('column-layout')).toMatch(/^order:bids,source,.*\|left:price\|right:bids$/)

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(pins).toHaveTextContent('{}')
    expect(cookie('column-layout')).toBeUndefined()
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'source,type,price,bids,ends,age,links,appraisal,majesticTf,majesticCf,domainRating'
    )
    expect(handle).toHaveAttribute('aria-valuenow', '80')
    expect(cookie('column-widths')).toBe('')
  })

  it('needs the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('Visible columns need a TableLayoutProvider')
    function LayoutProbe() {
      useColumnLayout()
      return null
    }
    expect(() => render(<LayoutProbe />)).toThrow('Column layout needs a TableLayoutProvider')
    consoleError.mockRestore()
  })
})
