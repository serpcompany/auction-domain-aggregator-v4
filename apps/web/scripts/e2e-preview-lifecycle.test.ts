import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createE2eCleanup, ensureE2ePortAvailable, stopE2eChild } from './e2e-preview-lifecycle'

describe('E2E preview lifecycle', () => {
  it('rejects an occupied port and accepts it after the owner closes', async () => {
    const owner = createServer()
    await new Promise<void>(resolve => owner.listen(0, '127.0.0.1', resolve))
    const address = owner.address()
    if (!address || typeof address === 'string') throw new Error('test_port_unavailable')

    await expect(ensureE2ePortAvailable('127.0.0.1', address.port)).rejects.toThrow(
      'e2e_port_unavailable'
    )
    await new Promise<void>((resolve, reject) =>
      owner.close(error => (error ? reject(error) : resolve()))
    )
    await expect(ensureE2ePortAvailable('127.0.0.1', address.port)).resolves.toBeUndefined()
  })

  it('shares cleanup work, waits for child shutdown, and removes only its directory', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'domain-e2e-lifecycle-proof-'))
    let releaseChild!: () => void
    const childStopped = new Promise<void>(resolve => {
      releaseChild = resolve
    })
    const child = {} as ChildProcess
    const stopChild = vi.fn(async (childToStop: ChildProcess) => {
      expect(childToStop).toBe(child)
      await childStopped
    })
    const cleanup = createE2eCleanup({
      getChild: () => child,
      getTemporaryDirectory: () => temporaryDirectory,
      stopChild
    })

    const firstCleanup = cleanup()
    const secondCleanup = cleanup()
    expect(secondCleanup).toBe(firstCleanup)
    await expect(stat(temporaryDirectory)).resolves.toBeDefined()

    releaseChild()
    await Promise.all([firstCleanup, secondCleanup])

    expect(stopChild).toHaveBeenCalledOnce()
    await expect(stat(temporaryDirectory)).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('terminates the detached command tree through its process group', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4321,
      exitCode: null as number | null,
      kill: vi.fn()
    }) as unknown as ChildProcess
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => {
      queueMicrotask(() => {
        Object.assign(child, { exitCode: 0 })
        child.emit('close', 0)
      })
      return true
    })

    await stopE2eChild(child)

    expect(processKill).toHaveBeenCalledWith(-4321, 'SIGTERM')
    expect(child.kill).not.toHaveBeenCalled()
    processKill.mockRestore()
  })
})
