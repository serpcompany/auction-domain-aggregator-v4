import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DOMAIN_TABLE_CATEGORY_VALUE_LIMIT,
  DOMAIN_TABLE_SORTS,
  type DomainTableSearchParams,
  parseDomainTableFilters
} from '../../domain/domain-table'
import { refreshListingFacetsQueries } from '../db/listing-facets'
import * as schema from '../db/schema'
import { auctionListings, domainMetrics, domainSeoMetrics, domains } from '../db/schema'
import { createD1IngestionStorage } from '../ingestion/d1-storage'
import type { NormalizedSeoMetrics } from '../providers/types'
import { type TestDatabase, testDatabase, testEnv } from '../test-database'
import {
  godaddyListing,
  listing,
  QUERY_NOW,
  queryAt,
  REPEATED_COMPLETED_AT,
  seedProofInventory,
  statusAt
} from '../test-listings'
import {
  queryDomainListingsWithDatabase,
  queryInventoryStatusWithDatabase,
  queryListingFacetsWithDatabase
} from './domain-listings-query'

const FIXTURE_SEEN_AT = new Date('2026-07-13T04:00:00.000Z')
const RANKED_DOMAINS = ['rank-a-long.test', 'rank-b.co', 'rank-cccc.com', 'rank-dd.org']
const TIE_DOMAIN = 'tie-domain.test'

const METRIC_SORT_KEYS: ReadonlyArray<(typeof DOMAIN_TABLE_SORTS)[number]> = [
  'majesticTf',
  'majesticCf',
  'majesticRefDomains',
  'semrushAs',
  'domainRating'
]

const ids = (result: { rows: { externalId: string }[] }) =>
  result.rows.map(({ externalId }) => externalId)

// Four listings of four providers whose every sortable value differs (with one null per
// nullable column), and three identical listings of one domain that only the tie-breakers order.
async function seedRankedListings(database: TestDatabase) {
  await database
    .insert(domains)
    .values([...RANKED_DOMAINS, TIE_DOMAIN].map(name => ({ name, firstSeenAt: FIXTURE_SEEN_AT })))
  const rankedProviders = ['dynadot', 'godaddy', 'namecheap', 'namesilo']
  const rankedListings = RANKED_DOMAINS.map((domainName, index) => ({
    provider: rankedProviders[index] ?? '',
    externalId: `rank-${index}`,
    domainName,
    auctionUrl: `https://example.invalid/rank/${index}`,
    auctionType: index === 1 ? 'CLOSEOUT' : index === 3 ? 'AUCTION' : 'EXPIRED',
    currency: 'USD',
    currentBidCents: [300, 100, 400, 200][index] ?? 0,
    bidCount: [4, 2, 1, 3][index] ?? 0,
    bidderCount: [2, 4, 3, 1][index] ?? 0,
    startsAt: null,
    endsAt: new Date(`2026-07-14T${String([8, 5, 7, 6][index]).padStart(2, '0')}:00:00.000Z`),
    ageYears: [3, 1, null, 2][index] ?? null,
    inboundLinks: [null, 30, 10, 20][index] ?? null,
    visitors: [20, null, 30, 10][index] ?? null,
    appraisalCents: [4_000, 1_000, 3_000, null][index] ?? null,
    renewalPriceCents: [1_000, 4_000, null, 2_000][index] ?? null,
    status: 'active' as const,
    firstSeenAt: FIXTURE_SEEN_AT,
    lastSeenAt: FIXTURE_SEEN_AT
  }))
  const tieListings = [
    { provider: 'dynadot', externalId: 'tie-b' },
    { provider: 'dynadot', externalId: 'tie-a' },
    { provider: 'godaddy', externalId: 'tie-godaddy' }
  ].map(({ provider, externalId }) => ({
    provider,
    externalId,
    domainName: TIE_DOMAIN,
    auctionUrl: `https://example.invalid/tie/${externalId}`,
    auctionType: 'EXPIRED',
    currency: 'USD',
    currentBidCents: 777,
    bidCount: 7,
    bidderCount: 7,
    startsAt: null,
    endsAt: new Date('2026-07-15T07:00:00.000Z'),
    ageYears: 7,
    inboundLinks: 70,
    visitors: 70,
    appraisalCents: 7_000,
    renewalPriceCents: 700,
    status: 'active' as const,
    firstSeenAt: FIXTURE_SEEN_AT,
    lastSeenAt: FIXTURE_SEEN_AT
  }))
  await database.insert(auctionListings).values(rankedListings)
  await database.insert(auctionListings).values(tieListings)
  // One metric missing per ranked domain, so every metric sort proves nulls last.
  await database.insert(domainSeoMetrics).values(
    RANKED_DOMAINS.map((domainName, index) => ({
      domainName,
      source: 'godaddy',
      majesticTf: [12, 40, 25, null][index] ?? null,
      majesticCf: [null, 5, 30, 18][index] ?? null,
      majesticBacklinks: null,
      majesticRefDomains: [100, null, 3, 50][index] ?? null,
      semrushAs: [7, 9, null, 2][index] ?? null,
      semrushRefDomains: null,
      semrushBacklinks: null,
      updatedAt: FIXTURE_SEEN_AT
    }))
  )
  // rank-1 has no Ahrefs rating; rank-3 was never fetched.
  await database.insert(domainMetrics).values([
    {
      domainName: 'rank-a-long.test',
      metric: 'ahrefs_dr',
      status: 'ok',
      value: 31.5,
      fetchedAt: FIXTURE_SEEN_AT
    },
    {
      domainName: 'rank-b.co',
      metric: 'ahrefs_dr',
      status: 'not_found',
      value: null,
      fetchedAt: FIXTURE_SEEN_AT
    },
    {
      domainName: 'rank-cccc.com',
      metric: 'ahrefs_dr',
      status: 'ok',
      value: 8,
      fetchedAt: FIXTURE_SEEN_AT
    }
  ])
  return rankedListings
}

