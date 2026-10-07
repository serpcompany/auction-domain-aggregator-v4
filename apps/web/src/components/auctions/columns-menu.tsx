'use client'

import { Columns3Icon, RotateCcwIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  COLUMNS_COOKIE,
  COLUMNS_COOKIE_MAX_AGE,
  type ColumnKey,
  columnGroup,
  DEFAULT_COLUMNS,
  isDefaultColumnSet,
  serializeVisibleColumns,
  TABLE_COLUMNS,
  type TableColumn
} from '@/domain/table-columns'

function saveColumns(columns: ColumnKey[]) {
  // biome-ignore lint/suspicious/noDocumentCookie: the server reads this cookie to render the chosen columns.
  document.cookie = `${COLUMNS_COOKIE}=${serializeVisibleColumns(columns)}; path=/; max-age=${COLUMNS_COOKIE_MAX_AGE}; samesite=lax`
}

export function ColumnsMenu({ visibleColumns }: { visibleColumns: ColumnKey[] }) {
  const router = useRouter()
  const [columns, setColumns] = useState(visibleColumns)

  const update = (next: ColumnKey[]) => {
    setColumns(next)
    saveColumns(next)
    router.refresh()
  }
  const toggle = (key: ColumnKey, checked: boolean) =>
    update(checked ? [...columns, key] : columns.filter(column => column !== key))
  const item = (column: TableColumn) => (
    <DropdownMenuCheckboxItem
      key={column.key}
      checked={columns.includes(column.key)}
      onCheckedChange={checked => toggle(column.key, checked)}
      closeOnClick={false}
    >
      {'menuLabel' in column ? column.menuLabel : column.label}
      {columnGroup(column) ? (
        <DropdownMenuShortcut>{columnGroup(column)}</DropdownMenuShortcut>
      ) : column.defaultVisible ? null : (
        <DropdownMenuShortcut>Off by default</DropdownMenuShortcut>
      )}
    </DropdownMenuCheckboxItem>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3Icon aria-hidden="true" />
        Columns
        {isDefaultColumnSet(columns) ? null : (
          <Badge variant="secondary" className="rounded-sm px-1 font-normal">
            Custom
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Listing</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked disabled>
            Domain
            <DropdownMenuShortcut>Always shown</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          {TABLE_COLUMNS.filter(column => !columnGroup(column)).map(item)}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>SEO metrics</DropdownMenuLabel>
          {TABLE_COLUMNS.filter(column => columnGroup(column)).map(item)}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => update(DEFAULT_COLUMNS)}>
          <RotateCcwIcon aria-hidden="true" />
          Reset to default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
