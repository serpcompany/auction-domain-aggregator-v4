import { getCloudflareContext } from '@opennextjs/cloudflare'

import { getDb } from '@/server/db/client'
import { fetchDomainRatings } from '@/server/enrichment/ahrefs'
import { enrichDomainRatings } from '@/server/enrichment/domain-rating'
import { handleDomainRatingRequest } from '@/server/enrichment/domain-rating-request'

export const dynamic = 'force-dynamic'

// The only request path that calls Ahrefs. Page rendering stays D1-only.
export async function POST(request: Request) {
  const { env } = getCloudflareContext()
  const db = getDb()
  return handleDomainRatingRequest(request, {
    apiKey: (env as { AHREFS_API_KEY?: string }).AHREFS_API_KEY,
    enrich: (fetchRatings, domains) => enrichDomainRatings(db, fetchRatings, domains),
    fetchRatings: (apiKey, domains) => fetchDomainRatings({ apiKey, domains })
  })
}
