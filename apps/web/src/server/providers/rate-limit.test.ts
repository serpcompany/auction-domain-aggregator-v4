import { describe, expect, it, vi } from 'vitest'

import { createPacer, DEFAULT_RATE_LIMIT, parseRetryAfter } from './rate-limit'
import {
  type ApiProviderRegistration,
  PROVIDER_REGISTRY,
  type ProviderRegistration
} from './registry'

function fakeClock(start = 10_000) {
  let clock = start
  const waits: number[] = []
  return {
    waits,
    advance: (milliseconds: number) => {
      clock += milliseconds
    },
    now: () => clock,
    wait: async (milliseconds: number) => {
      waits.push(milliseconds)
      clock += milliseconds
    }
  }
}

describe('createPacer', () => {
  it('does not delay the first request and spaces sequential ones', async () => {
    const clock = fakeClock()
    const pace = createPacer(2_000, clock)
    await pace()
    expect(clock.waits).toEqual([])
    await pace()
    clock.advance(500)
    await pace()
    clock.advance(5_000)
    await pace()
    expect(clock.waits).toEqual([2_000, 1_500])
  })

  it('makes concurrent callers take turns', async () => {
    const clock = fakeClock()
    const pace = createPacer(1_000, clock)
    await Promise.all([pace(), pace(), pace()])
    expect(clock.waits).toEqual([1_000, 1_000])
  })

  it('lets later callers through after a failed wait', async () => {
    let fail = true
    const pace = createPacer(1_000, {
      now: () => 0,
      wait: async () => {
        if (fail) {
          fail = false
          throw new Error('timer failed')
        }
      }
    })
    await pace()
    await expect(pace()).rejects.toThrow('timer failed')
    await expect(pace()).resolves.toBeUndefined()
  })

  it('waits on a real timer by default', async () => {
    vi.useFakeTimers()
    try {
      const pace = createPacer(1_100)
      await pace()
      let released = false
      const second = pace().then(() => {
        released = true
      })
      await vi.advanceTimersByTimeAsync(1_099)
      expect(released).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await second
      expect(released).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')

  it('reads delay-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000)
    expect(parseRetryAfter(' 0 ', now)).toBe(0)
  })

  it('reads an HTTP date as the time until it, never negative', () => {
    expect(parseRetryAfter('Wed, 07 Oct 2026 12:10:00 GMT', now)).toBe(600_000)
    // The obsolete RFC 850 form.
    expect(parseRetryAfter('Wednesday, 07-Oct-26 12:00:30 GMT', now)).toBe(30_000)
    expect(parseRetryAfter('Wed, 07 Oct 2026 11:00:00 GMT', now)).toBe(0)
  })

  it('returns null when absent or unparseable, so the backoff applies', () => {
    for (const value of [null, '', 'soon', '-5', '1.5', '2026-10-07', 'Someday, never']) {
      expect(parseRetryAfter(value, now)).toBeNull()
    }
  })

  it('measures from the current time by default', () => {
    const inOneMinute = new Date(Date.now() + 60_000).toUTCString()
    expect(parseRetryAfter(inOneMinute)).toBeGreaterThan(55_000)
  })
})

describe('provider rate limits', () => {
  it('declares one for every registered provider', () => {
    for (const registration of Object.values(PROVIDER_REGISTRY)) {
      if (registration.fileFeed) {
        expect(registration.rateLimit).toBe('one download per run')
      } else {
        expect(registration.rateLimit.intervalMs).toBeGreaterThan(0)
        expect(registration.rateLimit.source).not.toBe('')
      }
    }
  })

  it('rejects an API provider registration without one at type-check time', () => {
    const createAdapter = () => ({ provider: 'dropcatch' as const, fetchPage: vi.fn() })
    // @ts-expect-error a paged API must declare its rate limit
    const missing: ProviderRegistration = { secretNames: [], createAdapter }
    const declared: ApiProviderRegistration = {
      secretNames: [],
      rateLimit: DEFAULT_RATE_LIMIT,
      createAdapter
    }
    expect(missing).not.toHaveProperty('rateLimit')
    expect(declared.rateLimit).toEqual({ intervalMs: 2_000, source: expect.any(String) })
  })
})
