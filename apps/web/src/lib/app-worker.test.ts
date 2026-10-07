// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { createAppWorker } from './app-worker'

const ctx = {} as ExecutionContext
const env = (APP_ENV: string) => ({ APP_ENV }) as CloudflareEnv

function worker() {
  const openNext = { fetch: vi.fn(async () => new Response('page', { status: 201 })) }
  return { openNext, app: createAppWorker(openNext) }
}

describe('createAppWorker', () => {
  it('hands canonical requests to OpenNext and marks them noindex outside production', async () => {
    const { openNext, app } = worker()
    const request = new Request('https://example.test/filters/?tld=com')
    const response = await app.fetch(request, env('local'), ctx)
    expect(openNext.fetch).toHaveBeenCalledWith(request, env('local'), ctx)
    expect(response.status).toBe(201)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    await expect(response.text()).resolves.toBe('page')

    const production = await app.fetch(request, env('production'), ctx)
    expect(production.headers.get('x-robots-tag')).toBeNull()
  })

  it('redirects to the canonical slash without calling OpenNext', async () => {
    const { openNext, app } = worker()
    const response = await app.fetch(
      new Request('https://example.test/filters?tld=com'),
      env('local'),
      ctx
    )
    expect(openNext.fetch).not.toHaveBeenCalled()
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('/filters/?tld=com')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  it('answers robots.txt itself', async () => {
    const { openNext, app } = worker()
    const local = await app.fetch(new Request('https://example.test/robots.txt'), env('local'), ctx)
    await expect(local.text()).resolves.toBe('User-agent: *\nDisallow: /\n')
    expect(local.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const production = await app.fetch(
      new Request('https://example.test/robots.txt'),
      env('production'),
      ctx
    )
    await expect(production.text()).resolves.toBe('User-agent: *\nAllow: /\n')
    expect(openNext.fetch).not.toHaveBeenCalled()
  })
})
