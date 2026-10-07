import { Skeleton } from '@/components/ui/skeleton'
import { type ColumnKey, TABLE_COLUMNS } from '@/domain/table-columns'

// Placeholder rows at the real row height for the chosen columns, so nothing
// jumps when the listings arrive.
export function ResultsSkeleton({ visibleColumns }: { visibleColumns: readonly ColumnKey[] }) {
  const columns = TABLE_COLUMNS.filter(column => visibleColumns.includes(column.key))
  const rows = Array.from({ length: 14 }, (_, index) => index)
  return (
    <>
      <p role="status" className="sr-only">
        Loading listings
      </p>
      <div
        aria-hidden="true"
        className="hidden min-h-0 overflow-hidden rounded-lg border md:block md:flex-1"
        data-testid="results-skeleton"
      >
        <div className="flex h-[62px] items-center gap-4 border-b px-3">
          <Skeleton className="h-4 w-40" />
          {columns.map(column => (
            <Skeleton key={column.key} className="ml-auto h-4 w-10" />
          ))}
        </div>
        {rows.map(row => (
          <div key={row} className="flex h-10 items-center gap-4 border-b px-3">
            <Skeleton className="h-3.5" style={{ width: `${9 + ((row * 7) % 5)}rem` }} />
            {columns.map(column => (
              <Skeleton key={column.key} className="ml-auto h-3.5 w-10" />
            ))}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="-mx-4 divide-y border-y md:hidden">
        {rows.slice(0, 8).map(row => (
          <div key={row} className="grid gap-2 px-3 py-3">
            <div className="flex justify-between">
              <Skeleton className="h-4" style={{ width: `${8 + ((row * 5) % 4)}rem` }} />
              <Skeleton className="h-4 w-14" />
            </div>
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-5 w-56" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-56" />
      </div>
    </>
  )
}
