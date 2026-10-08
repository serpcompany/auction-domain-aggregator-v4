import type { DomainTableSort } from '@/domain/domain-table'

// The one registry of table columns. The table, the Columns menu, and the
// cookie that stores the choice all read it; Domain is always shown and is
// not part of it. Every column can be sorted.
export const TABLE_COLUMNS = [
  { key: 'source', label: 'Source', sort: 'source', width: 112, defaultVisible: true },
  { key: 'type', label: 'Type', sort: 'type', width: 80, defaultVisible: true },
  { key: 'price', label: 'Price', sort: 'price', numeric: true, width: 80, defaultVisible: true },
  { key: 'bids', label: 'Bids', sort: 'bids', numeric: true, width: 72, defaultVisible: true },
  { key: 'ends', label: 'Ends', sort: 'endsAt', width: 96, defaultVisible: true },
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
    tooltip: 'Majestic Trust Flow',
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
    tooltip: 'Majestic Citation Flow',
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
    tooltip: 'Majestic Referring Domains',
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
    tooltip: 'Semrush Authority Score',
    sort: 'semrushAs',
    group: 'Semrush',
    numeric: true,
    width: 72,
    defaultVisible: false
  },
  {
    key: 'domainRating',
    label: 'DR',
    menuLabel: 'Domain Rating',
    tooltip: 'Domain Rating by Ahrefs',
    sort: 'domainRating',
    group: 'Ahrefs',
    numeric: true,
    width: 72,
    defaultVisible: true
  }
] as const satisfies ReadonlyArray<{
  key: string
  label: string
  menuLabel?: string
  // The full name a short header label stands for, shown in its tooltip.
  tooltip?: string
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
  ['domain', 192],
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

// Column order and pins. The selection checkbox and Domain always lead and
// stick to the left; the row-action menu always ends the row and sticks to the
// right. Every other column has a place in `order` and may be pinned to either
// side, where it sticks after Domain (left) or before the row actions (right),
// keeping its place in `order` within that side; unpinning puts it back in
// place. The layout is saved per browser in the `column-layout` cookie, never
// in the URL.
export type PinSide = 'left' | 'right'
export type ColumnLayout = {
  order: ColumnKey[]
  pins: Partial<Record<ColumnKey, PinSide>>
}

export const COLUMN_LAYOUT_COOKIE = 'column-layout'
// The fixed widths, in CSS pixels, of the selection and row-action columns.
export const SELECTION_COLUMN_WIDTH = 40
export const ROW_ACTIONS_COLUMN_WIDTH = 40

const COLUMN_KEYS: ColumnKey[] = TABLE_COLUMNS.map(column => column.key)
const COLUMNS_BY_KEY = new Map<string, TableColumn>(
  TABLE_COLUMNS.map(column => [column.key, column])
)

export const DEFAULT_COLUMN_LAYOUT: ColumnLayout = { order: COLUMN_KEYS, pins: {} }

function isColumnKey(key: string): key is ColumnKey {
  return COLUMNS_BY_KEY.has(key)
}

// The cookie holds `order:a,b,c|left:a|right:c` (a `;` would end the cookie).
// Unknown sections and keys are ignored, a key keeps its first place, columns
// the cookie lacks follow in registry order, and anything unreadable is the
// default layout.
export function parseColumnLayout(cookie: string | undefined): ColumnLayout {
  const sections = new Map<string, ColumnKey[]>()
  for (const section of cookie?.split('|') ?? []) {
    const [name, keys = ''] = section.split(':')
    if (!sections.has(name)) sections.set(name, keys.split(',').filter(isColumnKey))
  }
  const order = [...new Set([...(sections.get('order') ?? []), ...COLUMN_KEYS])]
  const pins: ColumnLayout['pins'] = {}
  for (const side of ['left', 'right'] as const) {
    for (const key of sections.get(side) ?? []) pins[key] ??= side
  }
  return { order, pins }
}

export function serializeColumnLayout(layout: ColumnLayout) {
  const sections = [`order:${layout.order.join(',')}`]
  for (const side of ['left', 'right'] as const) {
    const keys = layout.order.filter(key => layout.pins[key] === side)
    if (keys.length > 0) sections.push(`${side}:${keys.join(',')}`)
  }
  return sections.join('|')
}

export function isDefaultColumnLayout(layout: ColumnLayout) {
  return serializeColumnLayout(layout) === serializeColumnLayout(DEFAULT_COLUMN_LAYOUT)
}

// The visible columns in display order, split into the left-pinned, scrolling,
// and right-pinned sections.
export function orderedColumns(layout: ColumnLayout, visible: readonly ColumnKey[]) {
  const shown = layout.order
    .filter(key => visible.includes(key))
    .map(key => COLUMNS_BY_KEY.get(key) as TableColumn)
  return {
    left: shown.filter(column => layout.pins[column.key] === 'left'),
    center: shown.filter(column => layout.pins[column.key] === undefined),
    right: shown.filter(column => layout.pins[column.key] === 'right')
  }
}

// Pins a column to a side, or unpins it with `null`.
export function pinColumn(
  layout: ColumnLayout,
  key: ColumnKey,
  side: PinSide | null
): ColumnLayout {
  const { [key]: _, ...pins } = layout.pins
  return { order: layout.order, pins: side ? { ...pins, [key]: side } : pins }
}

// Swaps an unpinned column with its visible unpinned neighbour on one side.
// Null when there is none: at either end, or for a pinned column.
export function moveColumn(
  layout: ColumnLayout,
  key: ColumnKey,
  direction: PinSide,
  visible: readonly ColumnKey[]
): ColumnLayout | null {
  const center = orderedColumns(layout, visible).center.map(column => column.key)
  const index = center.indexOf(key)
  const neighbour = index === -1 ? undefined : center[index + (direction === 'left' ? -1 : 1)]
  if (neighbour === undefined) return null
  const order = layout.order.map(column =>
    column === key ? neighbour : column === neighbour ? key : column
  )
  return { order, pins: layout.pins }
}

export type StickyOffset = { left: string } | { right: string }

// The CSS `left` or `right` of each sticky column: the widths of the sticky
// columns between it and the table's edge, summed in a `calc()` over the same
// width variables as the `<col>` elements, so a resize keeps the offsets right.
// `left` lists the columns sticking after the selection checkbox (Domain
// first), and `right` those sticking before the row actions.
export function stickyOffsets(
  left: readonly ResizableColumnKey[],
  right: readonly ResizableColumnKey[]
) {
  const offsets: Partial<Record<ResizableColumnKey, StickyOffset>> = {}
  const sum = (terms: string[]) => (terms.length === 1 ? terms[0] : `calc(${terms.join(' + ')})`)
  left.forEach((key, index) => {
    offsets[key] = {
      left: sum([`${SELECTION_COLUMN_WIDTH}px`, ...left.slice(0, index).map(columnWidthCss)])
    }
  })
  right.forEach((key, index) => {
    offsets[key] = {
      right: sum([`${ROW_ACTIONS_COLUMN_WIDTH}px`, ...right.slice(index + 1).map(columnWidthCss)])
    }
  })
  return offsets
}
