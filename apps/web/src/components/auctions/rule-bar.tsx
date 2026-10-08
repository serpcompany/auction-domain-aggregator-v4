'use client'

import { ListFilterIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { type FocusEvent, useRef, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor
} from '@/components/ui/combobox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  buildDomainTableHref,
  DOMAIN_TABLE_ENDING_WINDOWS,
  type DomainTableEndingWindow,
  type DomainTableFilters,
  formatAuctionType,
  formatProvider,
  hasActiveDomainTableFilters,
  parseDomainTableFilters
} from '@/domain/domain-table'
import {
  applyRule,
  changeRuleOperator,
  isRuleReady,
  RULE_FIELD_KEYS,
  RULE_OPERATOR_LABELS,
  type Rule,
  type RuleField,
  type RuleOperator,
  removeRule,
  ruleField,
  rulesFromFilters
} from '@/domain/filter-rules'

const WINDOW_LABELS: Record<DomainTableEndingWindow, string> = {
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
  '3d': '3 days',
  '7d': '7 days'
}

type Option = { value: string; label: string }

export type RuleOptions = Partial<Record<RuleField, Option[]>>

// The rule's name in labels: "Price", or "Domain has no hyphens" for a flag.
function ruleName(field: RuleField) {
  const { label, kind, operators } = ruleField(field)
  return kind === 'none' ? `${label} ${RULE_OPERATOR_LABELS[operators[0]]}` : label
}

// Focus moving within a rule, or into one of its lists, is not a blur.
function leavesRule(event: FocusEvent<HTMLElement>) {
  const next = event.relatedTarget as HTMLElement | null
  return !(next && (event.currentTarget.contains(next) || next.closest('[data-rule-popup]')))
}

function NumberValue({
  label,
  money,
  value,
  autoFocus,
  onChange,
  onEnter
}: {
  label: string
  money: boolean
  value: string
  autoFocus: boolean
  onChange: (value: string) => void
  onEnter: () => void
}) {
  const props = {
    type: 'number',
    min: '0',
    step: money ? '0.01' : '1',
    inputMode: money ? ('decimal' as const) : ('numeric' as const),
    autoComplete: 'off',
    'aria-label': label,
    placeholder: 'Any',
    autoFocus,
    value,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    onKeyDown: (event: { key: string }) => {
      if (event.key === 'Enter') onEnter()
    }
  }
  if (!money) return <Input {...props} className="h-7 w-20 bg-background" />
  return (
    <InputGroup className="h-7 w-24 bg-background">
      <InputGroupAddon>
        <InputGroupText>$</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput {...props} />
    </InputGroup>
  )
}

