import { z } from 'zod'

import { AhrefsError } from './ahrefs'
import {
  DOMAIN_RATING_REQUEST_LIMIT,
  DomainRatingCoolDown,
  type FetchDomainRatings
} from './domain-rating'

// A normalized name Ahrefs can be asked about.
export const RATEABLE_DOMAIN = /^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

const requestSchema = z
  .object({
    domains: z.array(z.string().regex(RATEABLE_DOMAIN)).min(1).max(DOMAIN_RATING_REQUEST_LIMIT)
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
  { apiKey, enrich, fetchRatings }: DomainRatingRequestDependencies
): Promise<Response> {
  if (!apiKey) return failed('ahrefs_not_configured', 503)

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await request.json())
  } catch {
    return failed('invalid_request', 400)
  }

  try {
    const result = await enrich(
      domains => fetchRatings(apiKey, domains),
      body.domains,
      request.signal
    )
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
