'use client'

import { CheckIcon, CirclePlusIcon } from 'lucide-react'
import type * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export type FacetOption = { value: string; label: string }

// The toolbar button: dashed until something is chosen, then the choices.
export function FacetTrigger({
  title,
  selectedLabels,
  ...props
}: React.ComponentProps<typeof PopoverTrigger> & { title: string; selectedLabels: string[] }) {
  return (
    <PopoverTrigger
      render={<Button variant="outline" size="sm" className="border-dashed" />}
      {...props}
    >
      <CirclePlusIcon aria-hidden="true" />
      {title}
      {selectedLabels.length > 0 ? (
        <>
          <Separator orientation="vertical" className="mx-0.5 data-vertical:h-4" />
          {selectedLabels.length > 2 ? (
            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
              {selectedLabels.length} selected
            </Badge>
          ) : (
            selectedLabels.map(label => (
              <Badge key={label} variant="secondary" className="rounded-sm px-1 font-normal">
                {label}
              </Badge>
            ))
          )}
        </>
      ) : null}
    </PopoverTrigger>
  )
}

// A multi-select facet: the shadcn tasks example's faceted filter, built from
// Popover and Command without a table library.
export function FacetedFilter({
  title,
  options,
  selected,
  onChange,
  searchable = false,
  footer
}: {
  title: string
  options: FacetOption[]
  selected: string[]
  onChange: (values: string[]) => void
  searchable?: boolean
  footer?: string
}) {
  const labels = new Map(options.map(option => [option.value, option.label]))
  // Keep applied values the facets no longer list.
  const all = [
    ...options,
    ...selected.filter(value => !labels.has(value)).map(value => ({ value, label: value }))
  ]
  const toggle = (value: string) =>
    onChange(
      selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]
    )

  return (
    <Popover>
      <FacetTrigger
        title={title}
        selectedLabels={selected.map(value => labels.get(value) ?? value)}
      />
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          {searchable ? <CommandInput placeholder={title} /> : null}
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {all.map(option => {
                const checked = selected.includes(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    data-checked={checked}
                    onSelect={() => toggle(option.value)}
                  >
                    <span
                      className={cn(
                        'flex size-4 items-center justify-center rounded-[4px] border border-input',
                        checked && 'border-primary bg-primary text-primary-foreground'
                      )}
                      aria-hidden="true"
                    >
                      {checked ? <CheckIcon className="size-3" /> : null}
                    </span>
                    {option.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {footer ? <p className="px-2 py-1.5 text-xs text-muted-foreground">{footer}</p> : null}
            {selected.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange([])} className="justify-center">
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
