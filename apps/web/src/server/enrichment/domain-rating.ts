import { AhrefsError } from './ahrefs'

// The route accepts at most this many domains per request: one page of the
// table is 50 rows.
export const DOMAIN_RATING_REQUEST_LIMIT = 50
// A claim outlives the Ahrefs call's 15-second timeout, so it lapses only when
// the request holding it died or the call failed. Then the domains wait out
// the claim before anyone asks again.
export const DOMAIN_RATING_CLAIM_MS = 60_000
// Ahrefs sometimes leaves a target out of its answer. Ask again after a week.
export const DOMAIN_RATING_OMITTED_RETRY_MS = 7 * 24 * 60 * 60_000
// After a 429: Retry-After when Ahrefs sends one, kept within these bounds.
const DEFAULT_COOL_DOWN_SECONDS = 60
const MAX_COOL_DOWN_SECONDS = 60 * 60

export type FetchDomainRatings = (domains: string[]) => Promise<Map<string, number | null>>

export type DomainRatingResult = {
  domainName: string
  status: 'ok' | 'not_found' | 'omitted'
  value: number | null
  retryAfter: Date | null
}

export type AhrefsRequestRecord = {
  requestedAt: Date
  domainCount: number
  outcome: string
  coolDownUntil: Date | null
}

export type DomainRatingStore = {
  // The end of the latest Ahrefs cool-down still in force, if any.
  coolDownUntil(now: Date): Promise<Date | null>
  // Atomically claims, until `until`, the given domains that have an active
  // listing and no rating, an omission whose retry time has passed, or a
  // lapsed claim. Returns the claimed domains; the rest are settled, waiting,
  // or held by another request.
  claim(domains: string[], now: Date, until: Date): Promise<string[]>
  // Gives back claims made with `until` that were not used.
  release(domains: string[], until: Date): Promise<void>
  // Writes one call's log row and its results together. Results replace only
  // claims and omissions, never a stored rating. Returns how many were written.
  record(request: AhrefsRequestRecord, results: DomainRatingResult[]): Promise<number>
}

// Thrown, without calling Ahrefs, while a 429's cool-down lasts.
export class DomainRatingCoolDown extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('ahrefs_cool_down')
    this.name = 'DomainRatingCoolDown'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

// Fetches and stores Ahrefs DR for the given domains that have an active
// listing and need one. Each call to Ahrefs is logged. Claims keep
// overlapping requests from asking for the same domains, and an aborted
// request stops before it calls Ahrefs.
export async function enrichDomainRatings(
  store: DomainRatingStore,
  fetchRatings: FetchDomainRatings,
  requestedDomains: string[],
  { signal, now = () => new Date() }: { signal: AbortSignal; now?: () => Date }
): Promise<{ requested: number; stored: number }> {
  const unique = [...new Set(requestedDomains)].slice(0, DOMAIN_RATING_REQUEST_LIMIT)
  signal.throwIfAborted()
  if (unique.length === 0) return { requested: 0, stored: 0 }

  const startedAt = now()
  const coolDownUntil = await store.coolDownUntil(startedAt)
  if (coolDownUntil) {
    throw new DomainRatingCoolDown(
      Math.ceil((coolDownUntil.getTime() - startedAt.getTime()) / 1000)
    )
  }

  const claimUntil = new Date(startedAt.getTime() + DOMAIN_RATING_CLAIM_MS)
  const claimed = await store.claim(unique, startedAt, claimUntil)
  if (claimed.length === 0) return { requested: 0, stored: 0 }
  if (signal.aborted) {
    await store.release(claimed, claimUntil)
    signal.throwIfAborted()
  }

  let ratings: Map<string, number | null>
  try {
    ratings = await fetchRatings(claimed)
  } catch (error) {
    const code = error instanceof AhrefsError ? error.code : 'enrichment_failed'
    const coolDownSeconds =
      error instanceof AhrefsError && code === 'ahrefs_rate_limited'
        ? Math.min(
            Math.max(error.retryAfterSeconds ?? DEFAULT_COOL_DOWN_SECONDS, 1),
            MAX_COOL_DOWN_SECONDS
          )
        : null
    await store.record(
      {
        requestedAt: startedAt,
        domainCount: claimed.length,
        outcome: code,
        coolDownUntil:
          coolDownSeconds === null ? null : new Date(now().getTime() + coolDownSeconds * 1000)
      },
      []
    )
    throw error
  }

  const answeredAt = now()
  const results = claimed.map((domainName): DomainRatingResult => {
    const value = ratings.get(domainName)
    if (value === undefined) {
      return {
        domainName,
        status: 'omitted',
        value: null,
        retryAfter: new Date(answeredAt.getTime() + DOMAIN_RATING_OMITTED_RETRY_MS)
      }
    }
    return { domainName, status: value === null ? 'not_found' : 'ok', value, retryAfter: null }
  })
  const stored = await store.record(
    { requestedAt: startedAt, domainCount: claimed.length, outcome: 'ok', coolDownUntil: null },
    results
  )
  return { requested: claimed.length, stored }
}
