import {
  buildDomainTableHref,
  type DomainTableEndingWindow,
  type DomainTableFilters,
  formatAuctionType,
  formatProvider,
  parseDomainTableFilters,
  queryStringToSearchParams
} from '@/domain/domain-table'

// The rule bar edits the table's URL parameters as rules: a field, an
// operator, and values. Operators are only what the parameters express, so a
// rule always round-trips through the same parser as the URL.
export const RULE_OPERATOR_LABELS = {
  contains: 'contains',
  noHyphens: 'has no hyphens',
  noDigits: 'has no digits',
  anyOf: 'is any of',
  gte: '≥',
  lte: '≤',
  eq: '=',
  between: 'between',
  within: 'within'
} as const

export type RuleOperator = keyof typeof RULE_OPERATOR_LABELS

export const ENDING_WINDOW_LABELS: Record<DomainTableEndingWindow, string> = {
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
  '3d': '3 days',
  '7d': '7 days'
}

// How a rule's value is entered: free text, nothing (a flag), several known
// values, a whole number, a dollar amount, or an ending window.
export type RuleValueKind = 'text' | 'none' | 'list' | 'integer' | 'money' | 'window'

interface RuleFieldDefinition {
  label: string
  // The full name, for short labels.
  description?: string
  operators: readonly RuleOperator[]
  kind: RuleValueKind
  // One parameter, or a minimum and a maximum.
  params: readonly [string] | readonly [string, string]
}

const RANGE = ['gte', 'lte', 'eq', 'between'] as const

// In the order the bar shows rules and the Filters menu lists fields.
export const RULE_FIELDS = {
  query: { label: 'Domain', operators: ['contains'], kind: 'text', params: ['q'] },
  noHyphens: { label: 'Domain', operators: ['noHyphens'], kind: 'none', params: ['noHyphens'] },
  noDigits: { label: 'Domain', operators: ['noDigits'], kind: 'none', params: ['noDigits'] },
  source: { label: 'Source', operators: ['anyOf'], kind: 'list', params: ['source'] },
  type: { label: 'Type', operators: ['anyOf'], kind: 'list', params: ['type'] },
  tld: { label: 'TLD', operators: ['anyOf'], kind: 'list', params: ['tld'] },
  price: { label: 'Price', operators: RANGE, kind: 'money', params: ['priceMin', 'priceMax'] },
  endingWithin: {
    label: 'Ends',
    operators: ['within'],
    kind: 'window',
    params: ['endingWithin']
  },
  bids: { label: 'Bids', operators: ['gte'], kind: 'integer', params: ['bidsMin'] },
  domainLength: {
    label: 'Length',
    description: 'Characters, TLD included',
    operators: RANGE,
    kind: 'integer',
    params: ['domainLengthMin', 'domainLengthMax']
  },
  age: {
    label: 'Age',
    description: 'Years',
    operators: RANGE,
    kind: 'integer',
    params: ['ageMin', 'ageMax']
  },
  links: { label: 'Links', operators: ['gte'], kind: 'integer', params: ['linksMin'] },
  visitors: { label: 'Visitors', operators: ['gte'], kind: 'integer', params: ['visitorsMin'] },
  appraisal: { label: 'Appraisal', operators: ['gte'], kind: 'money', params: ['appraisalMin'] },
  renewal: { label: 'Renewal', operators: ['lte'], kind: 'money', params: ['renewalMax'] },
  majesticTf: {
    label: 'Majestic TF',
    description: 'Trust Flow',
    operators: ['gte'],
    kind: 'integer',
    params: ['majesticTfMin']
  },
  majesticCf: {
    label: 'Majestic CF',
    description: 'Citation Flow',
    operators: ['gte'],
    kind: 'integer',
    params: ['majesticCfMin']
  },
  majesticRefDomains: {
    label: 'Majestic ref. domains',
    description: 'Referring domains',
    operators: ['gte'],
    kind: 'integer',
    params: ['majesticRefDomainsMin']
  },
  semrushAs: {
    label: 'Semrush AS',
    description: 'Authority Score',
    operators: ['gte'],
    kind: 'integer',
    params: ['semrushAsMin']
  },
  domainRating: {
    label: 'Ahrefs DR',
    description: 'Domain Rating',
    operators: ['gte'],
    kind: 'integer',
    params: ['domainRatingMin']
  }
} as const satisfies Record<string, RuleFieldDefinition>

export type RuleField = keyof typeof RULE_FIELDS

export const RULE_FIELD_KEYS = Object.keys(RULE_FIELDS) as RuleField[]

// Values are the URL's own text: "12.50" dollars, "24h", or one entry per
// chosen source, type, or TLD. A between rule holds its minimum and maximum.
export interface Rule {
  field: RuleField
  operator: RuleOperator
  values: string[]
}

