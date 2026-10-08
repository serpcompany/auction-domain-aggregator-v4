import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SaveViewButton, ViewsMenu } from '@/components/auctions/saved-views'
import { TableLayoutProvider, useVisibleColumns } from '@/components/auctions/table-layout'
import { parseDomainTableFilters } from '@/domain/domain-table'
import { SAVED_VIEWS_KEY, SAVED_VIEWS_LIMIT, type SavedView } from '@/domain/saved-views'
import { parseColumnLayout } from '@/domain/table-columns'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

beforeAll(() => {
  globalThis.PointerEvent ??= MouseEvent as typeof PointerEvent
})
beforeEach(() => {
  toast.success.mockClear()
  toast.error.mockClear()
  for (const name of ['columns', 'column-widths', 'column-layout']) {
    // biome-ignore lint/suspicious/noDocumentCookie: clears the cookies a view writes.
    document.cookie = `${name}=; max-age=0; path=/`
  }
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

const filters = (params: Record<string, string> = {}) =>
  parseDomainTableFilters({ sort: 'price', direction: 'desc', ...params })

const stored = () => JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? '[]') as SavedView[]

function cookie(name: string) {
  return document.cookie
    .split('; ')
    .find(entry => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function ShownColumns() {
  return <output aria-label="Shown columns">{useVisibleColumns().columns.join(',')}</output>
}

function renderWithLayout(ui: React.ReactNode) {
  return render(
    <TableLayoutProvider
      initialColumns={['price', 'bids']}
      initialLayout={parseColumnLayout('left:price')}
      initialWidths={{ price: 150 }}
    >
      {ui}
      <ShownColumns />
    </TableLayoutProvider>
  )
}

async function openSave(name = 'Save') {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.findByRole('textbox', { name: 'Name' })
}

describe('SaveViewButton', () => {
  it('saves the search, rules, sort, and layout under the suggested name on Enter', async () => {
    renderWithLayout(<SaveViewButton filters={filters({ majesticTfMin: '25', page: '3' })} />)
    const name = await openSave()
    expect(name).toHaveAttribute('placeholder', 'Majestic TF ≥ 25')
    expect(name).toHaveFocus()

    fireEvent.submit(name)
    expect(stored()).toEqual([
      {
        name: 'Majestic TF ≥ 25',
        query: 'majesticTfMin=25&sort=price&direction=desc&page=1',
        columns: 'price,bids',
        layout: expect.stringMatching(/\|left:price$/),
        widths: 'price:150'
      }
    ])
    expect(toast.success).toHaveBeenCalledWith('Saved view “Majestic TF ≥ 25”')
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
  })

  it('replaces a view saved under the same name', async () => {
    renderWithLayout(<SaveViewButton filters={filters({ tld: 'net' })} />)
    localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([{ name: 'Nets', query: 'q', columns: '', layout: '', widths: '' }])
    )
    const name = await openSave()
    fireEvent.change(name, { target: { value: '  nets ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }))
    expect(stored()).toHaveLength(1)
    expect(stored()[0]).toMatchObject({
      name: 'nets',
      query: 'tld=net&sort=price&direction=desc&page=1'
    })
    expect(toast.success).toHaveBeenCalledWith('Replaced view “nets”')
  })

  it('says so at the limit and keeps the popover open', async () => {
    const full = Array.from({ length: SAVED_VIEWS_LIMIT }, (_, index) => ({
      name: `View ${index}`,
      query: '',
      columns: '',
      layout: '',
      widths: ''
    }))
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(full))
    renderWithLayout(<SaveViewButton filters={filters()} compact />)
    const name = await openSave('Save view')
    expect(screen.getByText(/at most 50 views/)).toHaveAttribute('role', 'status')

    fireEvent.submit(name)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('at most 50 views'))
    expect(stored()).toHaveLength(SAVED_VIEWS_LIMIT)
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
  })

  it('reports storage that refuses the write', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    renderWithLayout(<SaveViewButton filters={filters()} />)
    fireEvent.submit(await openSave())
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('refused to store'))
  })
})

describe('ViewsMenu', () => {
  const view = (name: string, query: string): SavedView => ({
    name,
    query,
    columns: 'price,renewal',
    layout: 'order:renewal,price|right:renewal',
    widths: 'renewal:200'
  })

  async function openViews(name = 'Views') {
    fireEvent.click(screen.getByRole('button', { name }))
    return screen.findByRole('menu')
  }

  it('says when there are no views yet', async () => {
    renderWithLayout(<ViewsMenu filters={filters()} onNavigate={vi.fn()} />)
    const menu = await openViews()
    expect(menu).toHaveTextContent('None yet.')
  })

  it('opens a view: its URL and its layout, in state and cookies', async () => {
    localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([view('Cheap nets', 'tld=net&priceMax=20&sort=price&direction=asc&page=1')])
    )
    const onNavigate = vi.fn()
    renderWithLayout(<ViewsMenu filters={filters()} onNavigate={onNavigate} />)
    const menu = await openViews()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Cheap nets' }))
    expect(onNavigate).toHaveBeenCalledWith('/?tld=net&priceMax=20&sort=price&direction=asc&page=1')
    expect(screen.getByRole('status', { name: 'Shown columns' })).toHaveTextContent('price,renewal')
    expect(cookie('columns')).toBe('price,renewal')
    expect(cookie('column-layout')).toMatch(/^order:renewal,price,.*\|right:renewal$/)
    expect(cookie('column-widths')).toBe('renewal:200')
    expect(toast.success).toHaveBeenCalledWith('Opened view “Cheap nets”')
  })

  it('applies only the layout when the view is the current URL', async () => {
    localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([view('Here', 'sort=price&direction=desc&page=1')])
    )
    const onNavigate = vi.fn()
    renderWithLayout(<ViewsMenu filters={filters()} onNavigate={onNavigate} compact />)
    fireEvent.click(within(await openViews()).getByRole('menuitem', { name: 'Here' }))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(cookie('columns')).toBe('price,renewal')
  })

  it('deletes a view with its ×, keeping the menu open', async () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([view('A', ''), view('B', '')]))
    renderWithLayout(<ViewsMenu filters={filters()} onNavigate={vi.fn()} />)
    const menu = await openViews()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete view A' }))
    expect(stored().map(saved => saved.name)).toEqual(['B'])
    expect(toast.success).toHaveBeenCalledWith('Deleted view “A”')
    expect(within(menu).queryByRole('menuitem', { name: 'A' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'B' })).toBeInTheDocument()
  })

  it('reports storage that refuses the delete', async () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([view('A', '')]))
    renderWithLayout(<ViewsMenu filters={filters()} onNavigate={vi.fn()} />)
    const menu = await openViews()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete view A' }))
    expect(toast.error).toHaveBeenCalledWith('This browser refused to delete the view.')
  })

  it('shows views saved in another tab', async () => {
    renderWithLayout(<ViewsMenu filters={filters()} onNavigate={vi.fn()} />)
    const menu = await openViews()
    act(() => {
      localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([view('Elsewhere', '')]))
      window.dispatchEvent(new StorageEvent('storage', { key: SAVED_VIEWS_KEY }))
    })
    expect(within(menu).getByRole('menuitem', { name: 'Elsewhere' })).toBeInTheDocument()
  })
})
