// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { isProduction, robotsTxt, withIndexingPolicy } from './indexing'

describe('indexing policy', () => {
  it('treats only an explicit production APP_ENV as production', () => {
    expect(isProduction({ APP_ENV: 'production' })).toBe(true)
    for (const APP_ENV of [undefined, '', 'local', 'staging', 'Production']) {
      expect(isProduction({ APP_ENV })).toBe(false)
    }
  })

  it('disallows crawling outside production', async () => {
    const local = robotsTxt(false)
    expect(local.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    await expect(local.text()).resolves.toBe('User-agent: *\nDisallow: /\n')
    await expect(robotsTxt(true).text()).resolves.toBe('User-agent: *\nAllow: /\n')
  })

  it('adds noindex outside production and keeps the response otherwise', async () => {
    const original = new Response('body', {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'text/html' }
    })
    const marked = withIndexingPolicy(original, false)
    expect(marked.status).toBe(404)
    expect(marked.statusText).toBe('Not Found')
    expect(marked.headers.get('content-type')).toBe('text/html')
    expect(marked.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    await expect(marked.text()).resolves.toBe('body')

    const production = new Response('body')
    expect(withIndexingPolicy(production, true)).toBe(production)
  })
})
