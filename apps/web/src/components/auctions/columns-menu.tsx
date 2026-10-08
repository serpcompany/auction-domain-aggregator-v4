'use client'

import { Columns3Icon, RotateCcwIcon } from 'lucide-react'

import { useColumnLayout, useVisibleColumns } from '@/components/auctions/table-layout'
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
  columnGroup,
  DEFAULT_COLUMNS,
  isDefaultColumnLayout,
  isDefaultColumnSet,
  TABLE_COLUMNS,
  type TableColumn
} from '@/domain/table-columns'

// A checkbox per column, Domain always on: the Columns menu and each header's
// Columns submenu.
export function ColumnCheckboxItems() {
  const { columns, toggle } = useVisibleColumns()
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
    <>
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
    </>
  )
}

// The toolbar's Columns menu, one button for keyboards and narrow windows;
// every header has the same checkboxes in its menu.
export function ColumnsMenu() {
  const { columns, resetLayout } = useVisibleColumns()
  const { layout } = useColumnLayout()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3Icon aria-hidden="true" />
        Columns
        {isDefaultColumnSet(columns) && isDefaultColumnLayout(layout) ? null : (
          <Badge variant="secondary" className="rounded-sm px-1 font-normal">
            Custom
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <ColumnCheckboxItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={resetLayout}>
          <RotateCcwIcon aria-hidden="true" />
          Reset layout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Phones: the same choice, picking the metrics shown under each listing.
export function FieldsDrawer() {
  const { columns, update, toggle } = useVisibleColumns()
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
