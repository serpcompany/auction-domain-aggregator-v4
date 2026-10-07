import type { ChildProcess } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'

import { killChildProcessGroup } from '../src/server/ingestion/local-runner'

export const E2E_HOST = '127.0.0.1'
// Not Wrangler's default 8787, which other local projects commonly occupy.
export const E2E_PORT = 8797
export const E2E_BASE_URL = `http://${E2E_HOST}:${E2E_PORT}`

export async function ensureE2ePortAvailable(host = E2E_HOST, port = E2E_PORT) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', () => reject(new Error('e2e_port_unavailable')))
    server.listen(port, host, () => {
      server.close(error => {
        if (error) reject(new Error('e2e_port_unavailable'))
        else resolve()
      })
    })
  })
}

function pause(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export async function stopE2eChild(child: ChildProcess) {
  if (child.exitCode !== null) return
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
  killChildProcessGroup(child)
  const stopped = await Promise.race([closed.then(() => true), pause(5_000).then(() => false)])
  if (!stopped && child.exitCode === null) {
    killChildProcessGroup(child, 'SIGKILL')
    await closed
  }
}

export function createE2eCleanup({
  getChild,
  getTemporaryDirectory,
  stopChild = stopE2eChild,
  removeDirectory = (path: string) => rm(path, { recursive: true, force: true })
}: {
  getChild: () => ChildProcess | undefined
  getTemporaryDirectory: () => string | undefined
  stopChild?: (child: ChildProcess) => Promise<void>
  removeDirectory?: (path: string) => Promise<void>
}) {
  let cleanupPromise: Promise<void> | undefined

  return () => {
    cleanupPromise ??= (async () => {
      const child = getChild()
      if (child) await stopChild(child)
      const temporaryDirectory = getTemporaryDirectory()
      if (temporaryDirectory) await removeDirectory(temporaryDirectory)
    })()
    return cleanupPromise
  }
}
