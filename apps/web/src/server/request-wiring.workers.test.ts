import { afterEach, describe, expect, it, vi } from 'vitest'

import { POST } from '../app/api/enrichment/domain-rating/route'
import { GET } from '../app/api/health/route'
import { parseDomainTableFilters } from '../domain/domain-table'
import {
  queryDomainListings,
  queryInventoryStatus,
  queryListingFacets
} from './queries/domain-listings'
import { queryFailedSyncCount, querySyncStatus } from './queries/sync-status'
import { testDatabase, testEnv } from './test-database'
import { seedProofInventory } from './test-listings'

// The request path reaches D1 through OpenNext's Cloudflare context. Here that context is the
// test Worker's own bindings, plus an invented Ahrefs key.
const context = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))
vi.mock('server-only', () => ({}))
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => context }))

afterEach(() => {
  vi.unstubAllGlobals()
})

function useBindings(extra: Record<string, unknown> = {}) {
  context.env = { DB: testEnv.DB, ...extra }
}

describe('request wiring to D1', () => {
  it('reads the table, facets, freshness, and sync status from the context database', async () => {
    useBindings()
    await seedProofInventory(testDatabase())

    const listings = await queryDomainListings(parseDomainTableFilters({}))
    const facets = await queryListingFacets()
    const status = await queryInventoryStatus()
    // The invented auctions ended before the real current time.
    expect(listings).toEqual({ rows: [], total: 0, page: 1 })
    expect(status.latestSuccessfulSync).not.toBeNull()
    expect(facets).toEqual({
      sources: status.sources,
      auctionTypes: status.auctionTypes,
      tlds: status.tlds
    })
    expect((await querySyncStatus()).providers.map(item => item.provider)).toEqual(['dynadot'])
    expect(await queryFailedSyncCount()).toBe(0)
  })

  it('reports D1 health, and a database it cannot reach as unavailable', async () => {
    useBindings()
    const healthy = await GET()
    expect(healthy.status).toBe(200)
    expect(await healthy.json()).toEqual({ status: 'ok', database: 'ok' })

    context.env = {}
    const unhealthy = await GET()
    expect(unhealthy.status).toBe(503)
    expect(await unhealthy.json()).toEqual({ status: 'unhealthy', database: 'unavailable' })
  })

  it('enriches Domain Ratings through the store and the Ahrefs client, never the network', async () => {
    await seedProofInventory(testDatabase())
    useBindings({ AHREFS_API_KEY: 'invented-key' })
    const ahrefs = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { targets } = JSON.parse(String(init?.body)) as { targets: string[] }
      return Response.json({
        domain_rating: {
          targets: targets.map(target => ({ target: `${target}/`, domain_rating: 42 }))
        }
      })
    })
    vi.stubGlobal('fetch', ahrefs)

    // The claim needs an active listing, which the seeded Dynadot inventory provides.
    const response = await POST(
      new Request('http://local/api/enrichment/domain-rating', {
        method: 'POST',
        body: JSON.stringify({ domains: ['active-05.integration.test'] })
      })
    )
    expect(ahrefs).toHaveBeenCalledOnce()
    expect(String(ahrefs.mock.calls[0]?.[0])).toBe(
      'https://api.ahrefs.com/v3/public/domain-rating-free'
    )
    expect(await response.json()).toEqual({ status: 'ok', requested: 1, stored: 1 })
  })
})
