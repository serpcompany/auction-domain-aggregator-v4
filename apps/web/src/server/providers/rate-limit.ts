// Rate limits for provider APIs. Every paged-API provider declares one in the
// registry (`registry.ts`), and the Workflow builds a pacer from it that the
// adapter awaits before each request. The table of limits and their sources
// is in `docs/technical-design/provider-rate-limits.md`.

// The most often an API may be called, and where that number comes from.
export type RateLimit = {
  // Minimum time between the starts of two requests.
  intervalMs: number
  // The provider's published limit, or why there is none.
  source: string
}

// For a provider that publishes no limit, until it confirms a real one.
export const DEFAULT_RATE_LIMIT: RateLimit = {
  intervalMs: 2_000,
  source: 'no published limit; conservative default'
}

// Resolves when the next request may start. Concurrent callers take turns.
export type Pacer = () => Promise<void>

function sleep(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

// Spaces requests at least `intervalMs` apart. The first is not delayed.
export function createPacer(
  intervalMs: number,
  {
    now = Date.now,
    wait = sleep
  }: { now?: () => number; wait?: (milliseconds: number) => Promise<void> } = {}
): Pacer {
  let lastRequestAt = Number.NEGATIVE_INFINITY
  let previous = Promise.resolve()
  const turn = async () => {
    const delay = lastRequestAt + intervalMs - now()
    if (delay > 0) await wait(delay)
    lastRequestAt = now()
  }
  return () => {
    // A failed turn does not block the ones queued after it.
    previous = previous.then(turn, turn)
    return previous
  }
}

const SECONDS = /^\d+$/

// The delay an HTTP `Retry-After` header asks for, in milliseconds: either
// delay-seconds or an HTTP date. Null when absent or unparseable, so the
// caller falls back to its own backoff.
export function parseRetryAfter(value: string | null, now = Date.now()) {
  const text = value?.trim() ?? ''
  if (SECONDS.test(text)) return Number(text) * 1000
  // Every HTTP-date form starts with the day name.
  const date = /^[a-z]/i.test(text) ? Date.parse(text) : Number.NaN
  return Number.isNaN(date) ? null : Math.max(0, date - now)
}
