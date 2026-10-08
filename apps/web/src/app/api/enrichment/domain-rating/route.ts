import { getCloudflareContext } from '@opennextjs/cloudflare'

import { getDb } from '@/server/db/client'
import { fetchDomainRatings } from '@/server/enrichment/ahrefs'
import { enrichDomainRatings } from '@/server/enrichment/domain-rating'
import { handleDomainRatingRequest } from '@/server/enrichment/domain-rating-request'
import { createD1DomainRatingStore } from '@/server/enrichment/domain-rating-store'

export const dynamic = 'force-dynamic'

// With `matching/route.ts`, the only request paths that call Ahrefs. Page
// rendering stays D1-only.
export async function POST(request: Request) {
  const { env } = getCloudflareContext()
  const store = createD1DomainRatingStore(getDb())
  return handleDomainRatingRequest(request, {
    apiKey: (env as { AHREFS_API_KEY?: string }).AHREFS_API_KEY,
    enrich: (fetchRatings, domains, signal) =>
      enrichDomainRatings(store, fetchRatings, domains, { signal }),
    fetchRatings: (apiKey, domains) => fetchDomainRatings({ apiKey, domains })
  })
}
