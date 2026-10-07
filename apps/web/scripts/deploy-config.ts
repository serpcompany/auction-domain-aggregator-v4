import { fileURLToPath } from 'node:url'
import { unstable_readConfig } from 'wrangler'

import { type DeploymentEnv, deployment } from '../src/lib/deployment'

export const DEPLOYED_ENVIRONMENTS = ['staging', 'production'] as const
export type DeployedEnvironment = (typeof DEPLOYED_ENVIRONMENTS)[number]

export const WEB_CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
export const SYNC_CONFIG = fileURLToPath(new URL('../wrangler.ingestion.jsonc', import.meta.url))

export function isDeployedEnvironment(value: unknown): value is DeployedEnvironment {
  return DEPLOYED_ENVIRONMENTS.includes(value as DeployedEnvironment)
}

/** A website environment resolved the way Wrangler resolves it for a deploy. */
export function readWebEnvironment(env: DeployedEnvironment, config = WEB_CONFIG) {
  const resolved = unstable_readConfig({ config, env })
  const vars = resolved.vars as DeploymentEnv
  return {
    name: resolved.name,
    canonicalHost: vars.CANONICAL_HOST ?? '',
    // The Worker's own per-request check: a deployment with its canonical host and Access
    // configuration. Anything else would answer 503 (or, with APP_ENV "local", skip Access).
    configured: deployment(vars).kind === 'deployed'
  }
}
