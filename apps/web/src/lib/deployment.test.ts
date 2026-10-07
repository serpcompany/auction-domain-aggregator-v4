// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { canonicalHostRedirect, deployment, SMOKE_TEST_HEADER } from './deployment'
import { AUD, TEAM_DOMAIN } from './test-access'

const access = { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD }
const HOST = 'staging.auctions.example.test'

describe('deployment', () => {
  it('skips the deployed checks only for an explicit local run', () => {
    expect(deployment({ APP_ENV: 'local' })).toEqual({ kind: 'local' })
  })

  it('treats every other APP_ENV as a deployment that needs its host and Access settings', () => {
    for (const APP_ENV of ['staging', 'production', undefined, '', 'Local']) {
      expect(deployment({ APP_ENV, CANONICAL_HOST: HOST, ...access })).toEqual({
        kind: 'deployed',
        canonicalHost: HOST,
        access: {
          audience: AUD,
          issuer: `https://${TEAM_DOMAIN}`,
          certsUrl: `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`
        }
      })
    }
    expect(
      deployment({ APP_ENV: 'staging', CANONICAL_HOST: ` ${HOST.toUpperCase()} `, ...access })
    ).toMatchObject({
      canonicalHost: HOST
    })
  })

  it('is misconfigured without a valid canonical host or Access settings', () => {
    for (const env of [
      { APP_ENV: 'staging' },
      { APP_ENV: 'staging', ...access },
      { APP_ENV: 'staging', CANONICAL_HOST: '', ...access },
      { APP_ENV: 'staging', CANONICAL_HOST: `https://${HOST}`, ...access },
      { APP_ENV: 'staging', CANONICAL_HOST: `${HOST}/`, ...access },
      { APP_ENV: 'staging', CANONICAL_HOST: `${HOST}:443`, ...access },
      { APP_ENV: 'production', CANONICAL_HOST: HOST },
      { APP_ENV: 'production', CANONICAL_HOST: HOST, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' }
    ]) {
      expect(deployment(env), JSON.stringify(env)).toEqual({ kind: 'misconfigured' })
    }
  })
})

describe('canonicalHostRedirect', () => {
  const redirect = (url: string, headers: HeadersInit = {}) => {
    const response = canonicalHostRedirect(new Request(url, { headers }), new URL(url), HOST)
    return response && { status: response.status, location: response.headers.get('location') }
  }

  it('leaves the canonical host alone', () => {
    expect(redirect(`https://${HOST}/filters/?tld=com`)).toBeNull()
    expect(redirect(`https://${HOST}/filters?tld=com`)).toBeNull()
  })

  it('sends every other host to the canonical one in one hop, in canonical slash form', () => {
    const workersDev = 'https://auction-domain-aggregator-web-staging.example.workers.dev'
    expect(redirect(`${workersDev}/`)).toEqual({ status: 308, location: `https://${HOST}/` })
    expect(redirect(`${workersDev}/filters?tld=com&tld=co`)).toEqual({
      status: 308,
      location: `https://${HOST}/filters/?tld=com&tld=co`
    })
    expect(redirect(`${workersDev}/syncs/`)).toEqual({
      status: 308,
      location: `https://${HOST}/syncs/`
    })
    expect(redirect(`${workersDev}/api/health?x=1`)).toEqual({
      status: 308,
      location: `https://${HOST}/api/health?x=1`
    })
    expect(redirect(`https://${HOST}:8443/`)).toEqual({ status: 308, location: `https://${HOST}/` })
  })

  it('exempts requests with the smoke-test header', () => {
    expect(
      redirect('https://auction-domain-aggregator-web-staging.example.workers.dev/', {
        [SMOKE_TEST_HEADER]: '1'
      })
    ).toBeNull()
  })
})
