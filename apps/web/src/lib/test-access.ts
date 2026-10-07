/**
 * Test helper: a locally generated RSA key, its JWKS, and signed tokens shaped like Cloudflare
 * Access's, for an invented team domain and AUD tag. Nothing here is real.
 */
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose'

export const TEAM_DOMAIN = 'example-team.cloudflareaccess.com'
export const ISSUER = `https://${TEAM_DOMAIN}`
export const AUD = 'a'.repeat(64)
export const NOW = new Date('2026-10-07T12:00:00.000Z')
const seconds = Math.floor(NOW.getTime() / 1000)

export async function accessKeys(kid = 'test-key') {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }
  const jwks = { keys: [jwk] }

  async function sign(claims: JWTPayload = {}, key = privateKey) {
    return new SignJWT({
      iss: ISSUER,
      aud: [AUD],
      iat: seconds - 60,
      nbf: seconds - 60,
      exp: seconds + 3600,
      email: 'owner@example.test',
      type: 'app',
      ...claims
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .sign(key)
  }

  return { jwks, getKey: createLocalJWKSet(jwks), privateKey, sign }
}
