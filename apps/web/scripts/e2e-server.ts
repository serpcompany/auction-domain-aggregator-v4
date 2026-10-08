// Playwright's `webServer` command (playwright.config.ts): builds OpenNext, seeds a fresh D1 under
// tmp/e2e with invented listings, and serves the build at 127.0.0.1:<port>. Playwright waits for
// /api/health and stops the whole process group when the run ends.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'

import { REFRESH_LISTING_FACETS_SQL } from '../src/server/db/listing-facets'
import { createChildEnvironment } from '../src/server/ingestion/local-runner'
import { BUNDLED_ENV_MODULE, findBundledEnvNames } from './bundled-env'

const CONFIG = 'wrangler.e2e.jsonc'
const ROOT = 'tmp/e2e'
// wrangler.e2e.jsonc and e2e/worker.ts serve the build from here.
const BUILD = `${ROOT}/.open-next`
const STATE = `${ROOT}/state`
const FIXTURES = `${ROOT}/fixtures.sql`
// OpenNext always writes `.open-next` in the app directory; the developer's own build waits here
// meanwhile and is put back afterwards.
const DEVELOPER_BUILD = `${ROOT}/developer-open-next`

function run(...arguments_: string[]) {
  const { status } = spawnSync('corepack', ['pnpm', 'exec', ...arguments_], {
    env: createChildEnvironment(process.env),
    stdio: 'inherit'
  })
  if (status !== 0) throw new Error(`e2e server: \`${arguments_.slice(0, 3).join(' ')}\` failed`)
}

function restoreDeveloperBuild() {
  if (!existsSync(DEVELOPER_BUILD)) return
  rmSync('.open-next', { recursive: true, force: true })
  renameSync(DEVELOPER_BUILD, '.open-next')
}

async function build() {
  // A run stopped mid-build leaves the developer's build here; put it back first.
  restoreDeveloperBuild()
  mkdirSync(ROOT, { recursive: true })
  if (existsSync('.open-next')) renameSync('.open-next', DEVELOPER_BUILD)
  try {
    run('opennextjs-cloudflare', 'build', '--config', CONFIG)
    const names = await findBundledEnvNames(BUNDLED_ENV_MODULE)
    // Names only, never values.
    if (names.length > 0) throw new Error(`the bundle contains env variables: ${names.join(', ')}`)
    rmSync(BUILD, { recursive: true, force: true })
    renameSync('.open-next', BUILD)
  } finally {
    restoreDeveloperBuild()
  }
}

function fixtureSql(now = Date.now()) {
  const firstSeenAt = now - 86_400_000
  const listings = [
    {
      externalId: 'e2e-garden',
      domainName: 'garden.com',
      auctionType: 'EXPIRED',
      currentBidCents: 2_500,
      bidCount: 7,
      bidderCount: 3,
      endsAt: now + 30 * 60_000,
      ageYears: 12,
      inboundLinks: 1_200,
      visitors: 88,
      appraisal: 50_000,
      renewal: 1_200
    },
    {
      externalId: 'e2e-fixture',
      domainName: 'e2e-fixture.test',
      auctionType: 'AUCTION',
      currentBidCents: 1_000,
      bidCount: 1,
      bidderCount: 1,
      endsAt: now + 3 * 86_400_000,
      ageYears: 3,
      inboundLinks: 10,
      visitors: 4,
      appraisal: 9_000,
      renewal: 1_500
    },
    // 100 listings, half of them auctions: more than one 96-row page.
    ...Array.from({ length: 98 }, (_, index) => {
      const number = String(index + 1).padStart(2, '0')
      return {
        externalId: `e2e-sample-${number}`,
        domainName: `sample-${number}.net`,
        auctionType: index % 2 === 0 ? 'EXPIRED' : 'AUCTION',
        currentBidCents: 10_000 + index * 100,
        bidCount: index % 8,
        bidderCount: index % 4,
        endsAt: now + (2 + index) * 3_600_000,
        ageYears: index % 20,
        inboundLinks: index * 25,
        visitors: index * 3,
        appraisal: 20_000 + index * 500,
        renewal: 1_250
      }
    })
  ]

  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  const domainValues = listings
    .map(listing => `(${quote(listing.domainName)},${firstSeenAt})`)
    .join(',')
  const listingValues = listings
    .map(
      listing =>
        `('dynadot',${quote(listing.externalId)},${quote(listing.domainName)},${quote(`https://www.dynadot.com/market/auction/${listing.externalId}`)},${quote(listing.auctionType)},'USD',${listing.currentBidCents},${listing.bidCount},${listing.bidderCount},${firstSeenAt},${listing.endsAt},${listing.ageYears},${listing.inboundLinks},${listing.visitors},${listing.appraisal},${listing.renewal},'active',${firstSeenAt},${now})`
    )
    .join(',')

  return `${[
    `INSERT INTO domains (name, first_seen_at) VALUES ${domainValues}`,
    `INSERT INTO auction_listings (provider, external_id, domain_name, auction_url, auction_type, currency, current_bid_cents, bid_count, bidder_count, starts_at, ends_at, age_years, inbound_links, visitors, appraisal_cents, renewal_price_cents, status, first_seen_at, last_seen_at) VALUES ${listingValues}`,
    `INSERT INTO domain_metrics (domain_name, metric, status, value, fetched_at) VALUES ('garden.com','ahrefs_dr','ok',37.2,${now})`,
    `INSERT INTO ingestion_runs (provider, status, started_at, completed_at, pages_fetched, next_page, records_fetched, records_upserted, records_inactivated) VALUES ('dynadot','succeeded',${firstSeenAt},${now},1,1,100,100,0)`,
    // A successful sync rebuilds the facet values; the seed does the same.
    ...REFRESH_LISTING_FACETS_SQL
  ].join(';\n')};\n`
}

async function main() {
  const port = process.argv[2]
  if (!port || !/^\d+$/.test(port)) throw new Error('usage: e2e-server.ts <port>')

  await build()

  // Fresh, isolated D1 state: never the owner's .wrangler inventory, and never .dev.vars
  // (`--env-file /dev/null` stops Wrangler from loading it).
  rmSync(STATE, { recursive: true, force: true })
  writeFileSync(FIXTURES, fixtureSql())
  const local = ['--local', '--config', CONFIG, '--persist-to', STATE, '--env-file', '/dev/null']
  run('wrangler', 'd1', 'migrations', 'apply', 'DB', ...local)
  run('wrangler', 'd1', 'execute', 'DB', ...local, '--file', FIXTURES)
  run(
    'wrangler',
    'dev',
    ...local,
    '--ip',
    '127.0.0.1',
    '--port',
    port,
    '--show-interactive-dev-session=false'
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
