import { performance } from 'node:perf_hooks'

import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'

import { type DomainTableSearchParams, parseDomainTableFilters } from '../src/domain/domain-table'
import * as schema from '../src/server/db/schema'
import type { AppDatabase } from '../src/server/db/types'
import { queryDomainListingsWithDatabase } from '../src/server/queries/domain-listings-query'

// Times whole table requests through `queryDomainListingsWithDatabase`, the
// function the page calls, against the populated local D1 binding from
// `wrangler.jsonc`. Output is aggregate counts, timings, and query plans only;
// no domain rows are printed and no env or `.dev.vars` file is loaded.

const WARMUP_RUNS = 1
const MEASURED_RUNS = 5
const CONFIG = 'wrangler.jsonc'

const shapes: Array<{ name: string; searchParams: DomainTableSearchParams }> = [
  { name: 'default_page', searchParams: {} },
  { name: 'tld_com', searchParams: { tld: 'com' } },
  { name: 'tld_rare', searchParams: { tld: 'io' } },
  {
    name: 'domain_length_8_15',
    searchParams: { domainLengthMin: '8', domainLengthMax: '15' }
  },
  { name: 'domain_length_max_6', searchParams: { domainLengthMax: '6' } },
  {
    name: 'no_hyphen_no_digit',
    searchParams: { noHyphens: '1', noDigits: '1' }
  },
  {
    name: 'price_range_ending_window',
    searchParams: { priceMin: '1', priceMax: '500', endingWithin: '24h' }
  },
  {
    name: 'auction_type_bids',
    searchParams: { type: 'expired', bidsMin: '3', sort: 'bids' }
  },
  {
    name: 'links_min_sorted',
    searchParams: { linksMin: '10', sort: 'links', direction: 'desc' }
  },
  {
    name: 'substring_price',
    searchParams: { q: 'a', priceMax: '500', noHyphens: '1' }
  },
  { name: 'semrush_as_min', searchParams: { semrushAsMin: '20' } },
  { name: 'deep_page_links', searchParams: { sort: 'links', page: '2000' } },
  { name: 'sort_price', searchParams: { sort: 'price', direction: 'desc' } },
  { name: 'sort_majestic_tf', searchParams: { sort: 'majesticTf', direction: 'desc' } },
  { name: 'sort_semrush_as', searchParams: { sort: 'semrushAs', direction: 'desc' } },
  { name: 'sort_domain_rating', searchParams: { sort: 'domainRating', direction: 'desc' } },
  {
    name: 'sort_domain_rating_tld_com',
    searchParams: { tld: 'com', sort: 'domainRating', direction: 'desc' }
  }
]

type StatementTiming = {
  label: string
  sql: string
  params: unknown[]
  ms: number
}

function fixedError(code: string) {
  const error = new Error(code)
  error.stack = undefined
  return error
}

// A short, row-free description of a statement for the timing breakdown.
function statementLabel(sql: string) {
  const table = /from "([a-z_]+)"/.exec(sql)?.[1] ?? 'unknown'
  if (sql.startsWith('select count(*)')) return `count ${table}`
  if (sql.includes(' group by ')) return `group ${table}`
  if (sql.includes('max(')) return `max ${table}`
  return `select ${table}`
}

// Wraps the D1 binding so every statement Drizzle runs is timed end to end,
// including the local binding round trip.
function timedBinding(binding: D1Database, timings: StatementTiming[]) {
  const wrap = (
    statement: D1PreparedStatement,
    sql: string,
    params: unknown[]
  ): D1PreparedStatement => {
    const timed =
      <Result>(run: () => Promise<Result>) =>
      async () => {
        const started = performance.now()
        try {
          return await run()
        } finally {
          timings.push({
            label: statementLabel(sql),
            sql,
            params,
            ms: performance.now() - started
          })
        }
      }
    return {
      bind: (...values: unknown[]) => wrap(statement.bind(...values), sql, values),
      all: timed(() => statement.all()),
      run: timed(() => statement.run()),
      raw: ((options?: { columnNames?: boolean }) =>
        timed(() =>
          options?.columnNames ? statement.raw({ columnNames: true }) : statement.raw()
        )()) as D1PreparedStatement['raw'],
      first: ((column?: string) =>
        timed(() =>
          column === undefined ? statement.first() : statement.first(column)
        )()) as D1PreparedStatement['first']
    } as D1PreparedStatement
  }
  return {
    prepare: (sql: string) => wrap(binding.prepare(sql), sql, []),
    batch: binding.batch.bind(binding),
    exec: binding.exec.bind(binding)
  } as unknown as D1Database
}

