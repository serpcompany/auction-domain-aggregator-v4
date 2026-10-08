'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'

import { ColumnWidthsProvider, useColumnWidths } from '@/components/auctions/column-resize'
import {
  COLUMNS_COOKIE,
  COLUMNS_COOKIE_MAX_AGE,
  type ColumnKey,
  type ColumnWidths,
  DEFAULT_COLUMNS,
  serializeVisibleColumns
} from '@/domain/table-columns'

function saveColumns(columns: readonly ColumnKey[]) {
  // biome-ignore lint/suspicious/noDocumentCookie: the server reads this cookie to render the chosen columns.
  document.cookie = `${COLUMNS_COOKIE}=${serializeVisibleColumns(columns)}; path=/; max-age=${COLUMNS_COOKIE_MAX_AGE}; samesite=lax`
}

type VisibleColumns = {
  columns: readonly ColumnKey[]
  update: (columns: readonly ColumnKey[]) => void
  toggle: (key: ColumnKey, shown: boolean) => void
  // Every column shown by default, at its default width.
  resetLayout: () => void
}

const Visible = createContext<VisibleColumns | null>(null)

export function useVisibleColumns() {
  const context = useContext(Visible)
  if (!context) throw new Error('Visible columns need a TableLayoutProvider')
  return context
}

function VisibleColumnsProvider({
  initialColumns,
  children
}: {
  initialColumns: readonly ColumnKey[]
  children: ReactNode
}) {
  const { resetAll } = useColumnWidths()
  const [columns, setColumns] = useState(initialColumns)
  const update = (next: readonly ColumnKey[]) => {
    setColumns(next)
    saveColumns(next)
  }
  const toggle = (key: ColumnKey, shown: boolean) =>
    update(shown ? [...columns, key] : columns.filter(column => column !== key))
  const resetLayout = () => {
    update(DEFAULT_COLUMNS)
    resetAll()
  }
  return (
    <Visible.Provider value={{ columns, update, toggle, resetLayout }}>{children}</Visible.Provider>
  )
}

// The table layout a browser chose: which columns show and how wide they are.
// The server renders it from the `columns` and `column-widths` cookies; a
// change updates this state and the cookie without a page request, so it
// costs no D1 read. The rows already carry every column's values.
export function TableLayoutProvider({
  initialColumns,
  initialWidths,
  children
}: {
  initialColumns: readonly ColumnKey[]
  initialWidths: ColumnWidths
  children: ReactNode
}) {
  return (
    <ColumnWidthsProvider initialWidths={initialWidths}>
      <VisibleColumnsProvider initialColumns={initialColumns}>{children}</VisibleColumnsProvider>
    </ColumnWidthsProvider>
  )
}
