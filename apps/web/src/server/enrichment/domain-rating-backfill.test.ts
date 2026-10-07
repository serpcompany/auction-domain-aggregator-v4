import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AhrefsError } from './ahrefs'
import type { AhrefsRequestRecord, DomainRatingResult } from './domain-rating'
import {
  type BackfillStepRunner,
  type DomainRatingBackfillStore,
  MAX_RATE_DOMAINS_CALLS,
  RATE_DOMAINS_INTERVAL_MS,
  runDomainRatingBackfill
} from './domain-rating-backfill'

const NOW = new Date('2026-10-08T12:00:00.000Z')

// An in-memory store over a sorted inventory of unrated domains.
function fakeStore(inventory: string[], coolDowns: Array<Date | null> = []) {
  const recorded: Array<{ request: AhrefsRequestRecord; results: DomainRatingResult[] }> = []
  const rated = new Set<string>()
  const store: DomainRatingBackfillStore = {
    coolDownUntil: vi.fn(async () => coolDowns.shift() ?? null),
    domainsToRate: vi.fn(async (after: string, _now: Date, limit: number) =>
      inventory.filter(domain => domain > after && !rated.has(domain)).slice(0, limit)
    ),
    record: vi.fn(async (request: AhrefsRequestRecord, results: DomainRatingResult[]) => {
      recorded.push({ request, results })
      for (const { domainName } of results) rated.add(domainName)
      return results.length
    })
  }
  return { store, recorded }
}

function fakeStep() {
  const names: string[] = []
  const sleeps: Array<[string, number]> = []
  const step: BackfillStepRunner = {
    do: async (name, _config, callback) => {
      names.push(name)
      return callback()
    },
    sleep: async (name, milliseconds) => {
      sleeps.push([name, milliseconds])
    }
  }
  return { step, names, sleeps }
}

const nonRetryable = (code: string) => new Error(`final: ${code}`)
const domains = (count: number, prefix = 'd') =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(5, '0')}.com`)

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('Domain Rating backfill', () => {
  it('rates the inventory 1,000 domains per paced call, then stops', async () => {
    const inventory = domains(2_500)
    const { store, recorded } = fakeStore(inventory)
    const { step, names, sleeps } = fakeStep()
    const fetchRatings = vi.fn(
      async (batch: string[]) => new Map(batch.map(domain => [domain, 12] as const))
    )

    const summary = await runDomainRatingBackfill({
      step,
      store,
      fetchRatings,
      nonRetryable,
      now: () => NOW
    })

    expect(summary).toEqual({
      status: 'succeeded',
      calls: 3,
      requested: 2_500,
      stored: 2_500,
      complete: true
    })
    expect(fetchRatings.mock.calls.map(([batch]) => batch.length)).toEqual([1_000, 1_000, 500])
    // Each step continues after the last domain the previous one rated.
    expect(vi.mocked(store.domainsToRate).mock.calls.map(([after]) => after)).toEqual([
      '',
      'd00999.com',
      'd01999.com',
      'd02499.com'
    ])
    expect(recorded.every(({ request }) => request.outcome === 'ok')).toBe(true)
    expect(names).toEqual([
      'rate domains, step 1',
      'rate domains, step 2',
      'rate domains, step 3',
      'rate domains, step 4'
    ])
    expect(sleeps).toEqual([1, 2, 3].map(n => [`pace after step ${n}`, RATE_DOMAINS_INTERVAL_MS]))
    expect(console.info).toHaveBeenCalledWith('domain_rating_backfill', summary)
  })

  it('waits for the provider syncs, and passes over names Ahrefs cannot take', async () => {
    const { store } = fakeStore(['bad"name.com', 'good.com', 'x_y.com'])
    const { step, sleeps } = fakeStep()
    const fetchRatings = vi.fn(async () => new Map([['good.com', null]]))

    const summary = await runDomainRatingBackfill({
      step,
      store,
      fetchRatings,
      nonRetryable,
      startDelayMs: 3_600_000,
      now: () => NOW
    })

    expect(sleeps[0]).toEqual(['wait for the provider syncs', 3_600_000])
    expect(fetchRatings).toHaveBeenCalledWith(['good.com'])
    expect(summary).toMatchObject({ calls: 1, requested: 1, stored: 1, complete: true })
  })

  it('moves past a batch with no name Ahrefs can take, without calling it', async () => {
    const { store } = fakeStore(['a_b.com'])
    const { step } = fakeStep()
    const fetchRatings = vi.fn()

    const summary = await runDomainRatingBackfill({ step, store, fetchRatings, nonRetryable })

    expect(fetchRatings).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ calls: 0, requested: 0, complete: true })
    expect(vi.mocked(store.domainsToRate).mock.calls.at(-1)?.[0]).toBe('a_b.com')
  })

  it('waits out a cool-down, including one its own call caused', async () => {
    const until = new Date(NOW.getTime() + 90_000)
    // Step 1's call is rate-limited, so step 2 finds the cool-down it set.
    const { store, recorded } = fakeStore(domains(3), [null, until])
    const { step, sleeps } = fakeStep()
    const fetchRatings = vi
      .fn()
      .mockRejectedValueOnce(new AhrefsError('ahrefs_rate_limited', 90))
      .mockImplementation(
        async (batch: string[]) => new Map(batch.map(domain => [domain, 1] as const))
      )

    const summary = await runDomainRatingBackfill({
      step,
      store,
      fetchRatings,
      nonRetryable,
      now: () => NOW
    })

    expect(recorded[0]?.request).toMatchObject({ outcome: 'ahrefs_rate_limited' })
    expect(sleeps).toContainEqual(['wait for the Ahrefs cool-down, step 2', 90_000])
    // The refused call counts toward the budget.
    expect(summary).toMatchObject({ calls: 2, requested: 3, stored: 3, complete: true })
  })

  it('stops at its call budget with domains left', async () => {
    const { store } = fakeStore(domains(3_000))
    const { step } = fakeStep()
    const fetchRatings = vi.fn(
      async (batch: string[]) => new Map(batch.map(domain => [domain, 5] as const))
    )

    const summary = await runDomainRatingBackfill({
      step,
      store,
      fetchRatings,
      nonRetryable,
      maxCalls: 2
    })

    expect(summary).toMatchObject({ calls: 2, requested: 2_000, complete: false })
    expect(MAX_RATE_DOMAINS_CALLS).toBe(1_000)
  })

  it('ends the run on a rejected key, and leaves other failures to the step retries', async () => {
    const unauthorized = fakeStore(domains(1))
    await expect(
      runDomainRatingBackfill({
        step: fakeStep().step,
        store: unauthorized.store,
        fetchRatings: vi.fn().mockRejectedValue(new AhrefsError('ahrefs_unauthorized')),
        nonRetryable
      })
    ).rejects.toThrow('final: ahrefs_unauthorized')
    expect(unauthorized.recorded[0]?.request.outcome).toBe('ahrefs_unauthorized')

    await expect(
      runDomainRatingBackfill({
        step: fakeStep().step,
        store: fakeStore(domains(1)).store,
        fetchRatings: vi.fn().mockRejectedValue(new AhrefsError('ahrefs_http_error')),
        nonRetryable
      })
    ).rejects.toThrow('ahrefs_http_error')
  })
})
