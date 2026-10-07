// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { createAppWorker } from '../src/lib/app-worker'
import { AUD, TEAM_DOMAIN } from '../src/lib/test-access'
import { runSmoke, type SmokeTarget, smokeFailures } from './smoke-checks'

const HOST = 'staging.auctions.example.test'
const ORIGIN = 'https://auction-domain-aggregator-web-staging.example.workers.dev'

// The smoke test run against the real application Worker, as each environment configures it.
function deployedFetch(APP_ENV: string, openNext = vi.fn(async () => new Response('rows'))) {
  const app = createAppWorker({ fetch: openNext })
  const env = { APP_ENV, CANONICAL_HOST: HOST, ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD }
  return (url: string, init: RequestInit) =>
    app.fetch(new Request(url, init), env as unknown as CloudflareEnv, {} as ExecutionContext)
}

const target = (env: SmokeTarget['env']): SmokeTarget => ({
  env,
  origin: ORIGIN,
  canonicalHost: HOST
})

describe('smokeFailures', () => {
  it('passes against the application Worker in both environments', async () => {
    const openNext = vi.fn(async () => new Response('rows'))
    await expect(
      smokeFailures(deployedFetch('staging', openNext), target('staging'))
    ).resolves.toEqual([])
    await expect(
      smokeFailures(deployedFetch('production', openNext), target('production'))
    ).resolves.toEqual([])
    expect(openNext).not.toHaveBeenCalled()
  })

  it('fails when data is served, the indexing policy is wrong, or the host is not redirected', async () => {
    const open = async () =>
      new Response('rows', { headers: { location: 'https://elsewhere.test/' } })
    const failures = await smokeFailures(open, target('staging'))
    expect(failures).toEqual([
      'GET / without an Access token: 200, expected 403',
      'GET /: x-robots-tag null in staging',
      'GET /api/health without an Access token: 200, expected 403',
      'GET /api/health: x-robots-tag null in staging',
      'GET /robots.txt: 200, crawling not disallowed',
      `GET /filters?tld=com without the smoke-test header: 200 to https://elsewhere.test/, expected 308 to https://${HOST}/filters/?tld=com`
    ])
    // Staging's policy is not Production's.
    const production = await smokeFailures(deployedFetch('staging'), target('production'))
    expect(production).toContain('GET /: x-robots-tag "noindex, nofollow" in production')
    expect(production).toContain('GET /robots.txt: 200, crawling not allowed')
  })
})

describe('runSmoke', () => {
  it('retries until the new version answers, then gives up', async () => {
    const log = vi.fn()
    const working = deployedFetch('staging')
    let calls = 0
    const flaky = (url: string, init: RequestInit) => {
      calls++
      if (calls === 1) return Promise.reject(new Error('connection reset'))
      return working(url, init)
    }
    await expect(
      runSmoke(flaky, target('staging'), { attempts: 3, delayMs: 0, log })
    ).resolves.toEqual([])
    expect(log).toHaveBeenCalledWith('attempt 1/3: request failed: connection reset')

    const broken = () => Promise.reject('down')
    const failures = await runSmoke(broken, target('staging'), { attempts: 2, delayMs: 0, log })
    expect(failures).toEqual(['request failed: unknown error'])
    expect(log).toHaveBeenLastCalledWith('attempt 2/2: request failed: unknown error')
  })
})
