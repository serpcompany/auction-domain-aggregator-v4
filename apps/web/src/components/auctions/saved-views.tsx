'use client'

import { BookmarkIcon, BookmarkPlusIcon, XIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

import { useViewLayout } from '@/components/auctions/table-layout'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover'
import { buildDomainTableHref, type DomainTableFilters } from '@/domain/domain-table'
import {
  normalizeViewName,
  SAVED_VIEW_NAME_MAX_LENGTH,
  SAVED_VIEWS_LIMIT,
  suggestViewName,
  viewHref,
  viewLayout,
  viewQuery
} from '@/domain/saved-views'
import { useSavedViews } from '@/hooks/use-saved-views'

const FULL_MESSAGE = `This browser keeps at most ${SAVED_VIEWS_LIMIT} views. Delete one to save another, or save under an existing name to replace it.`

// Save, at the end of the rule bar: names the current search, rules, sort,
// and column layout. Enter saves too; an existing name is replaced. On phones
// it is an icon.
export function SaveViewButton({
  filters,
  compact = false
}: {
  filters: DomainTableFilters
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { views, save } = useSavedViews()
  const { current } = useViewLayout()
  const suggestion = suggestViewName(filters)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const typed = new FormData(event.currentTarget).get('name') as string
    const name = normalizeViewName(typed) || suggestion
    const result = save({ name, query: viewQuery(filters), ...current })
    if (result === 'full') {
      toast.error(FULL_MESSAGE)
      return
    }
    if (result === 'failed') {
      toast.error('This browser refused to store the view. Storage may be full or turned off.')
      return
    }
    toast.success(result === 'added' ? `Saved view “${name}”` : `Replaced view “${name}”`)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          compact ? (
            <Button variant="outline" size="icon-sm" aria-label="Save view" />
          ) : (
            <Button variant="ghost" size="sm" />
          )
        }
      >
        <BookmarkPlusIcon aria-hidden="true" />
        {compact ? null : 'Save'}
      </PopoverTrigger>
      <PopoverContent align={compact ? 'end' : 'start'} className="w-96 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>Save view</PopoverTitle>
          <PopoverDescription>
            Keeps the search, rules, sort, and column layout in this browser.
          </PopoverDescription>
        </PopoverHeader>
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor="saved-view-name">Name</Label>
          <div className="flex gap-2">
            <Input
              id="saved-view-name"
              name="name"
              placeholder={suggestion}
              maxLength={SAVED_VIEW_NAME_MAX_LENGTH}
              autoComplete="off"
              autoFocus
              className="min-w-0 flex-1"
            />
            <Button type="submit" size="default">
              Save view
            </Button>
          </div>
          {views.length >= SAVED_VIEWS_LIMIT ? (
            <p role="status" className="text-muted-foreground">
              {FULL_MESSAGE}
            </p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  )
}

// Views, in the toolbar: choosing one opens its URL and applies its layout;
// × deletes it. On phones it is an icon.
export function ViewsMenu({
  filters,
  onNavigate,
  compact = false
}: {
  filters: DomainTableFilters
  onNavigate: (href: string) => void
  compact?: boolean
}) {
  const { views, remove } = useSavedViews()
  const { apply } = useViewLayout()
  const here = buildDomainTableHref(filters)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size={compact ? 'icon-sm' : 'sm'}
            aria-label={compact ? 'Views' : undefined}
          />
        }
      >
        <BookmarkIcon aria-hidden="true" />
        {compact ? null : 'Views'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Saved views, in this browser</DropdownMenuLabel>
          {views.length === 0 ? (
            <p className="px-1.5 py-1 text-sm text-muted-foreground">
              None yet. Save sets the current rules, sort, and columns aside as a view.
            </p>
          ) : null}
          {views.map(view => (
            <div key={view.name} className="flex items-center gap-1">
              <DropdownMenuItem
                className="min-w-0 flex-1"
                onClick={() => {
                  apply(viewLayout(view))
                  const href = viewHref(view)
                  // Already there: the layout was all that changed, so no D1 read.
                  if (href !== here) onNavigate(href)
                  toast.success(`Opened view “${view.name}”`)
                }}
              >
                <span className="truncate">{view.name}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`Delete view ${view.name}`}
                closeOnClick={false}
                className="shrink-0"
                onClick={() => {
                  if (remove(view.name)) toast.success(`Deleted view “${view.name}”`)
                  else toast.error('This browser refused to delete the view.')
                }}
              >
                <XIcon aria-hidden="true" />
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