function aggregate(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right)
  const round = (value: number) => Number(value.toFixed(1))
  return {
    min: round(sorted[0]!),
    median: round(sorted[Math.floor(sorted.length / 2)]!),
    mean: round(samples.reduce((total, value) => total + value, 0) / samples.length),
    max: round(sorted.at(-1)!)
  }
}

async function plan(binding: D1Database, statement: StatementTiming) {
  const result = await binding
    .prepare(`explain query plan ${statement.sql}`)
    .bind(...statement.params)
    .all<{ detail: string }>()
  return result.results.map(({ detail }) => detail)
}

async function main() {
  // Keep stdout to the JSON report: Wrangler would otherwise log the (empty)
  // env file it was given.
  process.env.WRANGLER_LOG ??= 'error'
  // A non-empty `envFiles` also stops Wrangler from loading `.dev.vars`.
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: CONFIG,
    envFiles: ['/dev/null'],
    remoteBindings: false
  })
  try {
    const binding = proxy.env.DB
    const inventory = await binding
      .prepare(
        `select
          (select count(*) from auction_listings) as total,
          (select count(*) from auction_listings where status = 'active') as active,
          (select max(completed_at) from ingestion_runs where status = 'succeeded') as latestSync`
      )
      .first<{ total: number; active: number; latestSync: number | null }>()
    if (!inventory) throw fixedError('filter_benchmark_failed')
    // The latest successful sync is a reproducible reference time for a given
    // inventory: every listing still open at the end of that sync is counted.
    const now = new Date(inventory.latestSync ?? Date.now())

    const timings: StatementTiming[] = []
    const database = drizzle(timedBinding(binding, timings), {
      schema
    }) as AppDatabase

    const benchmarks = []
    for (const shape of shapes) {
      const filters = parseDomainTableFilters(shape.searchParams)
      const requestSamples: number[] = []
      const statementSamples = new Map<string, number[]>()
      let firstRun: StatementTiming[] = []
      let total = 0
      let rows = 0
      for (let run = 0; run < WARMUP_RUNS + MEASURED_RUNS; run += 1) {
        timings.length = 0
        const started = performance.now()
        const result = await queryDomainListingsWithDatabase(filters, database, now)
        const elapsed = performance.now() - started
        total = result.total
        rows = result.rows.length
        if (run === 0) firstRun = [...timings]
        if (run < WARMUP_RUNS) continue
        requestSamples.push(elapsed)
        timings.forEach(({ label, ms }, index) => {
          const key = `${index + 1}. ${label}`
          statementSamples.set(key, [...(statementSamples.get(key) ?? []), ms])
        })
      }
      const [countStatement, rowStatement] = firstRun
      benchmarks.push({
        name: shape.name,
        searchParams: shape.searchParams,
        total,
        rows,
        statements: firstRun.length,
        requestMs: aggregate(requestSamples),
        statementMedianMs: Object.fromEntries(
          [...statementSamples].map(([key, samples]) => [key, aggregate(samples).median])
        ),
        countPlan: countStatement ? await plan(binding, countStatement) : [],
        rowPlan: rowStatement ? await plan(binding, rowStatement) : []
      })
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'succeeded',
          database: `local D1 via ${CONFIG}`,
          path: 'queryDomainListingsWithDatabase (the page request path)',
          output: 'aggregate counts, per-request and per-statement timings, and query plans only',
          referenceTime: now.toISOString(),
          warmupRuns: WARMUP_RUNS,
          measuredRuns: MEASURED_RUNS,
          inventory: { total: inventory.total, active: inventory.active },
          summary: Object.fromEntries(
            benchmarks.map(({ name, requestMs }) => [name, requestMs.median])
          ),
          benchmarks
        },
        null,
        2
      )}\n`
    )
  } finally {
    await proxy.dispose()
  }
}

main().catch(() => {
  process.stderr.write('filter_benchmark_failed\n')
  process.exitCode = 1
})
