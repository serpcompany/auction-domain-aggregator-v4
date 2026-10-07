import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  createIsolatedE2eBuildWorkspace,
  publishIsolatedE2eBuild
} from '../scripts/e2e-isolated-build'
import { E2E_BASE_URL, ensureE2ePortAvailable } from '../scripts/e2e-preview-lifecycle'
import { createChildEnvironment, killChildProcessGroup } from '../src/server/ingestion/local-runner'

const HEALTH_URL = `${E2E_BASE_URL}/api/health`
const READY_TIMEOUT_MS = 60_000

function pause(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function buildOpenNext(runId: string) {
  const repositoryRoot = process.cwd()
  const workspace = await createIsolatedE2eBuildWorkspace(repositoryRoot, runId)
  try {
    await new Promise<void>((resolve, reject) => {
      const install = spawn(
        'corepack',
        ['pnpm', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
        {
          cwd: workspace,
          env: createChildEnvironment(process.env),
          stdio: 'inherit'
        }
      )
      install.once('error', () => reject(new Error('e2e_install_failed')))
      install.once('close', code => {
        if (code === 0) resolve()
        else reject(new Error('e2e_install_failed'))
      })
    })
    await new Promise<void>((resolve, reject) => {
      const build = spawn('corepack', ['pnpm', 'exec', 'opennextjs-cloudflare', 'build'], {
        cwd: workspace,
        env: createChildEnvironment(process.env),
        stdio: 'inherit'
      })
      build.once('error', () => reject(new Error('e2e_build_failed')))
      build.once('close', code => {
        if (code === 0) resolve()
        else reject(new Error('e2e_build_failed'))
      })
    })
    await publishIsolatedE2eBuild(workspace, repositoryRoot)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

export default async function globalSetup() {
  const runId = randomUUID()
  const directoryPrefix = `domain-e2e-${runId}-`
  await buildOpenNext(runId)
  await ensureE2ePortAvailable()
  const preview = spawn(process.execPath, ['--import', 'tsx', 'scripts/start-e2e-preview.ts'], {
    cwd: process.cwd(),
    env: {
      ...createChildEnvironment(process.env),
      DOMAIN_E2E_RUN_ID: runId
    },
    stdio: 'inherit',
    detached: process.platform !== 'win32'
  })
  const closed = new Promise<number>(resolve => preview.once('close', code => resolve(code ?? 1)))

  const cleanup = async () => {
    if (preview.exitCode === null) killChildProcessGroup(preview)
    const exitCode = await Promise.race([closed, pause(15_000).then(() => undefined)])
    if (exitCode === undefined) {
      killChildProcessGroup(preview, 'SIGKILL')
      await closed
    }
    const leftovers = (await readdir(tmpdir())).filter(name => name.startsWith(directoryPrefix))
    if (leftovers.length > 0) throw new Error('e2e_cleanup_failed')
  }

  try {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (preview.exitCode !== null) throw new Error('e2e_preview_failed')
      try {
        const response = await fetch(HEALTH_URL)
        if (response.ok) {
          const identityUrl = new URL('/', E2E_BASE_URL)
          identityUrl.searchParams.set('q', `e2e-${runId}`)
          const identityResponse = await fetch(identityUrl)
          if (identityResponse.ok && (await identityResponse.text()).includes(`e2e-${runId}.test`))
            return cleanup
        }
      } catch {
        // Retry while the isolated OpenNext preview builds and starts.
      }
      await pause(100)
    }
    throw new Error('e2e_preview_timeout')
  } catch (error) {
    await cleanup()
    throw error
  }
}
