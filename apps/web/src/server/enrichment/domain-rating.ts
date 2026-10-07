import { and, eq, inArray, notExists, sql } from 'drizzle-orm'

import { auctionListings, domainMetrics } from '../db/schema'
import type { AppDatabase } from '../db/types'

// The route accepts at most this many domains per request: one page of the
// table is 50 rows.
export const DOMAIN_RATING_REQUEST_LIMIT = 50
const INSERT_BATCH_ROWS = 16

export type FetchDomainRatings = (domains: string[]) => Promise<Map<string, number | null>>

// Fetches and stores Ahrefs DR for the given domains that have an active
// listing and no stored DR yet. Stored values are never overwritten, so
// repeated or concurrent calls are harmless.
export async function enrichDomainRatings(
  db: AppDatabase,
  fetchRatings: FetchDomainRatings,
  requestedDomains: string[],
  now = new Date()
): Promise<{ requested: number; stored: number }> {
  const unique = [...new Set(requestedDomains)].slice(0, DOMAIN_RATING_REQUEST_LIMIT)
  if (unique.length === 0) return { requested: 0, stored: 0 }

  // Only domains currently up for auction, so the route cannot be used as a
  // general-purpose DR lookup.
  const candidates = await db
    .selectDistinct({ domainName: auctionListings.domainName })
    .from(auctionListings)
    .where(
      and(
        inArray(auctionListings.domainName, unique),
        eq(auctionListings.status, 'active'),
        notExists(
          db
            .select({ one: sql`1` })
            .from(domainMetrics)
            .where(
              and(
                eq(domainMetrics.domainName, auctionListings.domainName),
                eq(domainMetrics.metric, 'ahrefs_dr')
              )
            )
        )
      )
    )
  const missing = candidates.map(({ domainName }) => domainName)
  if (missing.length === 0) return { requested: 0, stored: 0 }

  const ratings = await fetchRatings(missing)
  const rows = missing
    .filter(domainName => ratings.has(domainName))
    .map(domainName => {
      const value = ratings.get(domainName)!
      return {
        domainName,
        metric: 'ahrefs_dr' as const,
        status: value === null ? ('not_found' as const) : ('ok' as const),
        value,
        fetchedAt: now
      }
    })
  if (rows.length === 0) return { requested: missing.length, stored: 0 }

  // Five columns per row; 16 rows stay below D1's 100 bound-parameter limit.
  let stored = 0
  for (let index = 0; index < rows.length; index += INSERT_BATCH_ROWS) {
    const inserted = await db
      .insert(domainMetrics)
      .values(rows.slice(index, index + INSERT_BATCH_ROWS))
      .onConflictDoNothing()
      .returning({ domainName: domainMetrics.domainName })
    stored += inserted.length
  }
  return { requested: missing.length, stored }
}
