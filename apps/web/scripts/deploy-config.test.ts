// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { experimental_readRawConfig, unstable_readConfig } from 'wrangler'

import {
  DEPLOYED_ENVIRONMENTS,
  isDeployedEnvironment,
  readWebEnvironment,
  SYNC_CONFIG,
  WEB_CONFIG
} from './deploy-config'

const HOSTS = { staging: 'staging-auctions.serp.co', production: 'auctions.serp.co' }
const DATABASES = {
  staging: '3098593e-a81d-4e62-a4d7-f4cb9a750217',
  production: 'b6bbc65a-d376-4191-b9ae-a8f4290ac3dc'
}

// Each configuration resolved the way Wrangler resolves it for a deploy.
describe.each(DEPLOYED_ENVIRONMENTS)('the %s environment', env => {
  const web = unstable_readConfig({ config: WEB_CONFIG, env })
  const sync = unstable_readConfig({ config: SYNC_CONFIG, env })

  it('names its own website Worker, bound to its own canonical host and D1', () => {
    expect(web.name).toBe(`auction-domain-aggregator-web-${env}`)
    expect(web.routes).toEqual([{ pattern: HOSTS[env], custom_domain: true }])
    expect(web.workers_dev).toBe(true)
    expect(web.preview_urls).toBe(false)
    expect(web.assets).toMatchObject({ binding: 'ASSETS', directory: '.open-next/assets' })
    expect(web.services).toEqual([{ binding: 'WORKER_SELF_REFERENCE', service: web.name }])
    expect(web.observability?.enabled).toBe(true)
    // One Access application, "auctions", covers both hosts.
    expect(web.vars).toEqual({
      APP_ENV: env,
      SYNC_TIME_UTC: env === 'staging' ? '23:30' : '15:30',
      CANONICAL_HOST: HOSTS[env],
      ACCESS_TEAM_DOMAIN: 'serpcompany.cloudflareaccess.com',
      ACCESS_AUD: '2f037e169be96253359803b70ae3dd3e87395486cbd1b873bcab49592073d8bb'
    })
    expect(web.d1_databases).toEqual([
      expect.objectContaining({
        binding: 'DB',
        database_name: `auction-domain-aggregator-${env}`,
        database_id: DATABASES[env],
        migrations_table: 'd1_migrations'
      })
    ])
    // Nothing user-facing reads the sync's transient feed pages.
    expect(web.r2_buckets).toEqual([])
  })

  it('has a sync Worker with its own Workflow, R2 bucket, and the same D1', () => {
    expect(sync.name).toBe(`auction-domain-aggregator-ingestion-${env}`)
    expect(sync.workers_dev).toBe(false)
    expect(sync.preview_urls).toBe(false)
    expect(sync.observability?.enabled).toBe(true)
    expect(sync.workflows).toEqual([
      {
        name: `auction-domain-aggregator-provider-sync-${env}`,
        binding: 'PROVIDER_SYNC',
        class_name: 'ProviderSyncWorkflow'
      }
    ])
    expect(sync.r2_buckets).toEqual([
      { binding: 'FEED_PAGES', bucket_name: `auction-domain-aggregator-feed-pages-${env}` }
    ])
    expect(sync.d1_databases).toEqual(web.d1_databases)
    expect(sync.triggers.crons).toEqual([env === 'staging' ? '30 23 * * *' : '30 15 * * *'])
  })

  it('is configured, so the CI deploy guard lets the website deploy', () => {
    expect(readWebEnvironment(env)).toEqual({
      name: web.name,
      canonicalHost: HOSTS[env],
      configured: true
    })
  })
})

describe('deploy configuration', () => {
  it('deploys only the named environments; the top level stays local', () => {
    expect(
      Object.keys(experimental_readRawConfig({ config: WEB_CONFIG }).rawConfig.env ?? {})
    ).toEqual([...DEPLOYED_ENVIRONMENTS])
    for (const config of [WEB_CONFIG, SYNC_CONFIG]) {
      const local = unstable_readConfig({ config })
      expect(local.d1_databases).toEqual([expect.objectContaining({ remote: false })])
    }
    expect(unstable_readConfig({ config: WEB_CONFIG }).vars).toEqual({
      APP_ENV: 'local',
      SYNC_TIME_UTC: '15:30'
    })
  })

  it('recognizes only the deployed environment names', () => {
    expect(isDeployedEnvironment('staging')).toBe(true)
    expect(isDeployedEnvironment('production')).toBe(true)
    expect(isDeployedEnvironment('local')).toBe(false)
    expect(isDeployedEnvironment(undefined)).toBe(false)
  })
})
