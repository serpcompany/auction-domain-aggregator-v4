'use client';

import { useId, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export function SearchableMultiSelect({
  label,
  name,
  options,
  defaultValues,
  searchable = false,
  form,
}: {
  label: string;
  name: string;
  options: MultiSelectOption[];
  defaultValues: string[];
  searchable?: boolean;
  form?: string;
}) {
  const searchId = useId();
  const [selected, setSelected] = useState(defaultValues);
  const [search, setSearch] = useState('');
  const selectedSet = new Set(selected);
  const availableOptions = useMemo(() => {
    const byValue = new Map(options.map((option) => [option.value, option]));
    for (const value of defaultValues) {
      if (!byValue.has(value)) byValue.set(value, { value, label: value });
    }
    return [...byValue.values()];
  }, [defaultValues, options]);
  const visibleOptions = searchable
    ? availableOptions.filter((option) =>
        option.label.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : availableOptions;

  const toggle = (value: string) => {
    setSelected((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  };

  return (
    <Popover>
      {selected.map((value) => (
        <input
          key={value}
          type="hidden"
          name={name}
          value={value}
          form={form}
        />
      ))}
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={`${label}: ${
              selected.length === 0
                ? 'Any'
                : selected.length === 1
                  ? availableOptions.find(
                      (option) => option.value === selected[0],
                    )!.label
                  : `${selected.length} selected`
            }`}
            className="h-11 w-full justify-between px-3 text-left font-normal sm:h-8"
          />
        }
      >
        <span className="truncate">
          {selected.length === 0
            ? `Any ${label.toLowerCase()}`
            : selected.length === 1
              ? availableOptions.find((option) => option.value === selected[0])
                  ?.label
              : `${selected.length} selected`}
        </span>
        <ChevronDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))]">
        <PopoverHeader>
          <PopoverTitle>{label}</PopoverTitle>
          <PopoverDescription>
            Choose one or more. Results update after Apply filters.
          </PopoverDescription>
        </PopoverHeader>
        {searchable ? (
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              type="search"
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              aria-label={`Search ${label.toLowerCase()}`}
              className="h-11 pl-8 sm:h-10"
            />
          </div>
        ) : null}
        <ScrollArea className="max-h-64 overscroll-contain">
          <div className="space-y-1 pr-2">
            {visibleOptions.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                No options found
              </p>
            ) : (
              visibleOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted"
                >
                  <Checkbox
                    checked={selectedSet.has(option.value)}
                    onCheckedChange={() => toggle(option.value)}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              ))
            )}
          </div>
        </ScrollArea>
        {selected.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 self-start sm:h-8"
            onClick={() => setSelected([])}
          >
            Clear selection
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
