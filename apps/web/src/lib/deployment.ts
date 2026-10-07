/**
 * What the application Worker (`app-worker.ts`) needs to know about where it runs, read per
 * request from the environment's `vars` (`wrangler.jsonc`).
 *
 * Only `APP_ENV=local` (the top level of `wrangler.jsonc` and the browser-test configuration) runs
 * without the deployed checks. Any other value, including a missing one, is a deployment, which
 * needs a valid canonical host and Access configuration; without them it is `misconfigured` and
 * the Worker answers 503, so a mistake fails closed rather than serving data.
 */
import { type AccessConfig, type AccessEnv, accessConfig } from './access'
import { canonicalPath } from './trailing-slash'

/**
 * SERP environment-configuration standard: CI reaches a deployment through its `*.workers.dev`
 * host with this header, which exempts the request from the canonical-host redirect only. It is
 * not a secret and grants nothing else: the Access check still applies.
 */
export const SMOKE_TEST_HEADER = 'x-auction-domain-aggregator-smoke-test'

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export type DeploymentEnv = AccessEnv & {
  APP_ENV?: string
  /** The environment's one canonical host, for example `staging-auctions.serp.co`. */
  CANONICAL_HOST?: string
}

export type Deployment =
  | { kind: 'local' }
  | { kind: 'misconfigured' }
  | { kind: 'deployed'; canonicalHost: string; access: AccessConfig }

export function deployment(env: DeploymentEnv): Deployment {
  if (env.APP_ENV === 'local') return { kind: 'local' }
  const canonicalHost = env.CANONICAL_HOST?.trim().toLowerCase() ?? ''
  const access = accessConfig(env)
  if (!HOST.test(canonicalHost) || !access) return { kind: 'misconfigured' }
  return { kind: 'deployed', canonicalHost, access }
}

/**
 * A 308 to the canonical host, in one hop with the canonical slash form, for every other host
 * (`*.workers.dev`), unless the request carries the smoke-test header. Null when none applies.
 */
export function canonicalHostRedirect(
  request: Request,
  url: URL,
  canonicalHost: string
): Response | null {
  if (url.host === canonicalHost || request.headers.has(SMOKE_TEST_HEADER)) return null
  const path = canonicalPath(url) ?? `${url.pathname}${url.search}`
  return new Response(null, {
    status: 308,
    headers: { location: `https://${canonicalHost}${path}` }
  })
}