export function ruleField(field: RuleField): RuleFieldDefinition {
  return RULE_FIELDS[field]
}

function tableParams(filters: DomainTableFilters) {
  return new URLSearchParams(buildDomainTableHref(filters, { page: 1 }).slice('/?'.length))
}

// Every applied filter as a rule, in field order, read from the canonical URL.
export function rulesFromFilters(filters: DomainTableFilters): Rule[] {
  const params = tableParams(filters)
  const rules: Rule[] = []
  for (const field of RULE_FIELD_KEYS) {
    const { kind, operators, params: names } = ruleField(field)
    if (names.length === 2) {
      const [minimum, maximum] = names.map(name => params.get(name))
      if (minimum !== null && maximum !== null)
        rules.push(
          minimum === maximum
            ? { field, operator: 'eq', values: [minimum] }
            : { field, operator: 'between', values: [minimum, maximum] }
        )
      else if (minimum !== null) rules.push({ field, operator: 'gte', values: [minimum] })
      else if (maximum !== null) rules.push({ field, operator: 'lte', values: [maximum] })
      continue
    }
    const values = params.getAll(names[0])
    if (values.length === 0) continue
    rules.push({ field, operator: operators[0], values: kind === 'none' ? [] : values })
  }
  return rules
}

// The URL parameters a rule sets; blank values set nothing.
function ruleParams({ field, operator, values }: Rule): Array<[string, string]> {
  const { kind, params } = ruleField(field)
  const [minimum, maximum = minimum] = params
  if (kind === 'none') return [[minimum, '1']]
  const [first = '', second = ''] = values
  const pairs: Array<[string, string]> =
    operator === 'anyOf'
      ? values.map(value => [minimum, value])
      : operator === 'between'
        ? [
            [minimum, first],
            [maximum, second]
          ]
        : operator === 'eq'
          ? [
              [minimum, first],
              [maximum, first]
            ]
          : operator === 'lte'
            ? [[maximum, first]]
            : [[minimum, first]]
  return pairs.filter(([, value]) => value.trim() !== '')
}

function withFieldParams(
  filters: DomainTableFilters,
  field: RuleField,
  pairs: Array<[string, string]>
) {
  const params = tableParams(filters)
  for (const name of ruleField(field).params) params.delete(name)
  for (const [name, value] of pairs) params.append(name, value)
  return parseDomainTableFilters(queryStringToSearchParams(params.toString()))
}

// The filters with one field replaced by the rule, on page 1. The URL parser
// normalizes the values, so an invalid or blank value clears the field.
export function applyRule(filters: DomainTableFilters, rule: Rule): DomainTableFilters {
  return withFieldParams(filters, rule.field, ruleParams(rule))
}

export function removeRule(filters: DomainTableFilters, field: RuleField): DomainTableFilters {
  return withFieldParams(filters, field, [])
}

// A between rule waits for both ends; any other rule applies as it stands.
export function isRuleReady(rule: Rule) {
  if (rule.operator !== 'between') return true
  const filled = rule.values.filter(value => value.trim() !== '').length
  return filled !== 1
}

// The values a rule keeps when its operator changes: one value, or two for between.
export function changeRuleOperator(rule: Rule, operator: RuleOperator): Rule {
  const [first = '', second = ''] = rule.values
  if (operator === 'between')
    return { ...rule, operator, values: rule.operator === 'lte' ? ['', first] : [first, second] }
  // Leaving between keeps the end the new operator names.
  const kept = rule.operator === 'between' && operator === 'lte' ? second : first
  return { ...rule, operator, values: [kept] }
}

// A value as a person reads it: "$12.50", "GoDaddy", ".com", or "24 hours".
function describeValue(field: RuleField, value: string) {
  const { kind } = ruleField(field)
  if (kind === 'money') return `$${value}`
  if (kind === 'window') return ENDING_WINDOW_LABELS[value as DomainTableEndingWindow]
  if (field === 'source') return formatProvider(value)
  if (field === 'type') return formatAuctionType(value)
  if (field === 'tld') return `.${value}`
  return value
}

// A rule in words, for a saved view's suggested name: "Majestic TF ≥ 25",
// "Type is Auction", "Price between $10 and $50".
export function describeRule({ field, operator, values }: Rule) {
  const { label } = ruleField(field)
  const shown = values.map(value => describeValue(field, value))
  if (operator === 'noHyphens' || operator === 'noDigits')
    return `${label} ${RULE_OPERATOR_LABELS[operator]}`
  if (operator === 'between') return `${label} between ${shown[0]} and ${shown[1]}`
  if (operator === 'anyOf')
    return `${label} ${shown.length === 1 ? 'is' : 'is any of'} ${shown.join(', ')}`
  return `${label} ${RULE_OPERATOR_LABELS[operator]} ${shown[0]}`
}
