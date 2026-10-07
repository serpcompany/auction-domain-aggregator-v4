import { sql } from 'drizzle-orm'

import type { AppDatabase } from './types'

// Rebuilds `listing_facets` from the whole active inventory, for every
// provider. Ingestion runs these in the batch that finalizes a successful sync;
// migration 0006 ran the same insert once as a backfill. They are plain SQL so
// test fixtures that insert listings directly can run them too.
export const REFRESH_LISTING_FACETS_SQL = [
  'DELETE FROM listing_facets',
  `INSERT INTO listing_facets (facet, value, latest_ends_at)
  SELECT 'source', provider, max(ends_at) FROM auction_listings
  WHERE status = 'active' GROUP BY provider
  UNION ALL
  SELECT 'auction_type', lower(auction_type), max(ends_at) FROM auction_listings
  WHERE status = 'active' GROUP BY lower(auction_type)
  UNION ALL
  SELECT 'tld', tld, max(ends_at) FROM auction_listings
  WHERE status = 'active' GROUP BY tld`
] as const

// Batch items, so callers can make the rebuild atomic with their own writes.
export function refreshListingFacetsQueries(db: AppDatabase) {
  const [clear, rebuild] = REFRESH_LISTING_FACETS_SQL
  return [db.run(sql.raw(clear)), db.run(sql.raw(rebuild))] as const
}
