import type { DomainTableSort } from '@/domain/domain-table'

// The one registry of table columns. The table, the Columns menu, and the
// cookie that stores the choice all read it; Domain is always shown and is
// not part of it.
export const TABLE_COLUMNS = [
  { key: 'source', label: 'Source', sort: 'source', defaultVisible: true },
  { key: 'price', label: 'Price', sort: 'price', numeric: true, defaultVisible: true },
  { key: 'bids', label: 'Bids', sort: 'bids', numeric: true, defaultVisible: true },
  { key: 'ends', label: 'Ends', sort: 'endsAt', defaultVisible: true },
  { key: 'age', label: 'Age', sort: 'age', numeric: true, defaultVisible: true },
  {
    key: 'links',
    label: 'Links',
    menuLabel: 'Inbound links',
    sort: 'links',
    numeric: true,
    defaultVisible: true
  },
  { key: 'appraisal', label: 'Appraisal', sort: 'appraisal', numeric: true, defaultVisible: true },
  { key: 'renewal', label: 'Renewal', sort: 'renewal', numeric: true, defaultVisible: false },
  { key: 'visitors', label: 'Visitors', sort: 'visitors', numeric: true, defaultVisible: false },
  { key: 'length', label: 'Length', sort: 'domainLength', numeric: true, defaultVisible: false },
  {
    key: 'majesticTf',
    label: 'TF',
    menuLabel: 'Trust Flow',
    group: 'Majestic',
    numeric: true,
    defaultVisible: true
  },
  {
    key: 'majesticCf',
    label: 'CF',
    menuLabel: 'Citation Flow',
    group: 'Majestic',
    numeric: true,
    defaultVisible: true
  },
  {
    key: 'majesticRefDomains',
    label: 'Ref. dom.',
    menuLabel: 'Referring domains',
    group: 'Majestic',
    numeric: true,
    defaultVisible: false
  },
  {
    key: 'semrushAs',
    label: 'AS',
    menuLabel: 'Authority Score',
    group: 'Semrush',
    numeric: true,
    defaultVisible: true
  },
  {
    key: 'domainRating',
    label: 'DR',
    menuLabel: 'Domain Rating',
    group: 'Ahrefs',
    numeric: true,
    defaultVisible: true
  }
] as const satisfies ReadonlyArray<{
  key: string
  label: string
  menuLabel?: string
  sort?: DomainTableSort
  group?: 'Majestic' | 'Semrush' | 'Ahrefs'
  numeric?: boolean
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
