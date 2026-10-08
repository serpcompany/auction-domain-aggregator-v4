import { getCloudflareContext } from '@opennextjs/cloudflare'

import { parseDomainTableFilters, queryStringToSearchParams } from '@/domain/domain-table'
import { getDb } from '@/server/db/client'
import { fetchDomainRatings } from '@/server/enrichment/ahrefs'
import {
  DOMAIN_RATING_MATCHING_LIMIT,
  enrichDomainRatings
} from '@/server/enrichment/domain-rating'
import { handleMatchingDomainRatingRequest } from '@/server/enrichment/domain-rating-request'
import { createD1DomainRatingStore } from '@/server/enrichment/domain-rating-store'
import { queryMatchingDomainNames } from '@/server/queries/domain-listings'

export const dynamic = 'force-dynamic'

// DR for every listing the table's filters match, when they match few enough.
export async function POST(request: Request) {
  const { env } = getCloudflareContext()
  const db = getDb()
  const store = createD1DomainRatingStore(db)
  return handleMatchingDomainRatingRequest(request, {
    apiKey: (env as { AHREFS_API_KEY?: string }).AHREFS_API_KEY,
    matchingDomains: search =>
      queryMatchingDomainNames(
        parseDomainTableFilters(queryStringToSearchParams(search)),
        DOMAIN_RATING_MATCHING_LIMIT,
        db
      ),
    enrich: (fetchRatings, domains, signal) =>
      enrichDomainRatings(store, fetchRatings, domains, {
        signal,
        limit: DOMAIN_RATING_MATCHING_LIMIT
      }),
    fetchRatings: (apiKey, domains) => fetchDomainRatings({ apiKey, domains })
  })
}
