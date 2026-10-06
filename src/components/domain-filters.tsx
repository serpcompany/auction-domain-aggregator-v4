'use client';

import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import {
  countAdvancedDomainTableFilters,
  formatProvider,
  hasActiveDomainTableFilters,
  type DomainTableFilters,
} from '@/domain/domain-table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  useComboboxAnchor,
} from '@/components/ui/combobox';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const FORM_ID = 'domain-filters';
const MAX_INTEGER = String(Number.MAX_SAFE_INTEGER);
const MAX_MONEY = '9999999999999.99';
const ANY_TIME = 'any';

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function majorMoney(cents?: number) {
  if (cents === undefined) return '';
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

const endingOptions = [
  [ANY_TIME, 'Any time'],
  ['1h', 'Next 1 hour'],
  ['6h', 'Next 6 hours'],
  ['24h', 'Next 24 hours'],
  ['3d', 'Next 3 days'],
  ['7d', 'Next 7 days'],
] as const;
const endingLabels: Record<string, string> = Object.fromEntries(endingOptions);

type Option = { value: string; label: string };

// A multi-value filter built from the stock combobox. Base UI submits one
// hidden input per selected value, so the GET form receives repeated params.
function MultiSelectField({
  id,
  label,
  name,
  options,
  defaultValues,
  placeholder,
  form,
}: {
  id: string;
  label: string;
  name: string;
  options: Option[];
  defaultValues: string[];
  placeholder: string;
  form?: string;
}) {
  const anchor = useComboboxAnchor();
  // Keep selected values visible even when the facet no longer lists them.
  const labels = new Map(options.map((option) => [option.value, option.label]));
  const items = [
    ...options.map((option) => option.value),
    ...defaultValues.filter((value) => !labels.has(value)),
  ];
  const labelFor = (value: string) => labels.get(value) ?? value;

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Combobox
        multiple
        items={items}
        defaultValue={defaultValues}
        itemToStringLabel={labelFor}
        name={name}
        form={form}
      >
        <ComboboxChips ref={anchor} className="min-h-11 sm:min-h-8">
          <ComboboxValue>
            {(values: string[]) => (
              <>
                {values.map((value) => (
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
  );
}

function NumberField({
  id,
  label,
  name,
  defaultValue,
  money = false,
  max,
}: {
  id: string;
  label: string;
  name: string;
  defaultValue?: number;
  money?: boolean;
  max?: string | number;
}) {
  const inputProps = {
    id,
    form: FORM_ID,
    name,
    type: 'number',
    min: '0',
    max: max ?? (money ? MAX_MONEY : MAX_INTEGER),
    step: money ? '0.01' : '1',
    inputMode: money ? ('decimal' as const) : ('numeric' as const),
    autoComplete: 'off',
    defaultValue:
      defaultValue === undefined
        ? undefined
        : money
          ? majorMoney(defaultValue)
          : defaultValue,
  };
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {money ? <MoneyInput {...inputProps} /> : <Input {...inputProps} />}
    </Field>
  );
}

function MoneyInput(props: React.ComponentProps<typeof InputGroupInput>) {
  return (
    <InputGroup className="h-11 sm:h-9">
      <InputGroupAddon>
        <InputGroupText>$</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput {...props} />
    </InputGroup>
  );
}

function EndingSelect({
  id,
  value,
  onValueChange,
  submit,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  submit: boolean;
}) {
  return (
    <Select
      value={value || ANY_TIME}
      onValueChange={(next) =>
        onValueChange(next === ANY_TIME ? '' : String(next))
      }
      // "Any time" submits nothing, so the URL stays canonical.
      name={submit && value ? 'endingWithin' : undefined}
      items={endingLabels}
    >
      <SelectTrigger
        id={id}
        className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-8"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {endingOptions.map(([optionValue, label]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Advanced values submit through hidden inputs while the sheet is closed.
function PreservedAdvancedFilters({
  filters,
}: {
  filters: DomainTableFilters;
}) {
  const scalar: Array<[string, string | number | undefined]> = [
    ['domainLengthMin', filters.domainLengthMin],
    ['domainLengthMax', filters.domainLengthMax],
    ['ageMin', filters.ageMin],
    ['ageMax', filters.ageMax],
    ['noHyphens', filters.noHyphens ? '1' : undefined],
    ['noDigits', filters.noDigits ? '1' : undefined],
    [
      'priceMin',
      filters.priceMinCents === undefined
        ? undefined
        : majorMoney(filters.priceMinCents),
    ],
    [
      'renewalMax',
      filters.renewalMaxCents === undefined
        ? undefined
        : majorMoney(filters.renewalMaxCents),
    ],
    ['bidsMin', filters.bidsMin],
    ['biddersMin', filters.biddersMin],
    ['visitorsMin', filters.visitorsMin],
    ['linksMin', filters.linksMin],
    [
      'appraisalMin',
      filters.appraisalMinCents === undefined
        ? undefined
        : majorMoney(filters.appraisalMinCents),
    ],
  ];
  return (
    <>
      {filters.auctionTypes.map((type) => (
        <input key={type} type="hidden" name="type" value={type} />
      ))}
      {scalar.map(([name, value]) =>
        value === undefined ? null : (
          <input key={name} type="hidden" name={name} value={value} />
        ),
      )}
    </>
  );
}

function RangeFields({
  legend,
  minimum,
  maximum,
}: {
  legend: string;
  minimum: React.ComponentProps<typeof NumberField>;
  maximum: React.ComponentProps<typeof NumberField>;
}) {
  return (
    <FieldSet>
      <FieldLegend className="sr-only">{legend}</FieldLegend>
      <div className="grid grid-cols-2 gap-3">
        <NumberField {...minimum} />
        <NumberField {...maximum} />
      </div>
    </FieldSet>
  );
}

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <FieldSet className="min-w-0 rounded-xl border bg-card p-4">
      <FieldLegend>{title}</FieldLegend>
      <FieldGroup className="gap-4">{children}</FieldGroup>
    </FieldSet>
  );
}

function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <FieldLabel className="min-h-11 w-full rounded-lg border px-3">
      <Checkbox
        form={FORM_ID}
        name={name}
        value="1"
        defaultChecked={defaultChecked}
      />
      {label}
    </FieldLabel>
  );
}

function DomainFilterGroup({ filters }: { filters: DomainTableFilters }) {
  return (
    <FilterGroup title="Domain">
      <RangeFields
        legend="Domain length"
        minimum={{
          id: 'domain-length-min',
          label: 'Minimum length',
          name: 'domainLengthMin',
          defaultValue: filters.domainLengthMin,
          max: 253,
        }}
        maximum={{
          id: 'domain-length-max',
          label: 'Maximum length',
          name: 'domainLengthMax',
          defaultValue: filters.domainLengthMax,
          max: 253,
        }}
      />
      <RangeFields
        legend="Domain age"
        minimum={{
          id: 'age-min',
          label: 'Minimum age',
          name: 'ageMin',
          defaultValue: filters.ageMin,
        }}
        maximum={{
          id: 'age-max',
          label: 'Maximum age',
          name: 'ageMax',
          defaultValue: filters.ageMax,
        }}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <CheckboxField
          name="noHyphens"
          label="No hyphens"
          defaultChecked={filters.noHyphens}
        />
        <CheckboxField
          name="noDigits"
          label="No digits"
          defaultChecked={filters.noDigits}
        />
      </div>
    </FilterGroup>
  );
}

function AuctionFilterGroup({
  filters,
  auctionTypeOptions,
  priceMax,
  setPriceMax,
  endingWithin,
  setEndingWithin,
}: {
  filters: DomainTableFilters;
  auctionTypeOptions: Option[];
  priceMax: string;
  setPriceMax: (value: string) => void;
  endingWithin: string;
  setEndingWithin: (value: string) => void;
}) {
  return (
    <FilterGroup title="Auction">
      <MultiSelectField
        id="advanced-auction-type"
        label="Auction type"
        name="type"
        form={FORM_ID}
        options={auctionTypeOptions}
        defaultValues={filters.auctionTypes}
        placeholder="Any auction type"
      />
      <FieldSet>
        <FieldLegend className="sr-only">Current bid</FieldLegend>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            id="price-min"
            label="Minimum current bid"
            name="priceMin"
            defaultValue={filters.priceMinCents}
            money
          />
          <Field>
            <FieldLabel htmlFor="advanced-price-max">
              Maximum current bid
            </FieldLabel>
            <MoneyInput
              id="advanced-price-max"
              form={FORM_ID}
              name="priceMax"
              type="number"
              min="0"
              max={MAX_MONEY}
              step="0.01"
              inputMode="decimal"
              autoComplete="off"
              value={priceMax}
              onChange={(event) => setPriceMax(event.target.value)}
            />
          </Field>
        </div>
        <FieldDescription>
          The maximum current bid is shared with the quick filter.
        </FieldDescription>
      </FieldSet>
      <NumberField
        id="renewal-max"
        label="Maximum renewal price"
        name="renewalMax"
        defaultValue={filters.renewalMaxCents}
        money
      />
      <Field>
        <FieldLabel htmlFor="advanced-ending-within">Ending window</FieldLabel>
        <EndingSelect
          id="advanced-ending-within"
          value={endingWithin}
          onValueChange={setEndingWithin}
          submit={false}
        />
        <FieldDescription>
          Shared with the quick Ending filter.
        </FieldDescription>
      </Field>
    </FilterGroup>
  );
}

function ActivityFilterGroup({ filters }: { filters: DomainTableFilters }) {
  return (
    <FilterGroup title="Activity">
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id="bids-min"
          label="Minimum bids"
          name="bidsMin"
          defaultValue={filters.bidsMin}
        />
        <NumberField
          id="bidders-min"
          label="Minimum bidders"
          name="biddersMin"
          defaultValue={filters.biddersMin}
        />
        <NumberField
          id="visitors-min"
          label="Minimum visitors"
          name="visitorsMin"
          defaultValue={filters.visitorsMin}
        />
        <NumberField
          id="links-min"
          label="Minimum inbound links"
          name="linksMin"
          defaultValue={filters.linksMin}
        />
      </div>
    </FilterGroup>
  );
}

function ValueFilterGroup({ filters }: { filters: DomainTableFilters }) {
  return (
    <FilterGroup title="Value">
      <NumberField
        id="appraisal-min"
        label="Minimum provider appraisal"
        name="appraisalMin"
        defaultValue={filters.appraisalMinCents}
        money
      />
    </FilterGroup>
  );
}

function formNumber(data: FormData, name: string) {
  const value = data.get(name);
  if (!value) return undefined;
  return Number(value);
}

const rangeRules = [
  {
    minimum: 'domainLengthMin',
    maximum: 'domainLengthMax',
    label: 'domain length',
  },
  { minimum: 'ageMin', maximum: 'ageMax', label: 'domain age' },
  { minimum: 'priceMin', maximum: 'priceMax', label: 'current bid' },
] as const;

function RangeErrorMessage({ message }: { message: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function DomainFilters({
  filters,
  sources,
  auctionTypes,
  tlds,
}: {
  filters: DomainTableFilters;
  sources: string[];
  auctionTypes: string[];
  tlds: string[];
}) {
  const [priceMax, setPriceMax] = useState(majorMoney(filters.priceMaxCents));
  const [endingWithin, setEndingWithin] = useState<string>(
    filters.endingWithin ?? '',
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rangeError, setRangeError] = useState<string>();
  const sharedDraftAtOpen = useRef({ priceMax, endingWithin });
  const advancedCount = countAdvancedDomainTableFilters(filters);
  const sourceOptions = sources.map((source) => ({
    value: source,
    label: formatProvider(source),
  }));
  const auctionTypeOptions = auctionTypes.map((type) => ({
    value: type,
    label: titleCase(type),
  }));
  const tldOptions = tlds.map((tld) => ({ value: tld, label: `.${tld}` }));

  const clearRangeError = () => {
    setRangeError(undefined);
    document
      .querySelectorAll(
        `[form="${FORM_ID}"][aria-invalid="true"], #${FORM_ID} [aria-invalid="true"]`,
      )
      .forEach((element) => element.removeAttribute('aria-invalid'));
  };

  const validateRanges = (event: FormEvent<HTMLFormElement>) => {
    clearRangeError();
    const data = new FormData(event.currentTarget);
    const invalid = rangeRules.find((rule) => {
      const minimum = formNumber(data, rule.minimum);
      const maximum = formNumber(data, rule.maximum);
      return (
        minimum !== undefined && maximum !== undefined && minimum > maximum
      );
    });
    if (!invalid) return;

    event.preventDefault();
    setRangeError(
      `Minimum ${invalid.label} cannot exceed maximum ${invalid.label}. Lower the minimum or raise the maximum.`,
    );
    const visibleInput = (name: string) =>
      [
        ...document.querySelectorAll<HTMLInputElement>(
          `[name="${name}"][form="${FORM_ID}"], #${FORM_ID} [name="${name}"]`,
        ),
      ].find((input) => input.type !== 'hidden');
    const target =
      visibleInput(invalid.minimum) ?? visibleInput(invalid.maximum);
    target?.setAttribute('aria-invalid', 'true');
    target?.focus();
  };

  const setAdvancedSheetOpen = (open: boolean) => {
    if (open) {
      sharedDraftAtOpen.current = { priceMax, endingWithin };
    } else {
      setPriceMax(sharedDraftAtOpen.current.priceMax);
      setEndingWithin(sharedDraftAtOpen.current.endingWithin);
      clearRangeError();
    }
    setAdvancedOpen(open);
  };

  return (
    <form
      id={FORM_ID}
      action="/"
      method="get"
      className="space-y-4"
      aria-label="Domain filters"
      onSubmit={validateRanges}
      onInput={clearRangeError}
      onChange={clearRangeError}
    >
      <input type="hidden" name="sort" value={filters.sort} />
      <input type="hidden" name="direction" value={filters.direction} />
      {!advancedOpen ? <PreservedAdvancedFilters filters={filters} /> : null}
      {rangeError && !advancedOpen ? (
        <RangeErrorMessage message={rangeError} />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(15rem,1.5fr)_14rem_14rem_9rem_10rem_auto] xl:items-end">
        <Field className="md:col-span-2 xl:col-span-1">
          <FieldLabel htmlFor="domain-query">Domain contains</FieldLabel>
          <Input
            id="domain-query"
            name="q"
            type="search"
            autoComplete="off"
            maxLength={253}
            defaultValue={filters.query}
            placeholder="e.g. garden…"
            className="h-11 sm:h-8"
          />
        </Field>
        <MultiSelectField
          id="auction-source"
          label="Auction source"
          name="source"
          options={sourceOptions}
          defaultValues={filters.sources}
          placeholder="Any auction source"
        />
        <MultiSelectField
          id="tld"
          label="TLD"
          name="tld"
          options={tldOptions}
          defaultValues={filters.tlds}
          placeholder="Any TLD"
        />
        <Field>
          <FieldLabel htmlFor="price-max">Max current bid</FieldLabel>
          <MoneyInput
            id="price-max"
            name="priceMax"
            type="number"
            min="0"
            max={MAX_MONEY}
            step="0.01"
            inputMode="decimal"
            autoComplete="off"
            value={priceMax}
            disabled={advancedOpen}
            onChange={(event) => setPriceMax(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="ending-within">Ending</FieldLabel>
          <EndingSelect
            id="ending-within"
            value={endingWithin}
            onValueChange={setEndingWithin}
            submit
          />
        </Field>
        <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-1 xl:flex-nowrap">
          <Sheet open={advancedOpen} onOpenChange={setAdvancedSheetOpen}>
            <SheetTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 sm:h-8 xl:flex-none"
                />
              }
            >
              <SlidersHorizontal aria-hidden="true" />
              More filters
              {advancedCount > 0 ? <Badge>{advancedCount}</Badge> : null}
            </SheetTrigger>
            {/* The base sheet caps side panels at max-w-sm; this one holds a
                page worth of filters. */}
            <SheetContent className="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-none lg:data-[side=right]:w-[min(1280px,94vw)]">
              <SheetHeader className="border-b px-6 pr-14">
                <SheetTitle>More filters</SheetTitle>
                <SheetDescription>
                  Narrow the current inventory. Changes run only when you apply
                  the form.
                </SheetDescription>
              </SheetHeader>
              {rangeError ? (
                <div className="px-6">
                  <RangeErrorMessage message={rangeError} />
                </div>
              ) : null}
              <div className="grid flex-1 content-start gap-4 overflow-y-auto overscroll-contain px-6 pb-6 md:grid-cols-2 xl:grid-cols-4">
                <DomainFilterGroup filters={filters} />
                <AuctionFilterGroup
                  filters={filters}
                  auctionTypeOptions={auctionTypeOptions}
                  priceMax={priceMax}
                  setPriceMax={setPriceMax}
                  endingWithin={endingWithin}
                  setEndingWithin={setEndingWithin}
                />
                <ActivityFilterGroup filters={filters} />
                <ValueFilterGroup filters={filters} />
              </div>
              <SheetFooter className="flex-row justify-end border-t px-6 sm:[&>*]:max-w-48">
                <SheetClose
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 flex-1"
                    />
                  }
                >
                  Dismiss
                </SheetClose>
                <Button type="submit" form={FORM_ID} className="h-11 flex-1">
                  Apply filters
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
          <Button type="submit" className="h-11 flex-1 sm:h-8 xl:flex-none">
            Apply filters
          </Button>
          {hasActiveDomainTableFilters(filters) ? (
            <Link
              prefetch={false}
              href="/"
              className={cn(
                buttonVariants({ variant: 'ghost' }),
                'h-11 flex-1 sm:h-8 xl:flex-none',
              )}
            >
              Clear all
            </Link>
          ) : null}
        </div>
      </div>
    </form>
  );
}
