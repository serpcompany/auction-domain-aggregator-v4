import { type ChildProcess, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createChildEnvironment,
  fetchWithTimeout,
  installSignalCleanup,
  killChildProcessGroup
} from '../src/server/ingestion/local-runner'
import { implementedProvider, PROVIDER_REGISTRY } from '../src/server/providers/registry'

// Runs one provider's sync through the same Cloudflare Workflow the Cron
// Trigger starts, inside a temporary local `wrangler dev` of the ingestion
// Worker (local D1, R2, and Workflows only). The instance is created and
// polled through Wrangler's local-only explorer API.
//
// Usage: node --env-file-if-exists=../../.secrets/providers.env --import tsx scripts/sync-provider.ts <provider>
const PROVIDER = implementedProvider(process.argv[2] ?? '')

const HOST = '127.0.0.1'
const PORT = 8790
const INSPECTOR_PORT = 9330
const WORKFLOW = 'provider-sync'
const INSTANCES_URL = `http://${HOST}:${PORT}/cdn-cgi/explorer/api/workflows/${WORKFLOW}/instances`
const READY_TIMEOUT_MS = 30_000
const READY_REQUEST_TIMEOUT_MS = 2_000
// Local explorer calls can wait while a long step (the feed stage) runs.
const REQUEST_TIMEOUT_MS = 60_000
const CREATE_TIMEOUT_MS = 15 * 60_000
const POLL_INTERVAL_MS = 2_000
// GoDaddy and Namecheap take a few minutes end to end and Dynadot about 9.
// NameSilo's roughly 450 requests, paced 2 seconds apart and about 2.5
// seconds each, take 20 to 30 minutes.
const RUN_TIMEOUT_MS = 60 * 60_000

type SafeSummary = {
  provider: string
  status: 'succeeded'
  pagesFetched: number
  recordsFetched: number
  recordsUpserted: number
  recordsInactivated: number
  recordsRejected: number
}

// Fixed `<prefix>_<code>` identifiers such as `sync_reconciliation_guard`,
// `feed_download_failed`, or `dynadot_http_error`; anything else is replaced.
const ERROR_CODE = /^[a-z]+_[a-z_]+$/

function fixedError(message: string): Error {
  const error = new Error(message)
  error.stack = undefined
  return error
}

async function ensurePortAvailable(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', () => reject(fixedError('sync_port_unavailable')))
    server.listen(port, HOST, () => {
      server.close(error => (error ? reject(fixedError('sync_port_unavailable')) : resolve()))
    })
  })
}

function pause(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

// Wrangler's local explorer API wraps results as `{ success, result }`.
async function explorer(path: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(
    fetch,
    `${INSTANCES_URL}${path}`,
    init,
    timeoutMs,
    'sync_runner_timeout'
  )
  const body = (await response.json().catch(() => null)) as {
    success?: boolean
    result?: unknown
  } | null
  if (!response.ok || !body?.success) throw fixedError('sync_runner_failed')
  return body.result
}

// Locally (Wrangler 4.110), reading one instance waits until that instance
// finishes, and even the instance list can wait while a long step runs. So
// progress is polled through the list (newest first), a slow answer is
// retried, and the instance is read only once it has finished.
async function instanceStatus(id: string) {
  const instances = await explorer('', { method: 'GET' })
  const listed = Array.isArray(instances)
    ? (instances as { id?: unknown; status?: unknown }[]).find(instance => instance.id === id)
    : undefined
  return typeof listed?.status === 'string' ? listed.status : 'unknown'
}

async function waitUntilReady(child: ChildProcess) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw fixedError('sync_runner_failed')
    try {
      await explorer('', { method: 'GET' }, READY_REQUEST_TIMEOUT_MS)
      return
    } catch {
      // The bounded readiness poll retries while workerd starts.
    }
    await pause(200)
  }
  throw fixedError('sync_runner_timeout')
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null) return
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
  killChildProcessGroup(child)
  const stopped = await Promise.race([closed.then(() => true), pause(5_000).then(() => false)])
  if (!stopped && child.exitCode === null) {
    killChildProcessGroup(child, 'SIGKILL')
    await closed
  }
}

