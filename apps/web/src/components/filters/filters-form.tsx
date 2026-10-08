'use client'

import { CircleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useCallback, useEffect, useReducer, useRef, useState } from 'react'

import {
  CheckboxGroupField,
  MultiSelectField,
  NumberField,
  RangeField,
  TextField
} from '@/components/filters/filter-fields'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  buildDomainTableHref,
  type DomainTableFilters,
  formatAuctionType,
  formatProvider,
  parseDomainTableFilters
} from '@/domain/domain-table'
import {
  countFiltersBySection,
  FILTER_SECTIONS,
  type FilterRange,
  type FilterSectionId,
  findInvalidRange,
  formDataToSearchParams,
  rangeErrorMessage
} from '@/domain/filter-form'
import { cn } from '@/lib/utils'

const ANY_TIME = 'any'
const ENDING_OPTIONS = [
  [ANY_TIME, 'Any time'],
  ['1h', '1 hour'],
  ['6h', '6 hours'],
  ['24h', '24 hours'],
  ['3d', '3 days'],
  ['7d', '7 days']
] as const

function Section({
  id,
  count,
  children
}: {
  id: FilterSectionId
  count: number
  children: React.ReactNode
}) {
  const section = FILTER_SECTIONS.find(item => item.id === id) as (typeof FILTER_SECTIONS)[number]
  return (
    <section id={`filters-${id}`} className="scroll-mt-16" aria-labelledby={`filters-${id}-title`}>
      <Card>
        <CardHeader>
          <CardTitle id={`filters-${id}-title`} className="flex items-center gap-2">
            {section.title}
            {count > 0 ? <Badge variant="secondary">{count}</Badge> : null}
          </CardTitle>
          <CardDescription>{section.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-5 gap-y-5 md:grid-cols-3">{children}</div>
        </CardContent>
      </Card>
    </section>
  )
}

export function FiltersForm({
  filters,
  sources,
  auctionTypes,
  tlds
}: {
  filters: DomainTableFilters
  sources: string[]
  auctionTypes: string[]
  tlds: string[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [endingWithin, setEndingWithin] = useState<string>(filters.endingWithin ?? ANY_TIME)
  const [counts, setCounts] = useState(() => countFiltersBySection(filters))
  const [invalidRange, setInvalidRange] = useState<FilterRange>()
  // Base UI comboboxes and checkboxes update hidden inputs without a form
  // event, so every control reports changes here and the form is read again.
  const [revision, changed] = useReducer((value: number) => value + 1, 0)
  const readForm = useCallback(() => {
    const params = formDataToSearchParams(new FormData(formRef.current as HTMLFormElement))
    return { params, filters: parseDomainTableFilters(params) }
  }, [])

  useEffect(() => {
    if (revision === 0) return
    const { params, filters: draft } = readForm()
    setCounts(countFiltersBySection(draft))
    setInvalidRange(findInvalidRange(params))
  }, [revision, readForm])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const { params, filters: draft } = readForm()
    const invalid = findInvalidRange(params)
    if (invalid) {
      setInvalidRange(invalid)
      return
    }
    router.push(buildDomainTableHref(draft, { page: 1 }))
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const rangeError = (range: FilterRange['label']) =>
    invalidRange?.label === range ? rangeErrorMessage(invalidRange) : undefined
  const sourceOptions = sources.map(value => ({ value, label: formatProvider(value) }))
  const typeOptions = auctionTypes.map(value => ({ value, label: formatAuctionType(value) }))
  const tldOptions = tlds.map(value => ({ value, label: `.${value}` }))
  const sectionLink = (id: FilterSectionId) => `#filters-${id}`

  return (
    <form
      ref={formRef}
      aria-label="All filters"
      className="flex min-h-[calc(100svh-3rem)] flex-col"
      onSubmit={submit}
      onChange={changed}
      onInput={changed}
    >
      <input type="hidden" name="sort" value={filters.sort} />
      <input type="hidden" name="direction" value={filters.direction} />
      {endingWithin === ANY_TIME ? null : (
        <input type="hidden" name="endingWithin" value={endingWithin} />
      )}

      <div className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-8 px-4 py-6 md:grid-cols-[12rem_minmax(0,1fr)] md:px-6">
        <nav aria-label="Filter sections" className="hidden md:block">
          <ul className="sticky top-6 grid gap-1">
            {FILTER_SECTIONS.map(section => (
              <li key={section.id}>
                <a
                  href={sectionLink(section.id)}
                  className={cn(
                    buttonVariants({ variant: 'ghost' }),
                    'w-full justify-between font-normal text-muted-foreground hover:text-foreground'
                  )}
                >
                  {section.title}
                  {counts[section.id] > 0 ? (
                    <Badge variant="secondary">{counts[section.id]}</Badge>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Filters</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Filters in different sections all have to match. Several values in Source, Auction
              type, or TLD match any of them.
            </p>
          </div>

          <nav aria-label="Jump to a section" className="-mx-4 overflow-x-auto px-4 md:hidden">
            <ul className="flex w-max gap-2">
              {FILTER_SECTIONS.map(section => (
                <li key={section.id}>
                  <a
                    href={sectionLink(section.id)}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'rounded-full'
                    )}
                  >
                    {section.title}
                    {counts[section.id] > 0 ? ` · ${counts[section.id]}` : null}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <Section id="general" count={counts.general}>
            <TextField
              id="filter-query"
              label="Domain contains"
              name="q"
              type="search"
              autoComplete="off"
              maxLength={253}
              placeholder="e.g. garden"
              defaultValue={filters.query}
              className="md:col-span-2"
            />
            <CheckboxGroupField
              label="Source"
              name="source"
              options={sourceOptions}
              defaultValues={filters.sources}
              onCheckedChange={changed}
            />
            <MultiSelectField
              id="filter-tld"
              label="TLD"
              name="tld"
              options={tldOptions}
              defaultValues={filters.tlds}
              placeholder={`Search ${tlds.length.toLocaleString('en-US')} TLDs`}
              onValueChange={changed}
              className="md:col-span-2"
            />
            <Field className="md:col-span-3">
              <FieldLabel id="filter-ending-label">Ends within</FieldLabel>
              <ToggleGroup
                variant="outline"
                spacing={0}
                aria-labelledby="filter-ending-label"
                value={[endingWithin]}
                onValueChange={value => {
                  setEndingWithin(value[0] ?? ANY_TIME)
                  changed()
                }}
                className="flex-wrap"
              >
                {ENDING_OPTIONS.map(([value, label]) => (
                  <ToggleGroupItem key={value} value={value}>
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          </Section>

          <Section id="auction" count={counts.auction}>
            <CheckboxGroupField
              label="Auction type"
              name="type"
              options={typeOptions}
              defaultValues={filters.auctionTypes}
              onCheckedChange={changed}
            />
            <RangeField
              label="Current bid"
              minimum={{
                id: 'filter-price-min',
                name: 'priceMin',
                defaultValue: filters.priceMinCents,
                money: true
              }}
              maximum={{
                id: 'filter-price-max',
                name: 'priceMax',
                defaultValue: filters.priceMaxCents,
                money: true
              }}
              error={rangeError('current bid')}
            />
            <NumberField
              id="filter-renewal-max"
              label="Max renewal price"
              name="renewalMax"
              defaultValue={filters.renewalMaxCents}
              money
            />
          </Section>

          <Section id="name" count={counts.name}>
            <RangeField
              label="Length (characters)"
              minimum={{
                id: 'filter-length-min',
                name: 'domainLengthMin',
                defaultValue: filters.domainLengthMin,
                max: 253
              }}
              maximum={{
                id: 'filter-length-max',
                name: 'domainLengthMax',
                defaultValue: filters.domainLengthMax,
                max: 253
              }}
              error={rangeError('domain length')}
            />
            <RangeField
              label="Age (years)"
              minimum={{ id: 'filter-age-min', name: 'ageMin', defaultValue: filters.ageMin }}
              maximum={{ id: 'filter-age-max', name: 'ageMax', defaultValue: filters.ageMax }}
              error={rangeError('domain age')}
            />
            <CheckboxGroupField
              label="Characters"
              options={[
                { value: 'noHyphens', name: 'noHyphens', label: 'No hyphens' },
                { value: 'noDigits', name: 'noDigits', label: 'No digits' }
              ]}
              defaultValues={[
                ...(filters.noHyphens ? ['noHyphens'] : []),
                ...(filters.noDigits ? ['noDigits'] : [])
              ]}
              onCheckedChange={changed}
            />
          </Section>

          <Section id="activity" count={counts.activity}>
            <NumberField
              id="filter-bids-min"
              label="Min bids"
              name="bidsMin"
              defaultValue={filters.bidsMin}
            />
            <NumberField
              id="filter-visitors-min"
              label="Min visitors"
              name="visitorsMin"
              defaultValue={filters.visitorsMin}
            />
            <NumberField
              id="filter-links-min"
              label="Min inbound links"
              name="linksMin"
              defaultValue={filters.linksMin}
            />
            <NumberField
              id="filter-appraisal-min"
              label="Min provider appraisal"
              name="appraisalMin"
              defaultValue={filters.appraisalMinCents}
              money
            />
          </Section>

          <Section id="seo" count={counts.seo}>
            <NumberField
              id="filter-tf-min"
              label="Min Majestic Trust Flow"
              name="majesticTfMin"
              defaultValue={filters.majesticTfMin}
              max={100}
              placeholder="0–100"
            />
            <NumberField
              id="filter-cf-min"
              label="Min Majestic Citation Flow"
              name="majesticCfMin"
              defaultValue={filters.majesticCfMin}
              max={100}
              placeholder="0–100"
            />
            <NumberField
              id="filter-ref-domains-min"
              label="Min Majestic referring domains"
              name="majesticRefDomainsMin"
              defaultValue={filters.majesticRefDomainsMin}
            />
            <NumberField
              id="filter-semrush-min"
              label="Min Semrush Authority Score"
              name="semrushAsMin"
              defaultValue={filters.semrushAsMin}
              max={100}
              placeholder="0–100"
            />
            <NumberField
              id="filter-domain-rating-min"
              label="Min Domain Rating by Ahrefs"
              name="domainRatingMin"
              defaultValue={filters.domainRatingMin}
              max={100}
              placeholder="0–100"
            />
          </Section>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 border-t bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center md:px-6">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {invalidRange ? (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <CircleAlertIcon className="size-4" aria-hidden="true" />
                Fix the {invalidRange.label} range to apply
              </span>
            ) : (
              `${total} ${total === 1 ? 'filter' : 'filters'} set`
            )}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
            <Link
              prefetch={false}
              href={`/filters/?sort=${filters.sort}&direction=${filters.direction}`}
              className={buttonVariants({ variant: 'ghost' })}
            >
              Reset all
            </Link>
            <Link
              prefetch={false}
              href={buildDomainTableHref(filters)}
              className={buttonVariants({ variant: 'outline' })}
            >
              Cancel
            </Link>
            <Button
              type="submit"
              disabled={Boolean(invalidRange)}
              className="order-first col-span-2 sm:order-none"
            >
              Show results
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}
