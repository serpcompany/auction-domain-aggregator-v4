// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ACCESS_JWT_HEADER } from './access'
import { createAppWorker } from './app-worker'
import { SMOKE_TEST_HEADER } from './deployment'
import { AUD, accessKeys, NOW, TEAM_DOMAIN } from './test-access'

const ctx = {} as ExecutionContext
const env = (APP_ENV: string) => ({ APP_ENV }) as CloudflareEnv
const HOST = 'staging.auctions.example.test'
const WORKERS_DEV = 'https://auction-domain-aggregator-web-staging.example.workers.dev'
const deployed = (APP_ENV: string, vars: Partial<Record<string, string>> = {}) =>
  ({
    APP_ENV,
    CANONICAL_HOST: HOST,
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUD,
    ...vars
  }) as unknown as CloudflareEnv

async function worker() {
  const openNext = { fetch: vi.fn(async () => new Response('page', { status: 201 })) }
  const keys = await accessKeys()
  return { openNext, keys, app: createAppWorker(openNext, { getKey: keys.getKey, now: NOW }) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createAppWorker, local', () => {
  it('hands canonical requests to OpenNext and marks them noindex outside production', async () => {
    const { openNext, app } = await worker()
    const request = new Request('https://example.test/filters/?tld=com')
    const response = await app.fetch(request, env('local'), ctx)
    expect(openNext.fetch).toHaveBeenCalledWith(request, env('local'), ctx)
    expect(response.status).toBe(201)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    await expect(response.text()).resolves.toBe('page')
  })

  it('redirects to the canonical slash without calling OpenNext', async () => {
    const { openNext, app } = await worker()
    const response = await app.fetch(
      new Request('https://example.test/filters?tld=com'),
      env('local'),
      ctx
    )
    expect(openNext.fetch).not.toHaveBeenCalled()
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('/filters/?tld=com')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  it('answers robots.txt itself', async () => {
    const { openNext, app } = await worker()
    const local = await app.fetch(new Request('https://example.test/robots.txt'), env('local'), ctx)
    await expect(local.text()).resolves.toBe('User-agent: *\nDisallow: /\n')
    expect(local.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(openNext.fetch).not.toHaveBeenCalled()
  })
})

describe('createAppWorker, deployed', () => {
  it('fails closed with 503 when the host or Access configuration is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { openNext, keys, app } = await worker()
    const token = await keys.sign()
    for (const vars of [{ ACCESS_AUD: '' }, { ACCESS_TEAM_DOMAIN: '' }, { CANONICAL_HOST: '' }]) {
      const response = await app.fetch(
        new Request(`https://${HOST}/`, { headers: { [ACCESS_JWT_HEADER]: token } }),
        deployed('staging', vars),
        ctx
      )
      expect(response.status).toBe(503)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    }
    // No APP_ENV at all is a deployment too, never a local run.
    const unset = await app.fetch(new Request('https://example.test/'), {} as CloudflareEnv, ctx)
    expect(unset.status).toBe(503)
    expect(openNext.fetch).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('deployment_not_configured'))
  })

  it('redirects other hosts to the canonical host unless they carry the smoke-test header', async () => {
    const { openNext, app } = await worker()
    const redirect = await app.fetch(
      new Request(`${WORKERS_DEV}/filters?tld=com`),
      deployed('staging'),
      ctx
    )
    expect(redirect.status).toBe(308)
    expect(redirect.headers.get('location')).toBe(`https://${HOST}/filters/?tld=com`)
    expect(redirect.headers.get('x-robots-tag')).toBe('noindex, nofollow')

    // The header skips the redirect only: there is still no data without an Access token.
    const smoke = await app.fetch(
      new Request(`${WORKERS_DEV}/`, { headers: { [SMOKE_TEST_HEADER]: '1' } }),
      deployed('staging'),
      ctx
    )
    expect(smoke.status).toBe(403)
    expect(openNext.fetch).not.toHaveBeenCalled()
  })

  it('refuses every path without a valid Access token, before any redirect or page', async () => {
    const { openNext, keys, app } = await worker()
    const expired = await keys.sign({ exp: Math.floor(NOW.getTime() / 1000) - 120 })
    for (const [path, headers] of [
      ['/', {}],
      ['/filters?tld=com', {}],
      ['/api/health', {}],
      ['/api/enrichment/domain-rating', { [ACCESS_JWT_HEADER]: 'not-a-jwt' }],
      ['/', { [ACCESS_JWT_HEADER]: expired }]
    ] as const) {
      const response = await app.fetch(
        new Request(`https://${HOST}${path}`, { headers }),
        deployed('production'),
        ctx
      )
      expect(response.status, path).toBe(403)
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(response.headers.get('x-robots-tag')).toBeNull()
    }
    expect(openNext.fetch).not.toHaveBeenCalled()
  })

  it('serves the app with a valid Access token on the canonical host', async () => {
    const { openNext, keys, app } = await worker()
    const headers = { [ACCESS_JWT_HEADER]: await keys.sign() }
    const page = await app.fetch(
      new Request(`https://${HOST}/filters/`, { headers }),
      deployed('staging'),
      ctx
    )
    expect(page.status).toBe(201)
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')

    const production = await app.fetch(
      new Request(`https://${HOST}/`, { headers }),
      deployed('production'),
      ctx
    )
    expect(production.status).toBe(201)
    expect(production.headers.get('x-robots-tag')).toBeNull()

    const slash = await app.fetch(
      new Request(`https://${HOST}/syncs`, { headers }),
      deployed('staging'),
      ctx
    )
    expect(slash.status).toBe(308)
    expect(slash.headers.get('location')).toBe('/syncs/')
    expect(openNext.fetch).toHaveBeenCalledTimes(2)
  })

  it('answers robots.txt without a token, with the environment policy', async () => {
    const { openNext, app } = await worker()
    const staging = await app.fetch(
      new Request(`https://${HOST}/robots.txt`),
      deployed('staging'),
      ctx
    )
    await expect(staging.text()).resolves.toBe('User-agent: *\nDisallow: /\n')
    const production = await app.fetch(
      new Request(`https://${HOST}/robots.txt`),
      deployed('production'),
      ctx
    )
    await expect(production.text()).resolves.toBe('User-agent: *\nAllow: /\n')
    expect(production.headers.get('x-robots-tag')).toBeNull()
    expect(openNext.fetch).not.toHaveBeenCalled()
  })
})