function parseSummary(value: unknown): SafeSummary {
  if (typeof value !== 'object' || value === null) {
    throw fixedError('sync_failed')
  }
  const summary = value as Record<string, unknown>
  const counters = [
    summary.pagesFetched,
    summary.recordsFetched,
    summary.recordsUpserted,
    summary.recordsInactivated,
    summary.recordsRejected
  ]
  if (
    summary.provider !== PROVIDER ||
    summary.status !== 'succeeded' ||
    counters.some(counter => !Number.isSafeInteger(counter) || Number(counter) < 0)
  ) {
    throw fixedError('sync_failed')
  }
  return {
    provider: String(summary.provider),
    status: 'succeeded',
    pagesFetched: Number(summary.pagesFetched),
    recordsFetched: Number(summary.recordsFetched),
    recordsUpserted: Number(summary.recordsUpserted),
    recordsInactivated: Number(summary.recordsInactivated),
    recordsRejected: Number(summary.recordsRejected)
  }
}

function reportedErrorCode(instance: Record<string, unknown>) {
  const error = instance.error as { message?: unknown } | null | undefined
  return typeof error?.message === 'string' && ERROR_CODE.test(error.message)
    ? error.message
    : 'sync_failed'
}

async function main() {
  if (!PROVIDER) throw fixedError('sync_unknown_provider')
  const { secretNames } = PROVIDER_REGISTRY[PROVIDER]!
  if (secretNames.some(name => !process.env[name])) {
    throw fixedError(`${PROVIDER}_missing_credentials`)
  }

  await ensurePortAvailable(PORT)
  await ensurePortAvailable(INSPECTOR_PORT)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'provider-sync-'))
  const environmentFile = join(temporaryDirectory, 'worker.env')
  let child: ChildProcess | undefined
  const signalCleanup = installSignalCleanup({ temporaryDirectory })

  try {
    // Only this provider's secrets reach the worker, through a mode-0600
    // file outside the repository.
    await writeFile(
      environmentFile,
      secretNames.map(name => `${name}=${JSON.stringify(process.env[name])}\n`).join(''),
      { mode: 0o600 }
    )
    const spawnedChild = spawn(
      'corepack',
      [
        'pnpm',
        'exec',
        'wrangler',
        'dev',
        '--config',
        'wrangler.ingestion.jsonc',
        '--local',
        '--ip',
        HOST,
        '--port',
        String(PORT),
        '--inspector-port',
        String(INSPECTOR_PORT),
        '--env-file',
        environmentFile
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: createChildEnvironment(process.env)
      }
    )
    child = spawnedChild
    signalCleanup.attachChild(spawnedChild)
    spawnedChild.stdout?.resume()
    spawnedChild.stderr?.resume()

    await waitUntilReady(spawnedChild)
    const id = `${PROVIDER}-manual-${Date.now()}`
    // Creating an instance is not retried (the ID would already exist), so
    // it may wait as long as the stage step's own timeout.
    await explorer(
      '',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, params: { provider: PROVIDER } })
      },
      CREATE_TIMEOUT_MS
    )

    const deadline = Date.now() + RUN_TIMEOUT_MS
    while (Date.now() < deadline) {
      await pause(POLL_INTERVAL_MS)
      if (spawnedChild.exitCode !== null) {
        throw fixedError('sync_runner_failed')
      }
      let status: string
      try {
        status = await instanceStatus(id)
      } catch {
        // A slow local explorer answer is retried until the run deadline.
        continue
      }
      if (!['complete', 'errored', 'terminated'].includes(status)) continue
      const instance = (await explorer(`/${encodeURIComponent(id)}`, {
        method: 'GET'
      })) as Record<string, unknown>
      if (status === 'complete') {
        const summary = parseSummary(instance.output)
        process.stdout.write(`${JSON.stringify(summary)}\n`)
        return
      }
      throw fixedError(reportedErrorCode(instance))
    }
    throw fixedError('sync_runner_timeout')
  } finally {
    signalCleanup.unregister()
    if (child) await stopChild(child)
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && ERROR_CODE.test(error.message) ? error.message : 'sync_failed'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