function ListValue({
  label,
  options,
  values,
  autoFocus,
  onChange,
  onCommit
}: {
  label: string
  options: Option[]
  values: string[]
  autoFocus: boolean
  onChange: (values: string[]) => void
  onCommit: (values: string[]) => void
}) {
  const anchor = useComboboxAnchor()
  const open = useRef(false)
  const latest = useRef(values)
  const labels = new Map(options.map(option => [option.value, option.label]))
  // Keep applied values the facets no longer list.
  const items = [
    ...options.map(option => option.value),
    ...values.filter(value => !labels.has(value))
  ]
  const labelFor = (value: string) => labels.get(value) ?? value

  return (
    <Combobox
      multiple
      items={items}
      value={values}
      itemToStringLabel={labelFor}
      onValueChange={(next: string[]) => {
        latest.current = next
        onChange(next)
        // A chip removed while the list is closed applies at once.
        if (!open.current) onCommit(next)
      }}
      onOpenChange={next => {
        open.current = next
        if (!next) onCommit(latest.current)
      }}
    >
      <ComboboxChips ref={anchor} className="min-h-7 max-w-96 min-w-32 bg-background py-0.5">
        <ComboboxValue>
          {(selected: string[]) => (
            <>
              {selected.map(value => (
                <ComboboxChip key={value}>{labelFor(value)}</ComboboxChip>
              ))}
              <ComboboxChipsInput
                aria-label={label}
                autoFocus={autoFocus}
                placeholder={selected.length === 0 ? 'Choose…' : ''}
                // Sized to its placeholder, so the rule fits its chips.
                className="w-16"
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor} data-rule-popup="">
        <ComboboxEmpty>No options found</ComboboxEmpty>
        <ComboboxList>
          {(value: string) => (
            <ComboboxItem key={value} value={value}>
              {labelFor(value)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function RuleEditor({
  rule: committed,
  options,
  autoFocus,
  onCommit,
  onRemove
}: {
  rule: Rule
  options: Option[]
  autoFocus: boolean
  onCommit: (rule: Rule) => void
  onRemove: () => void
}) {
  const [rule, setRule] = useState(committed)
  const { label, kind, operators } = ruleField(rule.field)
  const name = ruleName(rule.field)
  const commit = (next: Rule) => {
    if (isRuleReady(next)) onCommit(next)
  }
  const setValue = (index: number, value: string) => {
    const values = [...rule.values]
    values[index] = value
    setRule({ ...rule, values })
  }
  const numberValue = (index: number, valueLabel: string) => (
    <NumberValue
      label={valueLabel}
      money={kind === 'money'}
      value={rule.values[index] ?? ''}
      autoFocus={autoFocus && index === 0}
      onChange={value => setValue(index, value)}
      onEnter={() => commit(rule)}
    />
  )

  let value = null
  if (kind === 'list') {
    value = (
      <ListValue
        label={`${label} values`}
        options={options}
        values={rule.values}
        autoFocus={autoFocus}
        onChange={values => setRule({ ...rule, values })}
        onCommit={values => commit({ ...rule, values })}
      />
    )
  } else if (kind === 'window') {
    value = (
      <Select
        items={DOMAIN_TABLE_ENDING_WINDOWS.map(window => ({
          value: window,
          label: WINDOW_LABELS[window]
        }))}
        value={rule.values[0] ?? null}
        onValueChange={window => commit({ ...rule, values: [window as string] })}
      >
        <SelectTrigger size="sm" aria-label={`${label} value`} autoFocus={autoFocus}>
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent data-rule-popup="">
          {DOMAIN_TABLE_ENDING_WINDOWS.map(window => (
            <SelectItem key={window} value={window}>
              {WINDOW_LABELS[window]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else if (kind !== 'none') {
    value =
      rule.operator === 'between' ? (
        <>
          {numberValue(0, `${label} minimum`)}
          <span className="text-sm text-muted-foreground">and</span>
          {numberValue(1, `${label} maximum`)}
        </>
      ) : (
        numberValue(0, `${label} value`)
      )
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would restyle the rule; the group role names it.
    <div
      role="group"
      aria-label={`${name} rule`}
      className="flex min-h-8 items-center gap-1 rounded-lg bg-muted p-0.5 pl-2.5"
      onBlur={event => {
        if (kind !== 'list' && leavesRule(event)) commit(rule)
      }}
    >
      <span className="text-sm font-medium">{label}</span>
      {operators.length > 1 ? (
        <Select
          items={operators.map(operator => ({
            value: operator,
            label: RULE_OPERATOR_LABELS[operator]
          }))}
          value={rule.operator}
          onValueChange={operator => {
            const next = changeRuleOperator(rule, operator as RuleOperator)
            setRule(next)
            commit(next)
          }}
        >
          <SelectTrigger size="sm" aria-label={`${label} operator`} className="bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent data-rule-popup="">
            {operators.map(operator => (
              <SelectItem key={operator} value={operator}>
                {RULE_OPERATOR_LABELS[operator]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="px-1 text-sm text-muted-foreground">
          {RULE_OPERATOR_LABELS[operators[0]]}
        </span>
      )}
      {value}
      <Button variant="ghost" size="icon-xs" aria-label={`Remove ${name} rule`} onClick={onRemove}>
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  )
}

function FieldsMenu({ fields, onAdd }: { fields: RuleField[]; onAdd: (field: RuleField) => void }) {
  const [open, setOpen] = useState(false)
  // Adding a rule focuses its value, so closing must not refocus the button.
  const added = useRef(false)
  return (
    <Popover
      open={open}
      onOpenChange={next => {
        if (next) added.current = false
        setOpen(next)
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" className="border-dashed" />}>
        <ListFilterIcon aria-hidden="true" />
        Filters
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" finalFocus={() => !added.current}>
        <Command>
          <CommandInput placeholder="Filter by…" />
          <CommandList>
            <CommandEmpty>No more fields.</CommandEmpty>
            <CommandGroup>
              {fields.map(field => {
                const { description } = ruleField(field)
                return (
                  <CommandItem
                    key={field}
                    value={[ruleName(field), description].join(' ')}
                    onSelect={() => {
                      added.current = true
                      setOpen(false)
                      onAdd(field)
                    }}
                  >
                    {ruleName(field)}
                    {description ? (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {description}
                      </span>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// One rule per applied filter, rules added from Filters but not yet applied,
// Filters, and Clear all. A value applies on Enter, on leaving the rule, or on
// choosing an option, never per keystroke; every change returns to page 1.
export function RuleBar({
  filters,
  options,
  onNavigate
}: {
  filters: DomainTableFilters
  options: RuleOptions
  onNavigate: (href: string) => void
}) {
  const [drafts, setDrafts] = useState<Rule[]>([])
  const [focused, setFocused] = useState<RuleField | null>(null)
  const current = buildDomainTableHref(filters, { page: 1 })
  // Enter, then the blur a navigation causes, push one URL once.
  const pushed = useRef<{ from: string; to: string } | null>(null)

  const applied = rulesFromFilters(filters).filter(rule => rule.field !== 'query')
  const appliedFields = new Set(applied.map(rule => rule.field))
  // A draft gives way once its field is applied.
  if (drafts.some(rule => appliedFields.has(rule.field))) {
    setDrafts(drafts.filter(rule => !appliedFields.has(rule.field)))
  }
  const rules = [...applied, ...drafts.filter(rule => !appliedFields.has(rule.field))]
  const unused = RULE_FIELD_KEYS.filter(
    field => field !== 'query' && !rules.some(rule => rule.field === field)
  )

  const navigate = (next: DomainTableFilters) => {
    const href = buildDomainTableHref(next)
    if (href === current || (pushed.current?.from === current && pushed.current.to === href)) return
    pushed.current = { from: current, to: href }
    onNavigate(href)
  }

  return (
    <>
      {rules.map(rule => {
        const draft = !appliedFields.has(rule.field)
        return (
          <RuleEditor
            key={draft ? `${rule.field}:draft` : `${rule.field}:${rule.operator}:${rule.values}`}
            rule={rule}
            options={options[rule.field] ?? []}
            autoFocus={draft && focused === rule.field}
            onCommit={next => navigate(applyRule(filters, next))}
            onRemove={() => {
              setDrafts(drafts.filter(candidate => candidate.field !== rule.field))
              if (!draft) navigate(removeRule(filters, rule.field))
            }}
          />
        )
      })}
      <FieldsMenu
        fields={unused}
        onAdd={field => {
          const { kind, operators } = ruleField(field)
          const rule: Rule = { field, operator: operators[0], values: [] }
          if (kind === 'none') {
            navigate(applyRule(filters, rule))
            return
          }
          setFocused(field)
          setDrafts([...drafts, rule])
        }}
      />
      {hasActiveDomainTableFilters(filters) ? (
        <Link
          prefetch={false}
          href={buildDomainTableHref(parseDomainTableFilters({}), {
            sort: filters.sort,
            direction: filters.direction
          })}
          onClick={() => setDrafts([])}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          Clear all
        </Link>
      ) : null}
    </>
  )
}

// Facet options for the list rules, as the rule bar labels them.
export function ruleOptions({
  sources,
  auctionTypes,
  tlds
}: {
  sources: string[]
  auctionTypes: string[]
  tlds: string[]
}): RuleOptions {
  return {
    source: sources.map(value => ({ value, label: formatProvider(value) })),
    type: auctionTypes.map(value => ({ value, label: formatAuctionType(value) })),
    tld: tlds.map(value => ({ value, label: `.${value}` }))
  }
}
