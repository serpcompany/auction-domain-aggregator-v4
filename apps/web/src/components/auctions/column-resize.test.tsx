import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ColumnResizeHandle, ColumnWidthsProvider } from '@/components/auctions/column-resize'
import type { ColumnWidths } from '@/domain/table-columns'

beforeAll(() => {
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
})
beforeEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie the handles write.
  document.cookie = 'column-widths=; max-age=0; path=/'
})
afterEach(cleanup)

function renderHandles(initialWidths: ColumnWidths = {}) {
  render(
    <ColumnWidthsProvider initialWidths={initialWidths}>
      <ColumnResizeHandle column="price" label="Price" />
      <ColumnResizeHandle column="domain" label="Domain" />
    </ColumnWidthsProvider>
  )
  const handle = screen.getByRole('separator', { name: 'Resize Price column' })
  return {
    handle,
    // The width the table's `<col>` reads, as the provider sets it.
    variable: () => handle.parentElement?.style.getPropertyValue('--column-price-width'),
    saved: () =>
      document.cookie
        .split('; ')
        .find(cookie => cookie.startsWith('column-widths='))
        ?.slice('column-widths='.length)
  }
}

describe('column resizing', () => {
  it('drags a column wider and saves the width when the drag ends', () => {
    const { handle, variable, saved } = renderHandles()
    expect(handle).toHaveAttribute('aria-valuenow', '80')
    expect(handle).toHaveAttribute('aria-valuetext', '80 pixels, the default')
    expect(variable()).toBe('')

    fireEvent.pointerDown(handle, { button: 0, clientX: 100 })
    fireEvent.pointerMove(window, { clientX: 150 })
    expect(handle).toHaveAttribute('aria-valuenow', '130')
    expect(variable()).toBe('130px')
    expect(saved()).toBeUndefined()

    fireEvent.pointerUp(window)
    expect(saved()).toBe('price:130')
    fireEvent.pointerMove(window, { clientX: 400 })
    expect(handle).toHaveAttribute('aria-valuenow', '130')
  })

  it('keeps a drag within the allowed widths and ends it when the pointer is lost', () => {
    const { handle, saved } = renderHandles()
    fireEvent.pointerDown(handle, { button: 0, clientX: 100 })
    fireEvent.pointerMove(window, { clientX: -500 })
    fireEvent.pointerCancel(window)
    expect(handle).toHaveAttribute('aria-valuenow', '48')
    expect(saved()).toBe('price:48')
  })

  it('ignores buttons other than the primary one', () => {
    const { handle, saved } = renderHandles()
    fireEvent.pointerDown(handle, { button: 2, clientX: 100 })
    fireEvent.pointerMove(window, { clientX: 300 })
    expect(handle).toHaveAttribute('aria-valuenow', '80')
    expect(saved()).toBeUndefined()
  })

  it('resizes from the keyboard and restores the default with Enter', () => {
    const { handle, saved } = renderHandles({ domain: 300 })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle).toHaveAttribute('aria-valuenow', '96')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle).toHaveAttribute('aria-valuenow', '64')
    fireEvent.keyDown(handle, { key: 'End' })
    expect(handle).toHaveAttribute('aria-valuenow', '640')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(handle).toHaveAttribute('aria-valuenow', '48')
    expect(saved()).toBe('domain:300,price:48')
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(handle).toHaveAttribute('aria-valuetext', '80 pixels, the default')
    expect(saved()).toBe('domain:300')
    // Other keys keep their default behavior.
    expect(fireEvent.keyDown(handle, { key: 'Tab' })).toBe(true)
  })

  it('restores the default width on double-click and keeps the other columns', () => {
    const { handle, variable, saved } = renderHandles({ price: 200, domain: 300 })
    expect(variable()).toBe('200px')
    fireEvent.doubleClick(handle)
    expect(handle).toHaveAttribute('aria-valuenow', '80')
    expect(variable()).toBe('')
    expect(saved()).toBe('domain:300')
    expect(screen.getByRole('separator', { name: 'Resize Domain column' })).toHaveAttribute(
      'aria-valuenow',
      '300'
    )
  })

  it('needs the widths provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ColumnResizeHandle column="price" label="Price" />)).toThrow(
      'ColumnResizeHandle needs a ColumnWidthsProvider'
    )
    consoleError.mockRestore()
  })
})
