'use client';

import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import {
  countAdvancedDomainTableFilters,
  hasActiveDomainTableFilters,
  type DomainTableFilters,
} from '@/domain/domain-table';
import {
  SearchableMultiSelect,
  type MultiSelectOption,
} from '@/components/searchable-multi-select';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
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

function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    dynadot: 'Dynadot',
    dropcatch: 'DropCatch',
    godaddy: 'GoDaddy',
    namecheap: 'Namecheap',
    namejet: 'NameJet',
    namesilo: 'NameSilo',
  };
  return labels[provider] ?? titleCase(provider);
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function majorMoney(cents?: number) {
  if (cents === undefined) return '';
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

const endingOptions = [
  ['', 'Any time'],
  ['1h', 'Next 1 hour'],
  ['6h', 'Next 6 hours'],
  ['24h', 'Next 24 hours'],
  ['3d', 'Next 3 days'],
  ['7d', 'Next 7 days'],
] as const;

function Field({
  id,
  label,
  name,
  defaultValue,
  prefix,
  max,
}: {
  id: string;
  label: string;
  name: string;
  defaultValue?: number;
  prefix?: string;
  max?: string | number;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
            {prefix}
          </span>
        ) : null}
        <Input
          id={id}
          form={FORM_ID}
          name={name}
          type="number"
          min="0"
          max={max ?? (prefix ? MAX_MONEY : MAX_INTEGER)}
          step={prefix ? '0.01' : '1'}
          inputMode={prefix ? 'decimal' : 'numeric'}
          autoComplete="off"
          defaultValue={
            defaultValue === undefined
              ? undefined
              : prefix
                ? majorMoney(defaultValue)
                : defaultValue
          }
          className={cn('h-11 sm:h-9', prefix && 'pl-7')}
        />
      </div>
    </div>
  );
}

function PreservedAdvancedFilters({
  filters,
}: {
  filters: DomainTableFilters;
}) {
  return (
    <>
      {filters.auctionTypes.map((type) => (
        <input key={type} type="hidden" name="type" value={type} />
      ))}
      {filters.domainLengthMin !== undefined ? (
        <input
          type="hidden"
          name="domainLengthMin"
          value={filters.domainLengthMin}
        />
      ) : null}
      {filters.domainLengthMax !== undefined ? (
        <input
          type="hidden"
          name="domainLengthMax"
          value={filters.domainLengthMax}
        />
      ) : null}
      {filters.ageMin !== undefined ? (
        <input type="hidden" name="ageMin" value={filters.ageMin} />
      ) : null}
      {filters.ageMax !== undefined ? (
        <input type="hidden" name="ageMax" value={filters.ageMax} />
      ) : null}
      {filters.noHyphens ? (
        <input type="hidden" name="noHyphens" value="1" />
      ) : null}
      {filters.noDigits ? (
        <input type="hidden" name="noDigits" value="1" />
      ) : null}
      {filters.priceMinCents !== undefined ? (
        <input
          type="hidden"
          name="priceMin"
          value={majorMoney(filters.priceMinCents)}
        />
      ) : null}
      {filters.renewalMaxCents !== undefined ? (
        <input
          type="hidden"
          name="renewalMax"
          value={majorMoney(filters.renewalMaxCents)}
        />
      ) : null}
      {filters.bidsMin !== undefined ? (
        <input type="hidden" name="bidsMin" value={filters.bidsMin} />
      ) : null}
      {filters.biddersMin !== undefined ? (
        <input type="hidden" name="biddersMin" value={filters.biddersMin} />
      ) : null}
      {filters.visitorsMin !== undefined ? (
        <input type="hidden" name="visitorsMin" value={filters.visitorsMin} />
      ) : null}
      {filters.linksMin !== undefined ? (
        <input type="hidden" name="linksMin" value={filters.linksMin} />
      ) : null}
      {filters.appraisalMinCents !== undefined ? (
        <input
          type="hidden"
          name="appraisalMin"
          value={majorMoney(filters.appraisalMinCents)}
        />
      ) : null}
    </>
  );
}

