import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  createChildEnvironment,
  fetchWithTimeout,
  installSignalCleanup,
  killChildProcessGroup
} from './local-runner'

describe('local runner utilities', () => {
  it('passes only allowlisted non-provider environment variables', () => {
    expect(
      createChildEnvironment({
        PATH: '/safe/bin',
        HOME: '/safe/home',
        GODADDY_API_KEY: 'secret',
        DROPCATCH_TOKEN: 'secret',
        AHREFS_API_KEY: 'secret',
        DYNADOT_API_PRODUCTION_KEY: 'secret'
      })
    ).toEqual({ PATH: '/safe/bin', HOME: '/safe/home' })
  })

  it('aborts bounded fetches and always clears their timers', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const pending = fetchWithTimeout(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        ),
      'http://127.0.0.1/',
      {},
      100,
      'fixed_timeout'
    )
    const rejection = expect(pending).rejects.toThrow('fixed_timeout')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
    vi.useRealTimers()
  })

  it('composes signals for successful bounded fetches', async () => {
    const supplied = new AbortController()
    await expect(
      fetchWithTimeout(
        async (_input, init) => {
          expect(init?.signal).not.toBe(supplied.signal)
          return new Response('ok')
        },
        'http://127.0.0.1/',
        { signal: supplied.signal },
        100,
        'fixed_timeout'
      )
    ).resolves.toBeInstanceOf(Response)
  })

  it('kills and deletes once when a termination signal fires', () => {
    const processTarget = new EventEmitter() as EventEmitter & {
      exit: (code: number) => void
    }
    processTarget.exit = vi.fn()
    const killChild = vi.fn()
    const removeDirectory = vi.fn()
    const child = {} as ChildProcess
    const lifecycle = installSignalCleanup({
      child,
      temporaryDirectory: '/temporary/runner',
      processTarget,
      killChild,
      removeDirectory
    })

    processTarget.emit('SIGTERM')
    processTarget.emit('SIGTERM')
    lifecycle.cleanup()

    expect(killChild).toHaveBeenCalledOnce()
    expect(removeDirectory).toHaveBeenCalledOnce()
    expect(processTarget.exit).toHaveBeenCalledOnce()
    expect(processTarget.exit).toHaveBeenCalledWith(143)
    lifecycle.unregister()
  })

  it('cleans up before a child starts and kills one attached later', () => {
    const processTarget = new EventEmitter() as EventEmitter & {
      exit: (code: number) => void
    }
    processTarget.exit = vi.fn()
    const killChild = vi.fn()
    const removeDirectory = vi.fn()

    const early = installSignalCleanup({
      temporaryDirectory: '/temporary/staging',
      processTarget,
      killChild,
      removeDirectory
    })
    early.cleanup()
    expect(killChild).not.toHaveBeenCalled()
    expect(removeDirectory).toHaveBeenCalledWith('/temporary/staging')
    early.unregister()

    const late = installSignalCleanup({
      temporaryDirectory: '/temporary/staging',
      processTarget,
      killChild,
      removeDirectory
    })
    const child = {} as ChildProcess
    late.attachChild(child)
    processTarget.emit('SIGINT')
    expect(killChild).toHaveBeenCalledWith(child)
    expect(processTarget.exit).toHaveBeenCalledWith(130)
    late.unregister()
  })

  it('handles interruption and process-group kill fallbacks', () => {
    const processTarget = new EventEmitter() as EventEmitter & {
      exit: (code: number) => void
    }
    processTarget.exit = vi.fn()
    const killChild = vi.fn()
    const removeDirectory = vi.fn()
    const child = {} as ChildProcess
    installSignalCleanup({
      child,
      temporaryDirectory: '/temporary/runner',
      processTarget,
      killChild,
      removeDirectory
    })
    processTarget.emit('SIGINT')
    expect(processTarget.exit).toHaveBeenCalledWith(130)

    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const groupedChild = {
      pid: 123,
      exitCode: null,
      kill: vi.fn()
    } as unknown as ChildProcess
    killChildProcessGroup(groupedChild)
    expect(processKill).toHaveBeenCalledWith(-123, 'SIGTERM')

    processKill.mockImplementation(() => {
      throw new Error('no group')
    })
    killChildProcessGroup(groupedChild, 'SIGKILL')
    expect(groupedChild.kill).toHaveBeenCalledWith('SIGKILL')

    processKill.mockClear()
    processKill.mockReturnValue(true)
    killChildProcessGroup(groupedChild, 'SIGTERM', 'win32')
    expect(processKill).not.toHaveBeenCalled()
    expect(groupedChild.kill).toHaveBeenCalledWith('SIGTERM')
    processKill.mockRestore()

    killChildProcessGroup({ pid: undefined } as ChildProcess)
    killChildProcessGroup({ pid: 123, exitCode: 0 } as ChildProcess)
  })

  it('uses the default synchronous directory removal', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'runner-test-'))
    const processTarget = new EventEmitter() as EventEmitter & {
      exit: (code: number) => void
    }
    processTarget.exit = vi.fn()
    const lifecycle = installSignalCleanup({
      child: { pid: undefined } as ChildProcess,
      temporaryDirectory,
      processTarget
    })
    lifecycle.cleanup()
    expect(existsSync(temporaryDirectory)).toBe(false)
    lifecycle.unregister()
  })
})
