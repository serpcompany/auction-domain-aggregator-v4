import type { DomainTableSort } from '@/domain/domain-table'

// The one registry of table columns. The table, the Columns menu, and the
// cookie that stores the choice all read it; Domain is always shown and is
// not part of it. Every column can be sorted.
export const TABLE_COLUMNS = [
  { key: 'source', label: 'Source', sort: 'source', width: 104, defaultVisible: true },
  { key: 'type', label: 'Type', sort: 'type', width: 80, defaultVisible: true },
  { key: 'price', label: 'Price', sort: 'price', numeric: true, width: 80, defaultVisible: true },
  { key: 'bids', label: 'Bids', sort: 'bids', numeric: true, width: 64, defaultVisible: true },
  { key: 'ends', label: 'Ends', sort: 'endsAt', width: 192, defaultVisible: true },
  { key: 'age', label: 'Age', sort: 'age', numeric: true, width: 64, defaultVisible: true },
  {
    key: 'links',
    label: 'Links',
    menuLabel: 'Inbound links',
    sort: 'links',
    numeric: true,
    width: 72,
    defaultVisible: true
  },
  {
    key: 'appraisal',
    label: 'Appraisal',
    sort: 'appraisal',
    numeric: true,
    width: 104,
    defaultVisible: true
  },
  {
    key: 'renewal',
    label: 'Renewal',
    sort: 'renewal',
    numeric: true,
    width: 88,
    defaultVisible: false
  },
  {
    key: 'visitors',
    label: 'Visitors',
    sort: 'visitors',
    numeric: true,
    width: 88,
    defaultVisible: false
  },
  {
    key: 'length',
    label: 'Length',
    sort: 'domainLength',
    numeric: true,
    width: 72,
    defaultVisible: false
  },
  {
    key: 'majesticTf',
    label: 'TF',
    menuLabel: 'Trust Flow',
    sort: 'majesticTf',
    group: 'Majestic',
    numeric: true,
    width: 56,
    defaultVisible: true
  },
  {
    key: 'majesticCf',
    label: 'CF',
    menuLabel: 'Citation Flow',
    sort: 'majesticCf',
    group: 'Majestic',
    numeric: true,
    width: 56,
    defaultVisible: true
  },
  {
    key: 'majesticRefDomains',
    label: 'Ref. dom.',
    menuLabel: 'Referring domains',
    sort: 'majesticRefDomains',
    group: 'Majestic',
    numeric: true,
    width: 88,
    defaultVisible: false
  },
  {
    key: 'semrushAs',
    label: 'AS',
    menuLabel: 'Authority Score',
    sort: 'semrushAs',
    group: 'Semrush',
    numeric: true,
    width: 72,
    defaultVisible: true
  },
  {
    key: 'domainRating',
    label: 'DR',
    menuLabel: 'Domain Rating',
    sort: 'domainRating',
    group: 'Ahrefs',
    numeric: true,
    width: 104,
    defaultVisible: true
  }
] as const satisfies ReadonlyArray<{
  key: string
  label: string
  menuLabel?: string
  sort: DomainTableSort
  group?: 'Majestic' | 'Semrush' | 'Ahrefs'
  numeric?: boolean
  // The default width in CSS pixels, before a person resizes the column.
  width: number
  defaultVisible: boolean
}>

export type TableColumn = (typeof TABLE_COLUMNS)[number]
export type ColumnKey = TableColumn['key']
export type ColumnGroup = 'Majestic' | 'Semrush' | 'Ahrefs'

export const COLUMNS_COOKIE = 'columns'
export const COLUMNS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export const DEFAULT_COLUMNS: ColumnKey[] = TABLE_COLUMNS.filter(
  column => column.defaultVisible
).map(column => column.key)

// The cookie holds comma-separated keys. Without one, the defaults show; an
// empty value means every optional column is hidden. Unknown keys are
// ignored and the registry order wins.
export function parseVisibleColumns(cookie: string | undefined): ColumnKey[] {
  if (cookie === undefined) return DEFAULT_COLUMNS
  const requested = new Set(cookie.split(','))
  return TABLE_COLUMNS.filter(column => requested.has(column.key)).map(column => column.key)
}

export function serializeVisibleColumns(columns: readonly ColumnKey[]) {
  return TABLE_COLUMNS.filter(column => columns.includes(column.key))
    .map(column => column.key)
    .join(',')
}

export function isDefaultColumnSet(columns: readonly ColumnKey[]) {
  return serializeVisibleColumns(columns) === DEFAULT_COLUMNS.join(',')
}

export function columnGroup(column: TableColumn): ColumnGroup | undefined {
  return 'group' in column ? column.group : undefined
}

// Column widths. Domain and every registry column can be resized; a chosen
// width is saved per browser in the `column-widths` cookie, which the server
// reads like `columns`, so the table renders at those widths.
export type ResizableColumnKey = 'domain' | ColumnKey
export type ColumnWidths = Partial<Record<ResizableColumnKey, number>>

export const COLUMN_WIDTHS_COOKIE = 'column-widths'
export const MIN_COLUMN_WIDTH = 48
export const MAX_COLUMN_WIDTH = 640

const DEFAULT_COLUMN_WIDTHS = Object.fromEntries([
  ['domain', 240],
  ...TABLE_COLUMNS.map(column => [column.key, column.width])
]) as Record<ResizableColumnKey, number>

export function defaultColumnWidth(key: ResizableColumnKey) {
  return DEFAULT_COLUMN_WIDTHS[key]
}

export function clampColumnWidth(width: number) {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)))
}

export function columnWidth(widths: ColumnWidths, key: ResizableColumnKey) {
  return widths[key] ?? DEFAULT_COLUMN_WIDTHS[key]
}

export function columnWidthVariable(key: ResizableColumnKey) {
  return `--column-${key}-width`
}

// A column's CSS width: the chosen width, which the table sets as a variable,
// or else the default.
export function columnWidthCss(key: ResizableColumnKey) {
  return `var(${columnWidthVariable(key)}, ${DEFAULT_COLUMN_WIDTHS[key]}px)`
}

// The cookie holds comma-separated `key:width` pairs. Unknown keys and
// non-integer widths are ignored, and widths are clamped to the allowed range.
export function parseColumnWidths(cookie: string | undefined): ColumnWidths {
  const widths: ColumnWidths = {}
  for (const entry of cookie?.split(',') ?? []) {
    const [key, value] = entry.split(':')
    const width = Number(value)
    if (Object.hasOwn(DEFAULT_COLUMN_WIDTHS, key) && Number.isInteger(width)) {
      widths[key as ResizableColumnKey] = clampColumnWidth(width)
    }
  }
  return widths
}

export function serializeColumnWidths(widths: ColumnWidths) {
  return Object.entries(widths)
    .map(([key, width]) => `${key}:${width}`)
    .join(',')
}