function RangeFields({
  legend,
  minimum,
  maximum,
}: {
  legend: string;
  minimum: React.ComponentProps<typeof Field>;
  maximum: React.ComponentProps<typeof Field>;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="grid grid-cols-2 gap-3">
        <Field {...minimum} />
        <Field {...maximum} />
      </div>
    </fieldset>
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
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold tracking-wide text-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
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
        <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3">
          <Checkbox
            form={FORM_ID}
            name="noHyphens"
            value="1"
            defaultChecked={filters.noHyphens}
          />
          No hyphens
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3">
          <Checkbox
            form={FORM_ID}
            name="noDigits"
            value="1"
            defaultChecked={filters.noDigits}
          />
          No digits
        </label>
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
  auctionTypeOptions: MultiSelectOption[];
  priceMax: string;
  setPriceMax: (value: string) => void;
  endingWithin: string;
  setEndingWithin: (value: string) => void;
}) {
  return (
    <FilterGroup title="Auction">
      <div className="space-y-1.5">
        <span className="block text-sm font-medium">Auction type</span>
        <SearchableMultiSelect
          form={FORM_ID}
          label="Auction type"
          name="type"
          options={auctionTypeOptions}
          defaultValues={filters.auctionTypes}
        />
      </div>
      <fieldset>
        <legend className="sr-only">Current bid</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="price-min"
            label="Minimum current bid"
            name="priceMin"
            defaultValue={filters.priceMinCents}
            prefix="$"
          />
          <div className="space-y-1.5">
            <label htmlFor="advanced-price-max" className="text-sm font-medium">
              Maximum current bid
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
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
                className="h-11 pl-7"
              />
            </div>
          </div>
        </div>
      </fieldset>
      <p className="-mt-3 text-xs text-muted-foreground">
        The maximum current bid is shared with the quick filter.
      </p>
      <Field
        id="renewal-max"
        label="Maximum renewal price"
        name="renewalMax"
        defaultValue={filters.renewalMaxCents}
        prefix="$"
      />
      <div className="space-y-1.5">
        <label htmlFor="advanced-ending-within" className="text-sm font-medium">
          Ending window
        </label>
        <select
          id="advanced-ending-within"
          value={endingWithin}
          onChange={(event) => setEndingWithin(event.target.value)}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {endingOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Shared with the quick Ending filter.
        </p>
      </div>
    </FilterGroup>
  );
}

function ActivityFilterGroup({ filters }: { filters: DomainTableFilters }) {
  return (
    <FilterGroup title="Activity">
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="bids-min"
          label="Minimum bids"
          name="bidsMin"
          defaultValue={filters.bidsMin}
        />
        <Field
          id="bidders-min"
          label="Minimum bidders"
          name="biddersMin"
          defaultValue={filters.biddersMin}
        />
        <Field
          id="visitors-min"
          label="Minimum visitors"
          name="visitorsMin"
          defaultValue={filters.visitorsMin}
        />
        <Field
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
      <Field
        id="appraisal-min"
        label="Minimum provider appraisal"
        name="appraisalMin"
        defaultValue={filters.appraisalMinCents}
        prefix="$"
      />
    </FilterGroup>
  );
}

function MetricsFilterGroup() {
  return (
    <FilterGroup title="Metrics">
      <div className="space-y-2">
        <div
          aria-disabled="true"
          className="rounded-lg border bg-muted/40 p-3 text-muted-foreground"
        >
          <p className="font-medium text-foreground/70">Ahrefs Domain Rating</p>
          <p className="mt-1 text-xs">
            Unavailable until Ahrefs enrichment is implemented.
          </p>
        </div>
        <div
          aria-disabled="true"
          className="rounded-lg border bg-muted/40 p-3 text-muted-foreground"
        >
          <p className="font-medium text-foreground/70">Majestic Topic</p>
          <p className="mt-1 text-xs">
            Unavailable until Majestic enrichment is implemented.
          </p>
        </div>
      </div>
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
  {
    minimum: 'priceMin',
    maximum: 'priceMax',
    label: 'current bid',
  },
] as const;

function RangeErrorMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      aria-live="assertive"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
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
  const [endingWithin, setEndingWithin] = useState(filters.endingWithin ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rangeError, setRangeError] = useState<string>();
  const sharedDraftAtOpen = useRef({ priceMax, endingWithin });
  const advancedCount = countAdvancedDomainTableFilters(filters);
  const sourceOptions: MultiSelectOption[] = sources.map((source) => ({
    value: source,
    label: providerLabel(source),
  }));
  const auctionTypeOptions: MultiSelectOption[] = auctionTypes.map((type) => ({
    value: type,
    label: titleCase(type),
  }));
  const tldOptions: MultiSelectOption[] = tlds.map((tld) => ({
    value: tld,
    label: `.${tld}`,
  }));

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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(15rem,1.5fr)_11rem_11rem_9rem_10rem_auto] xl:items-end">
        <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
          <label htmlFor="domain-query" className="text-sm font-medium">
            Domain contains
          </label>
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
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Auction source</span>
          <SearchableMultiSelect
            label="Auction source"
            name="source"
            options={sourceOptions}
            defaultValues={filters.sources}
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">TLD</span>
          <SearchableMultiSelect
            label="TLD"
            name="tld"
            options={tldOptions}
            defaultValues={filters.tlds}
            searchable
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="price-max" className="text-sm font-medium">
            Max current bid
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
              $
            </span>
            <Input
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
              className="h-11 pl-7 sm:h-8"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ending-within" className="text-sm font-medium">
            Ending
          </label>
          <select
            id="ending-within"
            name="endingWithin"
            value={endingWithin}
            onChange={(event) => setEndingWithin(event.target.value)}
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8"
          >
            {endingOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
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
              {advancedCount > 0 ? (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs leading-none text-primary-foreground">
                  {advancedCount}
                </span>
              ) : null}
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-2xl">
              <SheetHeader className="border-b pr-14">
                <SheetTitle>More filters</SheetTitle>
                <SheetDescription>
                  Narrow the current inventory. Changes run only when you apply
                  the form.
                </SheetDescription>
              </SheetHeader>
              {rangeError ? (
                <div className="px-4">
                  <RangeErrorMessage message={rangeError} />
                </div>
              ) : null}
              <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 pb-4">
                <DomainFilterGroup filters={filters} />
                <Separator />
                <AuctionFilterGroup
                  filters={filters}
                  auctionTypeOptions={auctionTypeOptions}
                  priceMax={priceMax}
                  setPriceMax={setPriceMax}
                  endingWithin={endingWithin}
                  setEndingWithin={setEndingWithin}
                />
                <Separator />
                <ActivityFilterGroup filters={filters} />
                <Separator />
                <ValueFilterGroup filters={filters} />
                <Separator />
                <MetricsFilterGroup />
              </div>
              <SheetFooter className="flex-row border-t bg-background">
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
