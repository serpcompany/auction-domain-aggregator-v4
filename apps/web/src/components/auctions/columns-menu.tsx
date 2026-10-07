'use client'

import { Columns3Icon, RotateCcwIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from '@/components/ui/drawer'
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
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
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

// The chosen columns, saved in the cookie the page reads, then re-rendered.
export function useVisibleColumns(visibleColumns: ColumnKey[]) {
  const router = useRouter()
  const [columns, setColumns] = useState(visibleColumns)
  const update = (next: ColumnKey[]) => {
    setColumns(next)
    saveColumns(next)
    router.refresh()
  }
  const toggle = (key: ColumnKey, checked: boolean) =>
    update(checked ? [...columns, key] : columns.filter(column => column !== key))
  return { columns, update, toggle }
}

export function ColumnsMenu({ visibleColumns }: { visibleColumns: ColumnKey[] }) {
  const { columns, update, toggle } = useVisibleColumns(visibleColumns)
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

// Phones: the same choice, picking the metrics shown under each listing.
export function FieldsDrawer({ visibleColumns }: { visibleColumns: ColumnKey[] }) {
  const { columns, update, toggle } = useVisibleColumns(visibleColumns)
  const field = (column: TableColumn) => (
    <Field key={column.key} orientation="horizontal">
      <Checkbox
        id={`field-${column.key}`}
        checked={columns.includes(column.key)}
        onCheckedChange={checked => toggle(column.key, checked)}
      />
      <FieldLabel htmlFor={`field-${column.key}`} className="font-normal">
        {'menuLabel' in column ? column.menuLabel : column.label}
        {columnGroup(column) ? (
          <span className="ml-auto text-xs text-muted-foreground">{columnGroup(column)}</span>
        ) : null}
      </FieldLabel>
    </Field>
  )
  // Source, type, price, bids, and the end time always show in a listing.
  const optional = TABLE_COLUMNS.filter(
    column => !['source', 'type', 'price', 'bids', 'ends'].includes(column.key)
  )

  return (
    <Drawer>
      <DrawerTrigger render={<Button variant="outline" size="icon-sm" aria-label="Fields shown" />}>
        <Columns3Icon aria-hidden="true" />
      </DrawerTrigger>
      <DrawerContent className="max-h-[85svh]">
        <DrawerHeader>
          <DrawerTitle>Fields shown</DrawerTitle>
          <DrawerDescription>
            Choose the metrics under each listing. Price, source, bids, and end time always show.
          </DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-5 overflow-y-auto px-4">
          <FieldSet>
            <FieldLegend variant="label">Listing</FieldLegend>
            <FieldGroup className="gap-3">
              {optional.filter(column => !columnGroup(column)).map(field)}
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">SEO metrics</FieldLegend>
            <FieldGroup className="gap-3">
              {optional.filter(column => columnGroup(column)).map(field)}
            </FieldGroup>
          </FieldSet>
        </div>
        <DrawerFooter>
          <DrawerClose render={<Button />}>Done</DrawerClose>
          <Button variant="ghost" onClick={() => update(DEFAULT_COLUMNS)}>
            Reset to default
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
