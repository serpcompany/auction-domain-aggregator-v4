import {
  buildDomainTableHref,
  type DomainTableFilters,
  parseDomainTableFilters,
  queryStringToSearchParams
} from '@/domain/domain-table'
import { describeRule, rulesFromFilters } from '@/domain/filter-rules'
import {
  parseColumnLayout,
  parseColumnWidths,
  parseVisibleColumns,
  serializeColumnLayout,
  serializeColumnWidths,
  serializeVisibleColumns
} from '@/domain/table-columns'

// Named saved views: a table URL (search, rules, and sort) plus the column
// layout, held as the `columns`, `column-layout`, and `column-widths` cookie
// values. Views live in this browser's localStorage until sign-in exists.
// Issue 27 (its last comment) moves them to the signed-in account, a
// `saved_views` table built in issue 106. Only `savedViewStore` below touches
// storage, so that move replaces it and keeps its shape.

export const SAVED_VIEWS_KEY = 'saved-views:v1'
export const SAVED_VIEWS_LIMIT = 50
export const SAVED_VIEW_NAME_MAX_LENGTH = 80

export interface SavedViewLayout {
  columns: string
  layout: string
  widths: string
}

export interface SavedView extends SavedViewLayout {
  name: string
  // The table's query string, without the leading `/?`, on page 1.
  query: string
}

export type SaveViewResult = 'added' | 'replaced' | 'full'

// Spaces collapsed and trimmed, and cut to the longest name kept.
export function normalizeViewName(name: string) {
  return name.replace(/\s+/g, ' ').trim().slice(0, SAVED_VIEW_NAME_MAX_LENGTH).trim()
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// The active rules in words, or "All auctions" with none.
export function suggestViewName(filters: DomainTableFilters) {
  const rules = rulesFromFilters(filters)
  if (rules.length === 0) return 'All auctions'
  const name = rules.map(describeRule).join(', ')
  return name.length > SAVED_VIEW_NAME_MAX_LENGTH
    ? `${name.slice(0, SAVED_VIEW_NAME_MAX_LENGTH - 1).trimEnd()}…`
    : name
}

// The query string a view stores: the table URL on page 1.
export function viewQuery(filters: DomainTableFilters) {
  return buildDomainTableHref(filters, { page: 1 }).slice('/?'.length)
}

// The table URL a view opens, through the same parser as any URL.
export function viewHref(view: Pick<SavedView, 'query'>) {
  return buildDomainTableHref(parseDomainTableFilters(queryStringToSearchParams(view.query)), {
    page: 1
  })
}

// A view's layout as cookie values the server reads, through the same parsers
// as the cookies, so a hand-edited value cannot reach a cookie unchecked.
export function viewLayout(view: SavedViewLayout): SavedViewLayout {
  return {
    columns: serializeVisibleColumns(parseVisibleColumns(view.columns)),
    layout: serializeColumnLayout(parseColumnLayout(view.layout)),
    widths: serializeColumnWidths(parseColumnWidths(view.widths))
  }
}

// Saving under an existing name, in any case, replaces that view in place.
// A new name past the limit saves nothing.
export function saveView(
  views: readonly SavedView[],
  view: SavedView
): { views: SavedView[]; result: SaveViewResult } {
  const index = views.findIndex(candidate => sameName(candidate.name, view.name))
  if (index !== -1)
    return {
      views: views.map((current, at) => (at === index ? view : current)),
      result: 'replaced'
    }
  if (views.length >= SAVED_VIEWS_LIMIT) return { views: [...views], result: 'full' }
  return { views: [...views, view], result: 'added' }
}

export function deleteView(views: readonly SavedView[], name: string) {
  return views.filter(view => view.name !== name)
}

function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== 'object' || value === null) return false
  const view = value as Record<string, unknown>
  return ['name', 'query', 'columns', 'layout', 'widths'].every(
    key => typeof view[key] === 'string'
  )
}

// What storage holds: a JSON array of views. Anything missing or unreadable is
// no views, malformed entries are skipped, a repeated name keeps its first
// view, and at most the limit are kept.
export function parseSavedViews(raw: string | null): SavedView[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const views: SavedView[] = []
  for (const entry of parsed) {
    if (!isSavedView(entry)) continue
    const name = normalizeViewName(entry.name)
    if (name === '' || views.some(view => sameName(view.name, name))) continue
    const { query, columns, layout, widths } = entry
    views.push({ name, query, columns, layout, widths })
  }
  return views.slice(0, SAVED_VIEWS_LIMIT)
}

export interface SavedViewStore {
  subscribe: (listener: () => void) => () => void
  // The same array until the views change, as `useSyncExternalStore` needs.
  read: () => readonly SavedView[]
  // False when storage refused the write.
  write: (views: readonly SavedView[]) => boolean
}

const NO_VIEWS: readonly SavedView[] = []

// The browser store: localStorage, where every access may throw (storage
// turned off, a private window, or a full quota). Other tabs' changes arrive
// as `storage` events.
export function localSavedViewStore(storage: () => Storage): SavedViewStore {
  const listeners = new Set<() => void>()
  let cache = { raw: null as string | null, views: NO_VIEWS }
  const readRaw = () => {
    try {
      return storage().getItem(SAVED_VIEWS_KEY)
    } catch {
      return null
    }
  }
  return {
    subscribe: listener => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === SAVED_VIEWS_KEY) listener()
      }
      listeners.add(listener)
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        window.removeEventListener('storage', onStorage)
      }
    },
    read: () => {
      const raw = readRaw()
      if (raw !== cache.raw) cache = { raw, views: parseSavedViews(raw) }
      return cache.views
    },
    write: views => {
      try {
        storage().setItem(SAVED_VIEWS_KEY, JSON.stringify(views))
      } catch {
        return false
      }
      for (const listener of listeners) listener()
      return true
    }
  }
}

export const savedViewStore = localSavedViewStore(() => window.localStorage)

// The server has no views; the browser's appear after hydration.
export function noSavedViews() {
  return NO_VIEWS
}
