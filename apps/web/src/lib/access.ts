/**
 * Cloudflare Access in front of the deployed website (#92). Until accounts and billing exist,
 * Staging and Production are owner-only: Access sits on the canonical host and adds a signed
 * `Cf-Access-Jwt-Assertion` header, and the application Worker (`app-worker.ts`) verifies it
 * before Next.js runs, so a request that reaches the Worker any other way gets no data.
 *
 * The token must be RS256, signed by a key from `https://<team>/cdn-cgi/access/certs`, issued by
 * `https://<team>`, carry the Access application's AUD tag, and be within its `nbf`/`exp` window.
 * This module has no Next.js imports: it runs in the Worker entry before OpenNext.
 */
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose'

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion'

const TEAM_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/
const AUD_TAG = /^[a-f0-9]{64}$/

export type AccessEnv = {
  /** The Zero Trust team domain, for example `<team>.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string
  /** The Access application's Audience (AUD) tag, 64 hex characters. */
  ACCESS_AUD?: string
}

export type AccessConfig = {
  audience: string
  certsUrl: string
  issuer: string
}

/** The verification settings, or null when the team domain or AUD tag is unset or malformed. */
export function accessConfig(env: AccessEnv): AccessConfig | null {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase() ?? ''
  const audience = env.ACCESS_AUD?.trim().toLowerCase() ?? ''
  if (!TEAM_DOMAIN.test(teamDomain) || !AUD_TAG.test(audience)) return null
  return {
    audience,
    certsUrl: `https://${teamDomain}/cdn-cgi/access/certs`,
    issuer: `https://${teamDomain}`
  }
}

// One key set per certs URL and isolate. jose keeps the fetched keys for ten minutes, refetches
// when a token names an unknown key (at most every 30 seconds), and gives up after 5 seconds.
const remoteKeySets = new Map<string, JWTVerifyGetKey>()

export function remoteKeySet(certsUrl: string): JWTVerifyGetKey {
  let keySet = remoteKeySets.get(certsUrl)
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(certsUrl), {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000
    })
    remoteKeySets.set(certsUrl, keySet)
  }
  return keySet
}

export type VerifyAccessOptions = {
  /** Key resolver; defaults to the team's remote key set. Tests pass a local one. */
  getKey?: JWTVerifyGetKey
  /** Verification time; defaults to now. */
  now?: Date
}

/** True only for a valid Access token for this application; any failure is false. */
export async function hasValidAccessToken(
  request: Request,
  config: AccessConfig,
  options: VerifyAccessOptions
): Promise<boolean> {
  const token = request.headers.get(ACCESS_JWT_HEADER)?.trim()
  if (!token) return false
  try {
    await jwtVerify(token, options.getKey ?? remoteKeySet(config.certsUrl), {
      algorithms: ['RS256'],
      audience: config.audience,
      issuer: config.issuer,
      requiredClaims: ['exp', 'iat'],
      clockTolerance: 30,
      currentDate: options.now
    })
    return true
  } catch {
    return false
  }
}
