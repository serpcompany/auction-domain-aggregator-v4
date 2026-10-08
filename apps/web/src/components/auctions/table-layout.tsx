'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'

import { ColumnWidthsProvider, useColumnWidths } from '@/components/auctions/column-resize'
import {
  COLUMN_LAYOUT_COOKIE,
  COLUMNS_COOKIE,
  COLUMNS_COOKIE_MAX_AGE,
  type ColumnKey,
  type ColumnLayout,
  type ColumnWidths,
  DEFAULT_COLUMN_LAYOUT,
  DEFAULT_COLUMNS,
  serializeColumnLayout,
  serializeVisibleColumns
} from '@/domain/table-columns'

function saveCookie(name: string, value: string, maxAge = COLUMNS_COOKIE_MAX_AGE) {
  // biome-ignore lint/suspicious/noDocumentCookie: the server reads these cookies to render the chosen layout.
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`
}

type VisibleColumns = {
  columns: readonly ColumnKey[]
  update: (columns: readonly ColumnKey[]) => void
  toggle: (key: ColumnKey, shown: boolean) => void
  // Every column shown by default, in its default place, unpinned, and at its
  // default width.
  resetLayout: () => void
}

type ColumnOrder = {
  layout: ColumnLayout
  update: (layout: ColumnLayout) => void
}

const Visible = createContext<VisibleColumns | null>(null)
const Order = createContext<ColumnOrder | null>(null)

export function useVisibleColumns() {
  const context = useContext(Visible)
  if (!context) throw new Error('Visible columns need a TableLayoutProvider')
  return context
}

// The column order and pins, for the table's header menus.
export function useColumnLayout() {
  const context = useContext(Order)
  if (!context) throw new Error('Column layout needs a TableLayoutProvider')
  return context
}

function VisibleColumnsProvider({
  initialColumns,
  initialLayout,
  children
}: {
  initialColumns: readonly ColumnKey[]
  initialLayout: ColumnLayout
  children: ReactNode
}) {
  const { resetAll } = useColumnWidths()
  const [columns, setColumns] = useState(initialColumns)
  const [layout, setLayout] = useState(initialLayout)
  const update = (next: readonly ColumnKey[]) => {
    setColumns(next)
    saveCookie(COLUMNS_COOKIE, serializeVisibleColumns(next))
  }
  const toggle = (key: ColumnKey, shown: boolean) =>
    update(shown ? [...columns, key] : columns.filter(column => column !== key))
  const updateLayout = (next: ColumnLayout) => {
    setLayout(next)
    saveCookie(COLUMN_LAYOUT_COOKIE, serializeColumnLayout(next))
  }
  const resetLayout = () => {
    update(DEFAULT_COLUMNS)
    setLayout(DEFAULT_COLUMN_LAYOUT)
    saveCookie(COLUMN_LAYOUT_COOKIE, '', 0)
    resetAll()
  }
  return (
    <Visible.Provider value={{ columns, update, toggle, resetLayout }}>
      <Order.Provider value={{ layout, update: updateLayout }}>{children}</Order.Provider>
    </Visible.Provider>
  )
}

// The table layout a browser chose: which columns show, in what order, which
// are pinned, and how wide they are. The server renders it from the `columns`,
// `column-layout`, and `column-widths` cookies; a change updates this state
// and the cookie without a page request, so it costs no D1 read. The rows
// already carry every column's values, and the layout never enters the URL.
export function TableLayoutProvider({
  initialColumns,
  initialLayout = DEFAULT_COLUMN_LAYOUT,
  initialWidths,
  children
}: {
  initialColumns: readonly ColumnKey[]
  initialLayout?: ColumnLayout
  initialWidths: ColumnWidths
  children: ReactNode
}) {
  return (
    <ColumnWidthsProvider initialWidths={initialWidths}>
      <VisibleColumnsProvider initialColumns={initialColumns} initialLayout={initialLayout}>
        {children}
      </VisibleColumnsProvider>
    </ColumnWidthsProvider>
  )
}
