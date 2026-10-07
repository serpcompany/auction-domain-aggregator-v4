import { describe, expect, it, vi } from 'vitest'

import { AhrefsError } from './ahrefs'
import {
  DOMAIN_RATING_CLAIM_MS,
  DOMAIN_RATING_OMITTED_RETRY_MS,
  DomainRatingCoolDown,
  enrichDomainRatings,
  type FetchDomainRatings
} from './domain-rating'
import { createMemoryDomainRatingStore } from './test-domain-rating-store'

const START = new Date('2026-10-07T12:00:00.000Z')

function at(offsetMs: number) {
  return () => new Date(START.getTime() + offsetMs)
}

function answering(ratings: Record<string, number | null>) {
  return vi.fn<FetchDomainRatings>(async () => new Map(Object.entries(ratings)))
}

const signal = new AbortController().signal

describe('enrichDomainRatings', () => {
  it('stores ratings, no-ratings and omissions for active domains and logs the call', async () => {
    const { store, rows, requests } = createMemoryDomainRatingStore([
      'rated.com',
      'unrated.com',
      'omitted.com'
    ])
    const fetchRatings = answering({ 'rated.com': 41.5, 'unrated.com': null })

    const result = await enrichDomainRatings(
      store,
      fetchRatings,
      ['rated.com', 'unrated.com', 'omitted.com', 'inactive.com', 'rated.com'],
      { signal, now: at(0) }
    )

    expect(result).toEqual({ requested: 3, stored: 3 })
    expect(fetchRatings).toHaveBeenCalledOnce()
    expect(fetchRatings).toHaveBeenCalledWith(['rated.com', 'unrated.com', 'omitted.com'])
    expect(Object.fromEntries(rows)).toEqual({
      'rated.com': { status: 'ok', value: 41.5, retryAfter: null },
      'unrated.com': { status: 'not_found', value: null, retryAfter: null },
      'omitted.com': {
        status: 'omitted',
        value: null,
        retryAfter: at(DOMAIN_RATING_OMITTED_RETRY_MS)()
      }
    })
    expect(requests).toEqual([
      { requestedAt: START, domainCount: 3, outcome: 'ok', coolDownUntil: null }
    ])
  })

  it('does nothing for no domains, or when every domain is settled', async () => {
    const { store, requests } = createMemoryDomainRatingStore(['rated.com'])
    const fetchRatings = answering({ 'rated.com': 10 })

    expect(await enrichDomainRatings(store, fetchRatings, [], { signal })).toEqual({
      requested: 0,
      stored: 0
    })
    await enrichDomainRatings(store, fetchRatings, ['rated.com'], { signal })
    expect(await enrichDomainRatings(store, fetchRatings, ['rated.com'], { signal })).toEqual({
      requested: 0,
      stored: 0
    })
    expect(fetchRatings).toHaveBeenCalledOnce()
    expect(requests).toHaveLength(1)
  })

  it('makes no Ahrefs call for an aborted request', async () => {
    const { store, rows, requests } = createMemoryDomainRatingStore(['a.com'])
    const fetchRatings = answering({ 'a.com': 1 })
    const controller = new AbortController()
    controller.abort()

    await expect(
      enrichDomainRatings(store, fetchRatings, ['a.com'], { signal: controller.signal })
    ).rejects.toThrow()
    expect(fetchRatings).not.toHaveBeenCalled()
    expect(rows.size).toBe(0)
    expect(requests).toHaveLength(0)
  })

  it('gives back its claims when aborted before the call', async () => {
    const { store, rows } = createMemoryDomainRatingStore(['a.com'])
    const fetchRatings = answering({ 'a.com': 1 })
    const controller = new AbortController()
    const claim = store.claim.bind(store)
    store.claim = async (...args) => {
      const claimed = await claim(...args)
      controller.abort()
      return claimed
    }

    await expect(
      enrichDomainRatings(store, fetchRatings, ['a.com'], {
        signal: controller.signal,
        now: at(0)
      })
    ).rejects.toThrow()
    expect(fetchRatings).not.toHaveBeenCalled()
    expect(rows.size).toBe(0)

    // The next request can claim the domain at once.
    store.claim = claim
    await enrichDomainRatings(store, fetchRatings, ['a.com'], { signal, now: at(1) })
    expect(fetchRatings).toHaveBeenCalledOnce()
  })

  it('makes one call for concurrent requests for the same domains', async () => {
    const { store, requests } = createMemoryDomainRatingStore(['a.com', 'b.com', 'c.com'])
    let answer: (ratings: Map<string, number | null>) => void = () => {}
    const fetchRatings = vi.fn<FetchDomainRatings>(
      () =>
        new Promise(resolve => {
          answer = resolve
        })
    )

    const first = enrichDomainRatings(store, fetchRatings, ['a.com', 'b.com'], {
      signal,
      now: at(0)
    })
    await vi.waitFor(() => expect(fetchRatings).toHaveBeenCalledOnce())
    const second = await enrichDomainRatings(store, fetchRatings, ['a.com', 'b.com'], {
      signal,
      now: at(10)
    })
    answer(
      new Map([
        ['a.com', 1],
        ['b.com', 2]
      ])
    )

    expect(second).toEqual({ requested: 0, stored: 0 })
    expect(await first).toEqual({ requested: 2, stored: 2 })
    expect(fetchRatings).toHaveBeenCalledOnce()
    expect(requests).toHaveLength(1)
  })

  it('asks again for a claim that lapsed, as when a call failed', async () => {
    const { store } = createMemoryDomainRatingStore(['a.com'])
    const failing = vi.fn<FetchDomainRatings>(async () => {
      throw new AhrefsError('ahrefs_http_error')
    })
    await expect(
      enrichDomainRatings(store, failing, ['a.com'], { signal, now: at(0) })
    ).rejects.toThrow('ahrefs_http_error')

    const fetchRatings = answering({ 'a.com': 5 })
    await enrichDomainRatings(store, fetchRatings, ['a.com'], {
      signal,
      now: at(DOMAIN_RATING_CLAIM_MS - 1)
    })
    expect(fetchRatings).not.toHaveBeenCalled()
    await enrichDomainRatings(store, fetchRatings, ['a.com'], {
      signal,
      now: at(DOMAIN_RATING_CLAIM_MS)
    })
    expect(fetchRatings).toHaveBeenCalledWith(['a.com'])
  })

  it('asks for an omitted domain again only after its retry time', async () => {
    const { store, rows } = createMemoryDomainRatingStore(['omitted.com'])
    const omitting = answering({})
    await enrichDomainRatings(store, omitting, ['omitted.com'], { signal, now: at(0) })
    await enrichDomainRatings(store, omitting, ['omitted.com'], {
      signal,
      now: at(DOMAIN_RATING_OMITTED_RETRY_MS - 1)
    })
    expect(omitting).toHaveBeenCalledOnce()

    const fetchRatings = answering({ 'omitted.com': 12 })
    const result = await enrichDomainRatings(store, fetchRatings, ['omitted.com'], {
      signal,
      now: at(DOMAIN_RATING_OMITTED_RETRY_MS)
    })
    expect(result).toEqual({ requested: 1, stored: 1 })
    expect(rows.get('omitted.com')).toEqual({ status: 'ok', value: 12, retryAfter: null })
  })

  it.each([
    ['Retry-After', 120, 120],
    ['no Retry-After', null, 60],
    ['a zero Retry-After', 0, 1],
    ['an excessive Retry-After', 86_400, 3600]
  ])('cools down after a 429 with %s', async (_label, retryAfterSeconds, coolDownSeconds) => {
    const { store, requests } = createMemoryDomainRatingStore(['a.com', 'b.com'])
    const limited = vi.fn<FetchDomainRatings>(async () => {
      throw new AhrefsError('ahrefs_rate_limited', retryAfterSeconds)
    })
    // The cool-down counts from Ahrefs' answer, two seconds after the call.
    const clock = vi.fn().mockReturnValueOnce(at(0)()).mockReturnValueOnce(at(2000)())
    await expect(
      enrichDomainRatings(store, limited, ['a.com'], { signal, now: clock })
    ).rejects.toThrow('ahrefs_rate_limited')
    const coolDownEnds = 2000 + coolDownSeconds * 1000
    expect(requests).toEqual([
      {
        requestedAt: START,
        domainCount: 1,
        outcome: 'ahrefs_rate_limited',
        coolDownUntil: at(coolDownEnds)()
      }
    ])

    const fetchRatings = answering({ 'b.com': 3 })
    const refused = await enrichDomainRatings(store, fetchRatings, ['b.com'], {
      signal,
      now: at(coolDownEnds - 1500)
    }).catch(error => error)
    expect(refused).toBeInstanceOf(DomainRatingCoolDown)
    expect(refused.retryAfterSeconds).toBe(2)
    expect(fetchRatings).not.toHaveBeenCalled()

    await enrichDomainRatings(store, fetchRatings, ['b.com'], { signal, now: at(coolDownEnds) })
    expect(fetchRatings).toHaveBeenCalledOnce()
    expect(requests).toHaveLength(2)
  })

  it.each([
    [new AhrefsError('ahrefs_unauthorized'), 'ahrefs_unauthorized'],
    [new Error('unexpected'), 'enrichment_failed']
  ])('logs a failed call as %s without a cool-down', async (error, outcome) => {
    const { store, requests } = createMemoryDomainRatingStore(['a.com'])
    await expect(
      enrichDomainRatings(
        store,
        async () => {
          throw error
        },
        ['a.com'],
        { signal, now: at(0) }
      )
    ).rejects.toBe(error)
    expect(requests).toEqual([{ requestedAt: START, domainCount: 1, outcome, coolDownUntil: null }])
  })

  it('uses the real clock by default', async () => {
    const { store, requests } = createMemoryDomainRatingStore(['a.com'])
    const before = Date.now()
    await enrichDomainRatings(store, answering({ 'a.com': 1 }), ['a.com'], { signal })
    expect(requests[0]?.requestedAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})
