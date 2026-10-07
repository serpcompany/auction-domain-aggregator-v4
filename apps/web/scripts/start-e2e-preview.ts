import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REFRESH_LISTING_FACETS_SQL } from '../src/server/db/listing-facets'
import { createChildEnvironment } from '../src/server/ingestion/local-runner'
import { createE2eCleanup, E2E_HOST, E2E_PORT } from './e2e-preview-lifecycle'

const CONFIG = 'wrangler.e2e.jsonc'

function fixtureSql(runId: string, now = Date.now()) {
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
      externalId: `e2e-${runId}`,
      domainName: `e2e-${runId}.test`,
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
    ...Array.from({ length: 58 }, (_, index) => {
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

  return [
    `INSERT INTO domains (name, first_seen_at) VALUES ${domainValues}`,
    `INSERT INTO auction_listings (provider, external_id, domain_name, auction_url, auction_type, currency, current_bid_cents, bid_count, bidder_count, starts_at, ends_at, age_years, inbound_links, visitors, appraisal_cents, renewal_price_cents, status, first_seen_at, last_seen_at) VALUES ${listingValues}`,
    `INSERT INTO domain_metrics (domain_name, metric, status, value, fetched_at) VALUES ('garden.com','ahrefs_dr','ok',37.2,${now})`,
    `INSERT INTO ingestion_runs (provider, status, started_at, completed_at, pages_fetched, next_page, records_fetched, records_upserted, records_inactivated) VALUES ('dynadot','succeeded',${firstSeenAt},${now},1,1,60,60,0)`,
    // A successful sync rebuilds the facet values; the seed does the same.
    ...REFRESH_LISTING_FACETS_SQL
  ].join(';')
}

async function run(
  arguments_: string[],
  errorCode: string,
  setChild: (child: ChildProcess | undefined) => void
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('corepack', arguments_, {
      cwd: process.cwd(),
      env: createChildEnvironment(process.env),
      stdio: 'inherit',
      detached: process.platform !== 'win32'
    })
    setChild(child)
    child.once('error', () => reject(new Error(errorCode)))
    child.once('close', code => {
      setChild(undefined)
      if (code === 0) resolve()
      else reject(new Error(errorCode))
    })
  })
}

async function main() {
  let temporaryDirectory: string | undefined
  let activeChild: ChildProcess | undefined
  let receivedSignal = false
  const cleanup = createE2eCleanup({
    getChild: () => activeChild,
    getTemporaryDirectory: () => temporaryDirectory
  })
  const handleSignal = (exitCode: number) => {
    receivedSignal = true
    process.exitCode = exitCode
    void cleanup()
  }
  const onInterrupt = () => handleSignal(130)
  const onTerminate = () => handleSignal(143)
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)

  try {
    const requestedRunId = process.env.DOMAIN_E2E_RUN_ID ?? 'manual'
    const runId = /^[a-z0-9-]{1,80}$/.test(requestedRunId) ? requestedRunId : 'manual'
    temporaryDirectory = mkdtempSync(join(tmpdir(), `domain-e2e-${runId}-`))
    const persistenceDirectory = join(temporaryDirectory, 'state')
    const setChild = (child: ChildProcess | undefined) => {
      activeChild = child
    }
    const common = [
      '--local',
      '--config',
      CONFIG,
      '--persist-to',
      persistenceDirectory,
      '--env-file',
      '/dev/null'
    ]
    const runSetup = async (arguments_: string[], errorCode: string) => {
      if (receivedSignal) return false
      try {
        await run(arguments_, errorCode, setChild)
      } catch (error) {
        if (receivedSignal) return false
        throw error
      }
      return !receivedSignal
    }
    if (
      !(await runSetup(
        ['pnpm', 'exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', ...common],
        'e2e_migration_failed'
      ))
    )
      return
    if (
      !(await runSetup(
        [
          'pnpm',
          'exec',
          'wrangler',
          'd1',
          'execute',
          'DB',
          ...common,
          '--command',
          fixtureSql(runId)
        ],
        'e2e_seed_failed'
      ))
    )
      return

    activeChild = spawn(
      'corepack',
      [
        'pnpm',
        'exec',
        'wrangler',
        'dev',
        '--config',
        CONFIG,
        '--local',
        '--ip',
        E2E_HOST,
        '--port',
        String(E2E_PORT),
        '--persist-to',
        persistenceDirectory,
        '--env-file',
        '/dev/null',
        '--show-interactive-dev-session=false'
      ],
      {
        cwd: process.cwd(),
        env: createChildEnvironment(process.env),
        stdio: 'inherit',
        detached: process.platform !== 'win32'
      }
    )

    const exitCode = await new Promise<number>((resolve, reject) => {
      activeChild?.once('error', reject)
      activeChild?.once('close', code => resolve(code ?? 1))
    })
    activeChild = undefined
    if (!receivedSignal && exitCode !== 0) throw new Error('e2e_preview_failed')
  } finally {
    await cleanup()
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onTerminate)
  }
}

main().catch((error: unknown) => {
  const allowed = new Set(['e2e_migration_failed', 'e2e_seed_failed', 'e2e_preview_failed'])
  const message =
    error instanceof Error && allowed.has(error.message) ? error.message : 'e2e_preview_failed'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
