import { z } from 'zod'

import { AhrefsError } from './ahrefs'
import {
  DOMAIN_RATING_REQUEST_LIMIT,
  DomainRatingCoolDown,
  type FetchDomainRatings
} from './domain-rating'

const DOMAIN = /^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

const requestSchema = z
  .object({
    domains: z.array(z.string().regex(DOMAIN)).min(1).max(DOMAIN_RATING_REQUEST_LIMIT)
  })
  .strict()

export type DomainRatingRequestDependencies = {
  apiKey: string | undefined
  enrich: (
    fetchRatings: FetchDomainRatings,
    domains: string[],
    signal: AbortSignal
  ) => Promise<{ requested: number; stored: number }>
  fetchRatings: (apiKey: string, domains: string[]) => ReturnType<FetchDomainRatings>
}

function failed(errorCode: string, status: number, headers?: HeadersInit) {
  return Response.json({ status: 'failed', errorCode }, { status, headers })
}

// POST { domains: string[] } -> { stored }. Errors are fixed, non-secret codes.
export async function handleDomainRatingRequest(
  request: Request,
  dependencies: DomainRatingRequestDependencies
): Promise<Response> {
  if (!dependencies.apiKey) return failed('ahrefs_not_configured', 503)

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await request.json())
  } catch {
    return failed('invalid_request', 400)
  }
  return enrichAndRespond(request, dependencies.apiKey, dependencies, body.domains)
}

const matchingRequestSchema = z.object({ search: z.string().max(4_000) }).strict()

export type MatchingDomainRatingRequestDependencies = DomainRatingRequestDependencies & {
  // The domains of the listings the table's query string matches, or null
  // when there are too many to fetch at once.
  matchingDomains: (search: string) => Promise<string[] | null>
}

// POST { search } -> { requested, stored }: DR for every listing that matches
// the table's filters, refused when they match too many domains.
export async function handleMatchingDomainRatingRequest(
  request: Request,
  dependencies: MatchingDomainRatingRequestDependencies
): Promise<Response> {
  if (!dependencies.apiKey) return failed('ahrefs_not_configured', 503)

  let body: z.infer<typeof matchingRequestSchema>
  try {
    body = matchingRequestSchema.parse(await request.json())
  } catch {
    return failed('invalid_request', 400)
  }
  const domains = await dependencies.matchingDomains(body.search)
  if (domains === null) return failed('too_many_listings', 400)
  return enrichAndRespond(request, dependencies.apiKey, dependencies, domains)
}

async function enrichAndRespond(
  request: Request,
  apiKey: string,
  { enrich, fetchRatings }: DomainRatingRequestDependencies,
  domains: string[]
) {
  try {
    const result = await enrich(targets => fetchRatings(apiKey, targets), domains, request.signal)
    return Response.json({ status: 'ok', ...result })
  } catch (error) {
    if (error instanceof DomainRatingCoolDown) {
      return failed('ahrefs_cool_down', 429, { 'retry-after': String(error.retryAfterSeconds) })
    }
    if (error instanceof AhrefsError) {
      return failed(error.code, error.code === 'ahrefs_rate_limited' ? 429 : 502)
    }
    // The client has gone, so nobody reads this answer.
    if (request.signal.aborted) return failed('request_aborted', 499)
    return failed('enrichment_failed', 500)
  }
}
