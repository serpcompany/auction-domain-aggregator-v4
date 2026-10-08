'use client'

import { ListPlusIcon, XIcon } from 'lucide-react'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

type RowSelection = {
  selected: ReadonlySet<string>
  // Whether every row, or only some, of the page are selected.
  all: boolean
  some: boolean
  toggle: (key: string, selected: boolean) => void
  toggleAll: (selected: boolean) => void
  clear: () => void
}

const Selection = createContext<RowSelection | null>(null)

export function useRowSelection() {
  const context = useContext(Selection)
  if (!context) throw new Error('Row selection needs a RowSelectionProvider')
  return context
}

// The rows selected on this page: client state only. The page remounts this
// provider on every navigation, so a new URL starts with nothing selected.
export function RowSelectionProvider({
  rowKeys,
  children
}: {
  rowKeys: readonly string[]
  children: ReactNode
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string, on: boolean) =>
    setSelected(current => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  const value: RowSelection = {
    selected,
    all: rowKeys.length > 0 && rowKeys.every(key => selected.has(key)),
    some: selected.size > 0,
    toggle,
    toggleAll: on => setSelected(new Set(on ? rowKeys : [])),
    clear: () => setSelected(new Set())
  }
  return <Selection.Provider value={value}>{children}</Selection.Provider>
}

// Shown above the table while rows are selected. Lists come in a later
// feature, so Save to list only says so.
export function SelectionBar() {
  const { selected, clear } = useRowSelection()
  if (selected.size === 0) return null
  return (
    <section
      aria-label="Selected rows"
      className="hidden items-center gap-2 rounded-lg border bg-muted/50 py-1 pr-1 pl-3 text-sm md:flex"
    >
      <span role="status" className="font-medium tabular-nums">
        {selected.size.toLocaleString('en-US')} selected
      </span>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={() => toast('Saving selected rows to a list comes in a later feature.')}
      >
        <ListPlusIcon aria-hidden="true" />
        Save to list
      </Button>
      <Button variant="ghost" size="sm" onClick={clear}>
        <XIcon aria-hidden="true" />
        Clear selection
      </Button>
    </section>
  )
}