describe('domain listings read model on D1', () => {
  let database: TestDatabase
  let query: ReturnType<typeof queryAt>
  let status: ReturnType<typeof statusAt>

  beforeEach(async () => {
    database = testDatabase()
    query = queryAt(database)
    status = statusAt(database)
    await seedProofInventory(database)
  })

  it('filters, counts, pages, and sorts the synced inventory', async () => {
    const filtered = await query({
      q: 'filter-target',
      source: 'dynadot',
      sort: 'domain',
      direction: 'asc'
    })
    expect(filtered.total).toBe(1)
    expect(filtered.rows).toHaveLength(1)

    const firstPage = await query({ source: 'dynadot', sort: 'price', direction: 'desc' })
    const secondPage = await query({
      source: 'dynadot',
      sort: 'price',
      direction: 'desc',
      page: '2'
    })
    expect(firstPage.total).toBe(51)
    expect(firstPage.rows).toHaveLength(50)
    expect(firstPage.rows[0]?.currentBidCents).toBe(5_100)
    expect(secondPage.page).toBe(2)
    expect(secondPage.rows).toHaveLength(1)
    expect(secondPage.rows[0]?.currentBidCents).toBe(104)
    const inventory = await status()
    expect(inventory.sources).toEqual(['dynadot'])
    expect(inventory.auctionTypes).toEqual(['expired'])
    expect(inventory.tlds).toEqual(['com', 'net', 'org', 'test'])
    expect(inventory.latestSuccessfulSync).toEqual(REPEATED_COMPLETED_AT)
  })

  it('applies every filter family at once and returns the full row shape', async () => {
    const everyFilter = await query({
      q: 'garden',
      source: ['dynadot', 'unsupported'],
      type: ['expired', 'unsupported'],
      tld: ['com', 'org'],
      domainLengthMin: '5',
      domainLengthMax: '12',
      noHyphens: '1',
      noDigits: '1',
      priceMin: '20',
      priceMax: '30',
      bidsMin: '10',
      ageMin: '10',
      ageMax: '15',
      linksMin: '100',
      visitorsMin: '50',
      appraisalMin: '500',
      renewalMax: '12',
      endingWithin: '1h'
    })
    expect(everyFilter.total).toBe(1)
    expect(everyFilter.rows[0]).toMatchObject({
      bidderCount: 5,
      inboundLinks: 100,
      visitors: 50,
      appraisalCents: 50_000,
      renewalPriceCents: 1_200,
      startsAt: new Date('2026-07-12T04:00:00.000Z'),
      domainLength: 10,
      tld: 'com',
      hasHyphen: false,
      hasDigit: false
    })
  })

  it('ORs values within a category and ANDs across categories', async () => {
    expect((await query({ tld: ['com', 'org'] })).total).toBe(2)
    expect((await query({ q: 'garden', tld: ['org'] })).total).toBe(0)
  })

  it('hides auctions that have ended, from rows, counts, and facets', async () => {
    expect((await query({ q: 'past', endingWithin: '1h' })).total).toBe(1)
    const afterPastEnds = await queryAt(
      database,
      new Date('2026-07-13T04:30:00.000Z')
    )({ q: 'past' })
    expect(afterPastEnds.total).toBe(0)
    expect(afterPastEnds.rows).toHaveLength(0)
    const later = new Date('2026-08-01T00:00:00.000Z')
    expect((await queryAt(database, later)({})).total).toBe(0)
    const ended = await statusAt(database, later)()
    expect(ended.tlds).toEqual([])
    expect(ended.sources).toEqual([])
  })

  it('treats an unknown value as unconstrained, but never as matching a bound', async () => {
    expect((await query({ q: 'past' })).total).toBe(1)
    for (const constrained of [
      { ageMin: '0' },
      { linksMin: '0' },
      { visitorsMin: '0' },
      { appraisalMin: '0' },
      { renewalMax: '9999' }
    ]) {
      expect((await query({ q: 'past', ...constrained })).total).toBe(0)
    }
  })

  it('caps category values at 64 and runs the worst accepted query', async () => {
    const capped = parseDomainTableFilters({
      q: 'garden',
      source: 'dynadot',
      type: 'expired',
      tld: ['com', ...Array.from({ length: 80 }, (_, index) => `cap${index}`)],
      domainLengthMin: '0',
      domainLengthMax: '253',
      noHyphens: '1',
      noDigits: '1',
      priceMin: '0',
      priceMax: '999999',
      bidsMin: '0',
      ageMin: '0',
      ageMax: '999',
      linksMin: '0',
      visitorsMin: '0',
      appraisalMin: '0',
      renewalMax: '999999',
      endingWithin: '7d'
    })
    expect(capped.sources.length + capped.auctionTypes.length + capped.tlds.length).toBe(
      DOMAIN_TABLE_CATEGORY_VALUE_LIMIT
    )
    expect(DOMAIN_TABLE_CATEGORY_VALUE_LIMIT).toBe(64)
    expect((await queryDomainListingsWithDatabase(capped, database, QUERY_NOW)).total).toBe(1)
  })

  describe('with ranked fixtures', () => {
    beforeEach(async () => {
      await seedRankedListings(database)
    })

    it.each<{
      name: string
      searchParams: DomainTableSearchParams
      includes: string[]
      excludes: string[]
    }>([
      {
        name: 'domain_length_min',
        searchParams: { q: 'rank-', domainLengthMin: '11' },
        includes: ['rank-3'],
        excludes: ['rank-1']
      },
      {
        name: 'domain_length_max',
        searchParams: { q: 'rank-', domainLengthMax: '13' },
        includes: ['rank-2'],
        excludes: ['rank-0']
      },
      {
        name: 'price_min',
        searchParams: { q: 'rank-', priceMin: '2' },
        includes: ['rank-3'],
        excludes: ['rank-1']
      },
      {
        name: 'price_max',
        searchParams: { q: 'rank-', priceMax: '3' },
        includes: ['rank-0'],
        excludes: ['rank-2']
      },
      {
        name: 'age_min',
        searchParams: { q: 'rank-', ageMin: '2' },
        includes: ['rank-3'],
        excludes: ['rank-1', 'rank-2']
      },
      {
        name: 'age_max',
        searchParams: { q: 'rank-', ageMax: '2' },
        includes: ['rank-3'],
        excludes: ['rank-0', 'rank-2']
      },
      {
        name: 'bids_min',
        searchParams: { q: 'rank-', bidsMin: '2' },
        includes: ['rank-1'],
        excludes: ['rank-2']
      },
      {
        name: 'links_min',
        searchParams: { q: 'rank-', linksMin: '20' },
        includes: ['rank-3'],
        excludes: ['rank-2', 'rank-0']
      },
      {
        name: 'visitors_min',
        searchParams: { q: 'rank-', visitorsMin: '20' },
        includes: ['rank-0'],
        excludes: ['rank-3', 'rank-1']
      },
      {
        name: 'appraisal_min',
        searchParams: { q: 'rank-', appraisalMin: '30' },
        includes: ['rank-2'],
        excludes: ['rank-1', 'rank-3']
      },
      {
        name: 'renewal_max',
        searchParams: { q: 'rank-', renewalMax: '20' },
        includes: ['rank-3'],
        excludes: ['rank-1', 'rank-2']
      },
      {
        name: 'shape_unconstrained',
        searchParams: { q: 'garden', noHyphens: '0', noDigits: 'false' },
        includes: ['shape-clean', 'shape-digit', 'shape-hyphen'],
        excludes: []
      },
      {
        name: 'no_hyphens',
        searchParams: { q: 'garden', noHyphens: '1' },
        includes: ['shape-clean', 'shape-digit'],
        excludes: ['shape-hyphen']
      },
      {
        name: 'no_digits',
        searchParams: { q: 'garden', noDigits: '1' },
        includes: ['shape-clean', 'shape-hyphen'],
        excludes: ['shape-digit']
      },
      {
        name: 'ending_1h',
        searchParams: { endingWithin: '1h' },
        includes: ['shape-clean', 'shape-null'],
        excludes: ['shape-digit']
      },
      {
        name: 'ending_24h',
        searchParams: { endingWithin: '24h' },
        includes: ['shape-digit'],
        excludes: ['shape-hyphen', 'active-04']
      },
      {
        name: 'source_or',
        searchParams: { q: 'rank-', source: ['dynadot', 'godaddy'] },
        includes: ['rank-0', 'rank-1'],
        excludes: ['rank-2', 'rank-3']
      },
      {
        name: 'auction_type_or',
        searchParams: { q: 'rank-', type: ['expired', 'closeout'] },
        includes: ['rank-0', 'rank-1', 'rank-2'],
        excludes: ['rank-3']
      },
      {
        name: 'auction_type_single',
        searchParams: { q: 'rank-', type: ['closeout'] },
        includes: ['rank-1'],
        excludes: ['rank-0', 'rank-2', 'rank-3']
      },
      {
        name: 'auction_type_expired',
        searchParams: { q: 'rank-', type: ['expired'] },
        includes: ['rank-0', 'rank-2'],
        excludes: ['rank-1', 'rank-3']
      },
      {
        name: 'tld_or',
        searchParams: { q: 'rank-', tld: ['co', 'org'] },
        includes: ['rank-1', 'rank-3'],
        excludes: ['rank-0', 'rank-2']
      },
      {
        name: 'query_literal',
        searchParams: { q: 'garden' },
        includes: ['shape-clean', 'shape-digit', 'shape-hyphen'],
        excludes: ['shape-null']
      }
    ])(
      '$name keeps its boundary and drops its near miss',
      async ({ searchParams, includes, excludes }) => {
        const found = ids(await query(searchParams))
        for (const externalId of includes) expect(found).toContain(externalId)
        for (const externalId of excludes) expect(found).not.toContain(externalId)
      }
    )

    it('matches % and _ literally', async () => {
      expect((await query({ q: '%' })).total).toBe(0)
      expect((await query({ q: '_' })).total).toBe(0)
    })

    it.each([
      { path: 'listing-driven', limit: undefined },
      { path: 'index-driven', limit: 0 }
    ])(
      'sorts by every column both ways, with unknown values last ($path metric sorts)',
      async ({ limit }) => {
        const sorted = queryAt(database, QUERY_NOW, limit)
        const expectedAscending: Record<(typeof DOMAIN_TABLE_SORTS)[number], string[]> = {
          domain: ['rank-0', 'rank-1', 'rank-2', 'rank-3'],
          source: ['rank-0', 'rank-1', 'rank-2', 'rank-3'],
          type: ['rank-3', 'rank-1', 'rank-0', 'rank-2'],
          price: ['rank-1', 'rank-3', 'rank-0', 'rank-2'],
          bids: ['rank-2', 'rank-1', 'rank-3', 'rank-0'],
          endsAt: ['rank-1', 'rank-3', 'rank-2', 'rank-0'],
          age: ['rank-1', 'rank-3', 'rank-0', 'rank-2'],
          links: ['rank-2', 'rank-3', 'rank-1', 'rank-0'],
          visitors: ['rank-3', 'rank-0', 'rank-2', 'rank-1'],
          appraisal: ['rank-1', 'rank-2', 'rank-0', 'rank-3'],
          renewal: ['rank-0', 'rank-3', 'rank-1', 'rank-2'],
          domainLength: ['rank-1', 'rank-3', 'rank-2', 'rank-0'],
          majesticTf: ['rank-0', 'rank-2', 'rank-1', 'rank-3'],
          majesticCf: ['rank-1', 'rank-3', 'rank-2', 'rank-0'],
          majesticRefDomains: ['rank-2', 'rank-3', 'rank-0', 'rank-1'],
          semrushAs: ['rank-3', 'rank-0', 'rank-1', 'rank-2'],
          domainRating: ['rank-2', 'rank-0', 'rank-1', 'rank-3']
        }
        // Listings without the value, last in both directions, in domain order (for a metric
        // sort, in the sort's direction).
        const nullsBySort: Partial<Record<(typeof DOMAIN_TABLE_SORTS)[number], string[]>> = {
          age: ['rank-2'],
          links: ['rank-0'],
          visitors: ['rank-1'],
          appraisal: ['rank-3'],
          renewal: ['rank-2'],
          majesticTf: ['rank-3'],
          majesticCf: ['rank-0'],
          majesticRefDomains: ['rank-1'],
          semrushAs: ['rank-2'],
          domainRating: ['rank-1', 'rank-3']
        }
        // rank-0 and rank-2 are both expired, and a tie keeps domain order both ways.
        const descendingBySort: Partial<Record<(typeof DOMAIN_TABLE_SORTS)[number], string[]>> = {
          type: ['rank-0', 'rank-2', 'rank-1', 'rank-3']
        }
        expect(DOMAIN_TABLE_SORTS).toHaveLength(17)
        for (const sort of DOMAIN_TABLE_SORTS) {
          const ascending = expectedAscending[sort]
          const nulls = nullsBySort[sort] ?? []
          const metric = METRIC_SORT_KEYS.includes(sort)
          const descending = descendingBySort[sort] ?? [
            ...ascending.filter(id => !nulls.includes(id)).reverse(),
            ...(metric ? [...nulls].reverse() : nulls)
          ]
          expect(ids(await sorted({ q: 'rank-', sort, direction: 'asc' })), `${sort} asc`).toEqual(
            ascending
          )
          expect(
            ids(await sorted({ q: 'rank-', sort, direction: 'desc' })),
            `${sort} desc`
          ).toEqual(descending)
        }
      }
    )

    // A metric sort breaks ties by domain, then insertion, in its own direction.
    it.each([
      { path: 'listing-driven', limit: undefined },
      { path: 'index-driven', limit: 0 }
    ])(
      'breaks ties by domain, provider, and external ID ($path metric sorts)',
      async ({ limit }) => {
        const sorted = queryAt(database, QUERY_NOW, limit)
        const inserted = ['tie-b', 'tie-a', 'tie-godaddy']
        for (const sort of DOMAIN_TABLE_SORTS) {
          for (const direction of ['asc', 'desc'] as const) {
            const expected = METRIC_SORT_KEYS.includes(sort)
              ? direction === 'asc'
                ? inserted
                : [...inserted].reverse()
              : sort === 'source' && direction === 'desc'
                ? ['tie-godaddy', 'tie-a', 'tie-b']
                : ['tie-a', 'tie-b', 'tie-godaddy']
            expect(
              ids(await sorted({ q: 'tie-domain', sort, direction })),
              `${sort} ${direction}`
            ).toEqual(expected)
          }
        }
      }
    )

    // 60 listings; all but every sixth (5, 11, ... 59) have Trust Flow, so page 1 is all
    // known values and page 2 all unknown.
    it.each([
      { path: 'listing-driven', limit: undefined },
      { path: 'index-driven', limit: 0 }
    ])('pages across the listings without a value ($path metric sorts)', async ({ limit }) => {
      const seenAt = FIXTURE_SEEN_AT.getTime()
      const numbers = sql`with recursive n(i) as (select 0 union all select i + 1 from n where i < 59)`
      const name = sql`'boundary-' || printf('%02d', i) || '.test'`
      await database.run(
        sql`${numbers} insert into domains (name, first_seen_at) select ${name}, ${seenAt} from n`
      )
      await database.run(
        sql`${numbers} insert into auction_listings (provider, external_id, domain_name, auction_url, auction_type, currency, current_bid_cents, bid_count, ends_at, status, first_seen_at, last_seen_at) select 'dynadot', 'boundary-' || printf('%02d', i), ${name}, 'https://example.invalid/boundary/' || i, 'EXPIRED', 'USD', 100, 0, ${new Date('2026-07-20T00:00:00.000Z').getTime()}, 'active', ${seenAt}, ${seenAt} from n`
      )
      await database.run(
        sql`${numbers} insert into domain_seo_metrics (domain_name, source, majestic_tf, updated_at) select ${name}, 'godaddy', i % 5, ${seenAt} from n where i % 6 != 5`
      )
      const rows = Array.from({ length: 60 }, (_, i) => ({
        id: `boundary-${String(i).padStart(2, '0')}`,
        tf: i % 6 === 5 ? null : i % 5
      }))
      const expected = (direction: 'asc' | 'desc') => {
        const sign = direction === 'asc' ? 1 : -1
        const known = rows
          .filter(row => row.tf !== null)
          .sort(
            (left, right) =>
              sign * (Number(left.tf) - Number(right.tf)) || sign * left.id.localeCompare(right.id)
          )
        const unknown = rows.filter(row => row.tf === null)
        if (direction === 'desc') unknown.reverse()
        return [...known, ...unknown].map(({ id }) => id)
      }
      const paged = queryAt(database, QUERY_NOW, limit)
      for (const direction of ['asc', 'desc'] as const) {
        const first = await paged({ q: 'boundary-', sort: 'majesticTf', direction })
        const second = await paged({ q: 'boundary-', sort: 'majesticTf', direction, page: '2' })
        expect(first.total).toBe(60)
        expect([...ids(first), ...ids(second)], direction).toEqual(expected(direction))
      }
      // A page that runs out of known values continues with the rest from the start, and a
      // page that has none starts with them at once.
      expect(ids(await paged({ q: 'boundary-3', sort: 'majesticTf' })).at(-1)).toBe('boundary-35')
      expect(ids(await paged({ q: 'boundary-35', sort: 'majesticTf' }))).toEqual(['boundary-35'])
    })

    it('clamps a page past the end to the last page', async () => {
      const clamped = await query({ q: 'rank-', page: '100000' })
      expect(clamped.page).toBe(1)
      expect(clamped.rows).toHaveLength(4)
    })

    it('offers only allowlisted sources and auction types', async () => {
      const [ranked] = await database
        .select()
        .from(auctionListings)
        .where(sql`${auctionListings.externalId} = 'rank-0'`)
      await database.insert(auctionListings).values({
        ...ranked,
        provider: 'unsupported-provider',
        externalId: 'unsupported-facet',
        auctionType: 'UNSUPPORTED-TYPE'
      })
      // These fixtures bypass ingestion, so rebuild the facets as a sync would.
      await database.batch(refreshListingFacetsQueries(database))
      const facets = await status()
      expect(facets.sources).toEqual(['dynadot', 'godaddy', 'namecheap', 'namesilo'])
      expect(facets.auctionTypes).toEqual(['auction', 'closeout', 'expired'])
    })
  })

  // TLD and domain length are generated columns over the stored name. Only the final label is
  // the TLD, and quotes or backslashes in a name (which broke the earlier JSON-based TLD
  // expression) must not fail any read.
  // Without statistics, SQLite uses an index for ORDER BY only when the index satisfies every
  // term and no filter offers it a better-looking index. On this small inventory only the plan
  // shows a metric sort falling back to sorting every match.
  it('reads a metric sort over many matches from indexes in page order', async () => {
    const statements: { query: string; params: unknown[] }[] = []
    const logged = drizzle(testEnv.DB, {
      schema,
      logger: { logQuery: (query, params) => statements.push({ query, params }) }
    })
    const plan = async ({ query, params }: (typeof statements)[number]) => {
      const { results } = await testEnv.DB.prepare(`explain query plan ${query}`)
        .bind(...params)
        .all<{ detail: string }>()
      return results.map(({ detail }) => detail).join('\n')
    }
    for (const sort of METRIC_SORT_KEYS) {
      for (const searchParams of [{}, { tld: 'com' }, { tld: 'com', priceMax: '500' }]) {
        for (const direction of ['asc', 'desc'] as const) {
          statements.length = 0
          await queryDomainListingsWithDatabase(
            // Past the first page, so the listings without a value are read too.
            parseDomainTableFilters({ ...searchParams, sort, direction, page: '2' }),
            logged,
            QUERY_NOW,
            0
          )
          const pages = statements.filter(({ query }) => query.includes(' order by '))
          const label = `${sort} ${direction} ${JSON.stringify(searchParams)}`
          expect(pages.length, label).toBeGreaterThan(0)
          for (const page of pages) {
            const detail = await plan(page)
            expect(detail, label).not.toContain('USE TEMP B-TREE FOR ORDER BY')
            expect(detail, label).toContain('auction_listings_domain_name_idx')
          }
        }
      }
    }
  })

  it('derives TLD and length from the stored name, whatever it contains', async () => {
    const names = [
      'tld-proof.example.co.uk',
      'tld-proof-"quoted".com',
      'tld-proof-back\\slash.Ba\\Ck',
      'tld-proof.qu"ote'
    ]
    await database
      .insert(domains)
      .values(names.map(name => ({ name, firstSeenAt: FIXTURE_SEEN_AT })))
    await database.insert(auctionListings).values(
      names.map((domainName, index) => ({
        ...listing(`tld-proof-${index}`, domainName, 100),
        startsAt: null,
        endsAt: new Date('2026-07-20T00:00:00.000Z'),
        status: 'active' as const,
        firstSeenAt: FIXTURE_SEEN_AT,
        lastSeenAt: FIXTURE_SEEN_AT
      }))
    )
    await database.batch(refreshListingFacetsQueries(database))

    const all = await query({ q: 'tld-proof' })
    expect(all.total).toBe(names.length)
    for (const row of all.rows) {
      expect(row.tld).toBe(row.domainName.split('.').at(-1)?.toLowerCase())
      expect(row.domainLength).toBe(row.domainName.length)
    }
    const multiLabel = await query({ q: 'tld-proof', tld: 'uk' })
    const exactLength = await query({
      q: 'tld-proof',
      domainLengthMin: '23',
      domainLengthMax: '23'
    })
    expect(ids(multiLabel)).toEqual(['tld-proof-0'])
    expect(ids(exactLength)).toEqual(['tld-proof-0'])
    expect((await status()).tlds).toEqual(expect.arrayContaining(['uk', 'qu"ote', 'ba\\ck']))
  })

  it('offers every active TLD, with no cap', async () => {
    const tldCount = 300
    const seenAt = FIXTURE_SEEN_AT.getTime()
    const endsAt = new Date('2026-07-20T00:00:00.000Z').getTime()
    const numbers = sql`with recursive n(i) as (select 0 union all select i + 1 from n where i < ${tldCount - 1})`
    await database.run(
      sql`${numbers} insert into domains (name, first_seen_at) select 'facet-proof.t' || printf('%03d', i), ${seenAt} from n`
    )
    await database.run(
      sql`${numbers} insert into auction_listings (provider, external_id, domain_name, auction_url, auction_type, currency, current_bid_cents, bid_count, ends_at, status, first_seen_at, last_seen_at) select 'dynadot', 'facet-proof-' || i, 'facet-proof.t' || printf('%03d', i), 'https://example.invalid/facet/' || i, 'EXPIRED', 'USD', 100, 0, ${endsAt}, 'active', ${seenAt}, ${seenAt} from n`
    )
    await database.batch(refreshListingFacetsQueries(database))

    const { tlds } = await status()
    expect(tlds.filter(tld => /^t\d{3}$/.test(tld))).toHaveLength(tldCount)
    expect(tlds.length).toBeGreaterThan(250)
    expect(tlds).toEqual([...tlds].sort())
  })

  describe('with GoDaddy feed metrics', () => {
    beforeEach(async () => {
      const godaddy = createD1IngestionStorage(database, 'godaddy')
      const metrics = (majesticTf: number): NormalizedSeoMetrics => ({
        majesticTf,
        majesticCf: 20,
        majesticBacklinks: 900,
        majesticRefDomains: 40,
        semrushAs: 15,
        semrushRefDomains: null,
        semrushBacklinks: 120
      })
      const run = await godaddy.startRun(new Date('2026-07-13T03:50:00.000Z'))
      await godaddy.upsertListings(run, [
        godaddyListing('900001', 'seo-feed.integration.test', metrics(12)),
        godaddyListing('900002', 'garden.com', metrics(30)),
        { ...godaddyListing('900003', 'seo-buy-now.integration.test'), auctionType: 'BUY_NOW' }
      ])
    })

    it('returns the nullable bidder count and the feed metrics on each row', async () => {
      const feedRows = await query({ source: 'godaddy' })
      const feedRow = feedRows.rows.find(row => row.domainName === 'seo-feed.integration.test')
      expect(feedRows.total).toBe(3)
      expect(feedRow?.bidderCount).toBeNull()
      expect(feedRow?.seoMetrics).toMatchObject({
        majesticTf: 12,
        majesticRefDomains: 40,
        source: 'godaddy'
      })
      expect(
        feedRows.rows.find(row => row.domainName === 'seo-buy-now.integration.test')?.seoMetrics
      ).toBeNull()
    })

    it('filters a new auction type before a successful sync offers it', async () => {
      // Facets are rebuilt when a sync succeeds, so a running run's new type is filterable first.
      expect((await query({ type: 'buy_now' })).total).toBe(1)
      expect((await status()).auctionTypes).not.toContain('buy_now')
      await database.batch(refreshListingFacetsQueries(database))
      expect((await query({ type: 'buy_now' })).total).toBe(1)
      expect((await status()).auctionTypes).toContain('buy_now')
    })

    it('filters on the feed metrics', async () => {
      const tf = await query({ majesticTfMin: '11' })
      // garden.com has both a Dynadot and a GoDaddy listing.
      expect(tf.total).toBe(3)
      expect(tf.rows.every(row => (row.seoMetrics?.majesticTf ?? 0) >= 11)).toBe(true)
      expect((await query({ source: 'godaddy', majesticCfMin: '20' })).total).toBe(2)
      expect((await query({ majesticRefDomainsMin: '41' })).total).toBe(0)
      expect((await query({ source: 'godaddy', semrushAsMin: '15' })).total).toBe(2)
    })

    it('binds 87 values for the worst accepted query with metric filters', async () => {
      const worstCase = await query({
        q: 'garden',
        source: 'dynadot',
        type: 'expired',
        tld: ['com', ...Array.from({ length: 80 }, (_, index) => `cap${index}`)],
        domainLengthMin: '0',
        domainLengthMax: '253',
        noHyphens: '1',
        noDigits: '1',
        priceMin: '0',
        priceMax: '999999',
        bidsMin: '0',
        ageMin: '0',
        ageMax: '999',
        linksMin: '0',
        visitorsMin: '0',
        appraisalMin: '0',
        renewalMax: '999999',
        majesticTfMin: '30',
        majesticCfMin: '20',
        majesticRefDomainsMin: '40',
        semrushAsMin: '15',
        endingWithin: '7d'
      })
      expect(worstCase.total).toBe(1)
      expect(worstCase.rows[0]?.domainName).toBe('garden.com')
      expect(worstCase.rows[0]?.seoMetrics?.majesticTf).toBe(30)
    })
  })

  it('shows an omitted rating as none until it may be asked again, and a pending one as unfetched', async () => {
    const retryAfter = new Date(QUERY_NOW.getTime() + 60_000)
    await database.insert(domainMetrics).values([
      {
        domainName: 'garden.com',
        metric: 'ahrefs_dr',
        status: 'omitted',
        value: null,
        fetchedAt: QUERY_NOW,
        retryAfter
      },
      {
        domainName: 'past.org',
        metric: 'ahrefs_dr',
        status: 'pending',
        value: null,
        fetchedAt: QUERY_NOW,
        retryAfter
      }
    ])
    const rating = async (now: Date, domainName: string) =>
      (await queryAt(database, now)({ q: domainName })).rows.find(
        row => row.domainName === domainName
      )?.domainRatingFetched
    expect(await rating(QUERY_NOW, 'garden.com')).toBe(true)
    expect(await rating(retryAfter, 'garden.com')).toBe(false)
    expect(await rating(QUERY_NOW, 'past.org')).toBe(false)
  })

  it('reads the facets and freshness on their own, at the current time by default', async () => {
    const status = await queryInventoryStatusWithDatabase(database, QUERY_NOW)
    expect(status).toEqual({
      sources: ['dynadot'],
      auctionTypes: ['expired'],
      tlds: ['com', 'net', 'org', 'test'],
      latestSuccessfulSync: REPEATED_COMPLETED_AT
    })
    // Every fixture auction has ended by now.
    expect(await queryListingFacetsWithDatabase(database)).toEqual({
      sources: [],
      auctionTypes: [],
      tlds: []
    })
    expect((await queryInventoryStatusWithDatabase(database)).latestSuccessfulSync).toEqual(
      REPEATED_COMPLETED_AT
    )
    expect(
      (await queryDomainListingsWithDatabase(parseDomainTableFilters({}), database)).total
    ).toBe(0)
  })
})

describe('domain listings read model on an empty D1', () => {
  it('reads no rows, facets, or sync', async () => {
    expect(await queryAt(testDatabase())({})).toEqual({ rows: [], total: 0, page: 1 })
    expect(await queryInventoryStatusWithDatabase(testDatabase())).toEqual({
      sources: [],
      auctionTypes: [],
      tlds: [],
      latestSuccessfulSync: null
    })
  })
})
