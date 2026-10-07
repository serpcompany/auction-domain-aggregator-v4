// @vitest-environment node
import { generateKeyPair, SignJWT } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ACCESS_JWT_HEADER, accessConfig, hasValidAccessToken, remoteKeySet } from './access'
import { AUD, accessKeys, ISSUER, NOW, TEAM_DOMAIN } from './test-access'

const config = { audience: AUD, issuer: ISSUER, certsUrl: `${ISSUER}/cdn-cgi/access/certs` }

function request(token?: string) {
  const headers = new Headers()
  if (token !== undefined) headers.set(ACCESS_JWT_HEADER, token)
  return new Request('https://staging.example.test/', { headers })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('accessConfig', () => {
  it('builds the issuer and certs URL from the team domain', () => {
    expect(accessConfig({ ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD })).toEqual(config)
    expect(
      accessConfig({
        ACCESS_TEAM_DOMAIN: ` ${TEAM_DOMAIN.toUpperCase()} `,
        ACCESS_AUD: AUD.toUpperCase()
      })
    ).toEqual(config)
  })

  it('is null for a missing or malformed team domain or AUD tag', () => {
    for (const env of [
      {},
      { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' },
      { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN },
      { ACCESS_AUD: AUD },
      { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: 'a'.repeat(63) },
      { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: 'g'.repeat(64) },
      { ACCESS_TEAM_DOMAIN: `https://${TEAM_DOMAIN}`, ACCESS_AUD: AUD },
      { ACCESS_TEAM_DOMAIN: 'example-team.example.com', ACCESS_AUD: AUD },
      { ACCESS_TEAM_DOMAIN: `${TEAM_DOMAIN}/`, ACCESS_AUD: AUD }
    ]) {
      expect(accessConfig(env)).toBeNull()
    }
  })
})

describe('hasValidAccessToken', () => {
  it('accepts a token signed by the team key for this application', async () => {
    const keys = await accessKeys()
    const token = await keys.sign()
    await expect(
      hasValidAccessToken(request(token), config, { getKey: keys.getKey, now: NOW })
    ).resolves.toBe(true)
    // A single string `aud` is accepted as well as Access's array form.
    const single = await keys.sign({ aud: AUD })
    await expect(
      hasValidAccessToken(request(single), config, { getKey: keys.getKey, now: NOW })
    ).resolves.toBe(true)
  })

  it('rejects a missing or empty token', async () => {
    const keys = await accessKeys()
    const options = { getKey: keys.getKey, now: NOW }
    await expect(hasValidAccessToken(request(), config, options)).resolves.toBe(false)
    await expect(hasValidAccessToken(request('  '), config, options)).resolves.toBe(false)
    await expect(hasValidAccessToken(request('not-a-jwt'), config, options)).resolves.toBe(false)
  })

  it('rejects the wrong audience, issuer, or time window', async () => {
    const keys = await accessKeys()
    const options = { getKey: keys.getKey, now: NOW }
    const seconds = Math.floor(NOW.getTime() / 1000)
    for (const claims of [
      { aud: ['b'.repeat(64)] },
      { iss: 'https://other-team.cloudflareaccess.com' },
      { exp: seconds - 120 },
      { nbf: seconds + 120 },
      { exp: undefined },
      { iat: undefined }
    ]) {
      const token = await keys.sign(claims)
      await expect(
        hasValidAccessToken(request(token), config, options),
        JSON.stringify(claims)
      ).resolves.toBe(false)
    }
  })

  it('rejects a token signed by another key or with another algorithm', async () => {
    const keys = await accessKeys()
    const options = { getKey: keys.getKey, now: NOW }
    const other = await generateKeyPair('RS256')
    await expect(
      hasValidAccessToken(request(await keys.sign({}, other.privateKey)), config, options)
    ).resolves.toBe(false)

    const hmac = await new SignJWT({ aud: [AUD], iss: ISSUER })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setIssuedAt(NOW)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a shared secret that is long enough'))
    await expect(hasValidAccessToken(request(hmac), config, options)).resolves.toBe(false)
  })

  it("fetches the team's keys once per isolate and verifies against them", async () => {
    const keys = await accessKeys('remote-key')
    const fetchMock = vi.fn(async () => Response.json(keys.jwks))
    vi.stubGlobal('fetch', fetchMock)
    const remote = {
      ...config,
      certsUrl: 'https://remote-team.cloudflareaccess.com/cdn-cgi/access/certs'
    }
    const token = await keys.sign()

    await expect(hasValidAccessToken(request(token), remote, { now: NOW })).resolves.toBe(true)
    await expect(hasValidAccessToken(request(token), remote, { now: NOW })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(remote.certsUrl)
    expect(remoteKeySet(remote.certsUrl)).toBe(remoteKeySet(remote.certsUrl))
  })

  it('fails closed when the keys cannot be fetched', async () => {
    const keys = await accessKeys('unreachable-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 }))
    )
    const remote = {
      ...config,
      certsUrl: 'https://down-team.cloudflareaccess.com/cdn-cgi/access/certs'
    }
    await expect(
      hasValidAccessToken(request(await keys.sign()), remote, { now: NOW })
    ).resolves.toBe(false)
  })
})
