'use client'

import {
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useRef,
  useState
} from 'react'

import {
  COLUMN_WIDTHS_COOKIE,
  COLUMNS_COOKIE_MAX_AGE,
  type ColumnWidths,
  clampColumnWidth,
  columnWidth,
  columnWidthVariable,
  defaultColumnWidth,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type ResizableColumnKey,
  serializeColumnWidths
} from '@/domain/table-columns'

const KEYBOARD_STEP = 16

function saveColumnWidths(widths: ColumnWidths) {
  // biome-ignore lint/suspicious/noDocumentCookie: the server reads this cookie to render the chosen widths.
  document.cookie = `${COLUMN_WIDTHS_COOKIE}=${serializeColumnWidths(widths)}; path=/; max-age=${COLUMNS_COOKIE_MAX_AGE}; samesite=lax`
}

type Resize = (key: ResizableColumnKey, width: number | undefined, save?: boolean) => void

const Widths = createContext<{ widths: ColumnWidths; resize: Resize } | null>(null)

// Holds the chosen column widths as the CSS variables that the table's `<col>`
// elements read, so a drag re-lays out the table without re-rendering its
// rows. The server renders the saved widths from the same cookie.
export function ColumnWidthsProvider({
  initialWidths,
  children
}: {
  initialWidths: ColumnWidths
  children: ReactNode
}) {
  const [widths, setWidths] = useState(initialWidths)
  // The latest widths, for the cookie, while a drag is still updating state.
  const latest = useRef(initialWidths)
  // A width of `undefined` restores the column's default.
  const resize: Resize = (key, width, save = true) => {
    const { [key]: _, ...others } = latest.current
    const next = width === undefined ? others : { ...others, [key]: clampColumnWidth(width) }
    latest.current = next
    setWidths(next)
    if (save) saveColumnWidths(next)
  }
  const style = Object.fromEntries(
    Object.entries(widths).map(([key, width]) => [
      columnWidthVariable(key as ResizableColumnKey),
      `${width}px`
    ])
  ) as CSSProperties
  return (
    <Widths.Provider value={{ widths, resize }}>
      <div className="contents" style={style}>
        {children}
      </div>
    </Widths.Provider>
  )
}

// The resize handle on a header's right edge, a focusable separator: drag it
// or use the arrow keys, and double-click it or press Enter for the default.
export function ColumnResizeHandle({
  column,
  label
}: {
  column: ResizableColumnKey
  label: string
}) {
  const context = useContext(Widths)
  if (!context) throw new Error('ColumnResizeHandle needs a ColumnWidthsProvider')
  const { widths, resize } = context
  const width = columnWidth(widths, column)

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // Keeps the drag from selecting text or following the header's sort link.
    event.preventDefault()
    const startX = event.clientX
    let dragged = width
    const move = (moveEvent: globalThis.PointerEvent) => {
      dragged = width + moveEvent.clientX - startX
      resize(column, dragged, false)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      resize(column, dragged)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const keyWidths: Record<string, number | undefined> = {
    ArrowLeft: width - KEYBOARD_STEP,
    ArrowRight: width + KEYBOARD_STEP,
    Home: MIN_COLUMN_WIDTH,
    End: MAX_COLUMN_WIDTH,
    Enter: undefined
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.key in keyWidths)) return
    event.preventDefault()
    resize(column, keyWidths[event.key])
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator with a value is the ARIA window-splitter pattern, which <hr> cannot express.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      aria-valuenow={width}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuetext={`${width} pixels${width === defaultColumnWidth(column) ? ', the default' : ''}`}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={startDrag}
      onDoubleClick={() => resize(column, undefined)}
      onKeyDown={onKeyDown}
      data-slot="column-resize-handle"
      className="absolute inset-y-0 right-0 z-10 flex w-2 cursor-col-resize touch-none justify-end select-none after:h-full after:w-px after:bg-transparent after:transition-colors hover:after:bg-ring focus-visible:outline-none focus-visible:after:w-0.5 focus-visible:after:bg-ring"
    />
  )
}
