import { and, count, desc, eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { auctionListings, domainSeoMetrics, ingestionRuns } from '../db/schema'
import { GODADDY_FEED_ENTRY } from '../providers/godaddy'
import { testDatabase, testEnv } from '../test-database'
import { listing, QUERY_NOW, queryAt, STARTED_AT } from '../test-listings'
import { createD1IngestionStorage } from './d1-storage'
import { runProviderSync } from './provider-sync-workflow'
import { buildZipFixture } from './zip-fixture'

async function stagedObjects() {
  return (await testEnv.FEED_PAGES.list({ prefix: 'feed-pages/' })).objects.length
}

// Runs the Workflow's orchestration with real D1 and R2, an invented feed in place of the
// download, and a step runner that runs each step once and counts the staged pages.
async function sync(provider: string, runKey: string, body: BodyInit) {
  const steps: string[] = []
  let staged = 0
  const outcome = await runProviderSync({
    provider,
    runKey,
    env: { DB: testEnv.DB, FEED_PAGES: testEnv.FEED_PAGES },
    step: {
      async do(name, _config, callback) {
        steps.push(name)
        const result = await callback()
        if (name === 'stage feed') staged = await stagedObjects()
        return result
      },
      sleep: async () => undefined
    },
    nonRetryable: code => new Error(code),
    dependencies: { fetchImpl: (async () => new Response(body)) as typeof fetch }
  }).then(
    summary => ({ summary, error: null }),
    (error: unknown) => ({
      summary: null,
      error: error instanceof Error ? error.message : 'unknown'
    })
  )
  return { ...outcome, steps, staged }
}

async function metricsFor(domainName: string) {
  const [row] = await testDatabase()
    .select()
    .from(domainSeoMetrics)
    .where(eq(domainSeoMetrics.domainName, domainName))
  return row
}

function inventedFeedRecord(index: number, price = '$15') {
  return {
    domainName: `cloud-feed-${index}.integration.test`,
    link: `https://www.godaddy.com/domain-auctions/cloud-feed-${index}-${800_000 + index}`,
    auctionType: 'Bid',
    auctionEndTime: '2030-01-01T00:00:00Z',
    price,
    numberOfBids: 2,
    majesticTf: 5,
    semrushAs: 9
  }
}

async function godaddyZip(records: unknown[]) {
  return buildZipFixture(JSON.stringify({ meta: { generated: 'invented' }, data: records }), {
    entry: GODADDY_FEED_ENTRY,
    dataDescriptor: true
  })
}

describe('provider-sync Workflow on D1 and R2', () => {
  // An invented zipped feed (with a data descriptor, the harder zip layout) is staged into R2
  // pages, synced through the adapter, and the pages are deleted.
  it('stages, syncs, and cleans up the GoDaddy feed, then rebuilds every provider’s facets', async () => {
    const database = testDatabase()
    const query = queryAt(database, QUERY_NOW)
    const before = await query({})
    // One active listing of another provider, which GoDaddy's rebuild must keep.
    const dynadot = createD1IngestionStorage(database, 'dynadot')
    await dynadot.upsertListings(await dynadot.startRun(STARTED_AT), [
      listing('cloud-other', 'cloud-other.integration.test', 100)
    ])

    const records = Array.from({ length: 2_500 }, (_, index) => inventedFeedRecord(index))
    const succeeded = await sync('godaddy', 'godaddy-integration-ok', await godaddyZip(records))
    expect(succeeded.error).toBeNull()
    expect(succeeded.summary).toMatchObject({
      pagesFetched: 3,
      recordsFetched: 2_500,
      recordsUpserted: 2_500,
      recordsRejected: 0
    })
    expect(succeeded.staged).toBe(3)
    expect(succeeded.steps).toEqual([
      'stage feed',
      'start run',
      'sync pages, segment 1',
      'delete staged pages'
    ])
    expect(await stagedObjects()).toBe(0)

    const [stored] = await database
      .select({ value: count() })
      .from(auctionListings)
      .where(
        and(
          eq(auctionListings.provider, 'godaddy'),
          eq(auctionListings.status, 'active'),
          like(auctionListings.domainName, 'cloud-feed-%')
        )
      )
    expect(stored.value).toBe(2_500)
    expect((await metricsFor('cloud-feed-2499.integration.test'))?.semrushAs).toBe(9)

    // The successful finalization rebuilt the facet values for every provider.
    const after = await query({})
    expect(before.sources).not.toContain('godaddy')
    expect(after.sources).toEqual(expect.arrayContaining(['godaddy', 'dynadot']))
    expect(after.auctionTypes).toContain('auction')
  })

  // More than a tenth of the first page is invalid: the run fails on page 1, records why,
  // reconciles nothing, and still deletes its pages.
  it('contains a GoDaddy run whose first page fails validation', async () => {
    const database = testDatabase()
    const records = Array.from({ length: 2_500 }, (_, index) => inventedFeedRecord(index))
    await sync('godaddy', 'godaddy-integration-ok', await godaddyZip(records))

    const invalid = records.map((record, index) =>
      index < 200 ? inventedFeedRecord(index, 'not money') : record
    )
    const failed = await sync(
      'godaddy',
      'godaddy-integration-failed',
      await godaddyZip(invalid.slice(0, 1_500))
    )
    const [failedRun] = await database
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.provider, 'godaddy'))
      .orderBy(desc(ingestionRuns.id))
      .limit(1)
    const [stillActive] = await database
      .select({ value: count() })
      .from(auctionListings)
      .where(
        and(eq(auctionListings.status, 'active'), like(auctionListings.domainName, 'cloud-feed-%'))
      )
    expect(failed.error).toBe('godaddy_too_many_rejected')
    expect(failed.staged).toBe(2)
    expect(failed.steps.at(-1)).toBe('delete staged pages')
    expect(await stagedObjects()).toBe(0)
    expect(failedRun).toMatchObject({
      status: 'failed',
      errorCode: 'godaddy_too_many_rejected',
      failedPage: 1,
      rejectionReasons: { 'price: invalid_decimal': 200 }
    })
    expect(stillActive.value).toBe(2_500)
  })

  // Rows (one with a quoted, comma-bearing field) are staged into R2 pages of 2,000, synced
  // through the adapter with their feed metrics, and the pages are deleted.
  it('stages, syncs, and cleans up the Namecheap CSV feed', async () => {
    const database = testDatabase()
    const rows = Array.from({ length: 2_500 }, (_, index) =>
      [
        `https://www.namecheap.com/market/sale/CsvSale${index}/`,
        `csv-feed-${index}.integration.test`,
        '2026-07-01T00:00:00Z',
        '2026-07-20T15:00:00Z',
        index === 0 ? '"12.50"' : '12.50',
        index % 10,
        index === 7 ? '"note, with a comma"' : '',
        index === 2_499 ? '9' : ''
      ].join(',')
    )
    const csv = ['url,name,startDate,endDate,price,bidCount,note,semrushAScore', ...rows].join(
      '\r\n'
    )
    const result = await sync('namecheap', 'namecheap-integration-ok', csv)
    expect(result.summary).toMatchObject({
      pagesFetched: 2,
      recordsUpserted: 2_500,
      recordsRejected: 0
    })
    expect(result.staged).toBe(2)
    expect(result.steps).toEqual([
      'stage feed',
      'start run',
      'sync pages, segment 1',
      'delete staged pages'
    ])
    expect(await stagedObjects()).toBe(0)

    const [stored] = await database
      .select({ value: count() })
      .from(auctionListings)
      .where(and(eq(auctionListings.provider, 'namecheap'), eq(auctionListings.status, 'active')))
    const [first] = await database
      .select()
      .from(auctionListings)
      .where(eq(auctionListings.externalId, 'CsvSale0'))
    expect(stored.value).toBe(2_500)
    expect(first).toMatchObject({
      currentBidCents: 1_250,
      startsAt: new Date('2026-07-01T00:00:00.000Z'),
      auctionUrl: 'https://www.namecheap.com/market/sale/CsvSale0/'
    })
    expect(await metricsFor('csv-feed-2499.integration.test')).toMatchObject({
      source: 'namecheap',
      semrushAs: 9
    })
  })
})
