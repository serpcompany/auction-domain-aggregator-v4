'use client'

import type * as React from 'react'

import { Checkbox } from '@/components/ui/checkbox'
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'

export type Option = { value: string; label: string }

const MAX_INTEGER = String(Number.MAX_SAFE_INTEGER)
const MAX_MONEY = '9999999999999.99'

function majorMoney(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

type NumberInputProps = {
  id: string
  name: string
  defaultValue?: number
  money?: boolean
  max?: number
  placeholder?: string
  invalid?: boolean
  'aria-label'?: string
}

function NumberInput({
  id,
  name,
  defaultValue,
  money = false,
  max,
  placeholder = 'Any',
  invalid = false,
  ...props
}: NumberInputProps) {
  const inputProps = {
    id,
    name,
    type: 'number',
    min: '0',
    max: max === undefined ? (money ? MAX_MONEY : MAX_INTEGER) : String(max),
    step: money ? '0.01' : '1',
    inputMode: money ? ('decimal' as const) : ('numeric' as const),
    autoComplete: 'off',
    placeholder,
    'aria-invalid': invalid || undefined,
    'aria-label': props['aria-label'],
    defaultValue:
      defaultValue === undefined ? undefined : money ? majorMoney(defaultValue) : defaultValue
  }
  if (!money) return <Input {...inputProps} />
  return (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>$</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput {...inputProps} />
    </InputGroup>
  )
}

export function NumberField({
  label,
  className,
  ...props
}: NumberInputProps & { label: string; className?: string }) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={props.id}>{label}</FieldLabel>
      <NumberInput {...props} />
    </Field>
  )
}

// A minimum and maximum shown as one field.
export function RangeField({
  label,
  minimum,
  maximum,
  error
}: {
  label: string
  minimum: Omit<NumberInputProps, 'aria-label' | 'placeholder' | 'invalid'>
  maximum: Omit<NumberInputProps, 'aria-label' | 'placeholder' | 'invalid'>
  error?: string
}) {
  return (
    <FieldSet data-invalid={error ? true : undefined}>
      <FieldLegend variant="label">{label}</FieldLegend>
      <div className="flex items-center gap-2">
        <NumberInput
          {...minimum}
          placeholder="Min"
          aria-label={`Minimum ${label.toLowerCase()}`}
          invalid={Boolean(error)}
        />
        <span className="text-muted-foreground" aria-hidden="true">
          –
        </span>
        <NumberInput
          {...maximum}
          placeholder="Max"
          aria-label={`Maximum ${label.toLowerCase()}`}
          invalid={Boolean(error)}
        />
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </FieldSet>
  )
}

export function CheckboxGroupField({
  label,
  name,
  options,
  defaultValues,
  onCheckedChange
}: {
  label: string
  name?: string
  options: Array<Option & { name?: string }>
  defaultValues: string[]
  onCheckedChange: () => void
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">{label}</FieldLegend>
      <FieldGroup className="flex-row flex-wrap gap-x-5 gap-y-3">
        {options.map(option => {
          const id = `${option.name ?? name}-${option.value}`
          return (
            <Field key={id} orientation="horizontal" className="w-auto">
              <Checkbox
                id={id}
                name={option.name ?? name}
                value={option.name ? '1' : option.value}
                defaultChecked={defaultValues.includes(option.value)}
                onCheckedChange={onCheckedChange}
              />
              <FieldLabel htmlFor={id} className="font-normal">
                {option.label}
              </FieldLabel>
            </Field>
          )
        })}
      </FieldGroup>
    </FieldSet>
  )
}

// A multi-value filter on the stock combobox. Base UI submits one hidden input
// per selected value, so the form receives repeated parameters.
export function MultiSelectField({
  id,
  label,
  name,
  options,
  defaultValues,
  placeholder,
  onValueChange,
  className
}: {
  id: string
  label: string
  name: string
  options: Option[]
  defaultValues: string[]
  placeholder: string
  onValueChange: () => void
  className?: string
}) {
  const anchor = useComboboxAnchor()
  // Keep selected values visible even when the facet no longer lists them.
  const labels = new Map(options.map(option => [option.value, option.label]))
  const items = [
    ...options.map(option => option.value),
    ...defaultValues.filter(value => !labels.has(value))
  ]
  const labelFor = (value: string) => labels.get(value) ?? value

  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Combobox
        multiple
        items={items}
        defaultValue={defaultValues}
        itemToStringLabel={labelFor}
        name={name}
        onValueChange={onValueChange}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(values: string[]) => (
              <>
                {values.map(value => (
                  <ComboboxChip key={value}>{labelFor(value)}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  id={id}
                  aria-label={label}
                  placeholder={values.length === 0 ? placeholder : ''}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
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
    </Field>
  )
}

export function TextField({
  id,
  label,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { id: string; label: string }) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} />
    </Field>
  )
}
