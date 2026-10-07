import { describe, expect, it } from 'vitest'

import { trailingSlashRedirect } from '@/lib/trailing-slash'

const location = (path: string) => {
  const response = trailingSlashRedirect(new URL(path, 'https://example.test'))
  return response && { status: response.status, location: response.headers.get('location') }
}

describe('trailingSlashRedirect', () => {
  it('adds the slash to a page path with a 308 and keeps the query', () => {
    expect(location('/filters?tld=com&tld=co')).toEqual({
      status: 308,
      location: '/filters/?tld=com&tld=co'
    })
    expect(location('/syncs')).toEqual({ status: 308, location: '/syncs/' })
  })

  it('removes the slash from a file path', () => {
    expect(location('/favicon.svg/')).toEqual({ status: 308, location: '/favicon.svg' })
  })

  it('leaves canonical pages and files, the homepage, and pass-through paths alone', () => {
    for (const path of [
      '/',
      '/filters/',
      '/favicon.svg',
      '/api',
      '/api/health',
      '/api/health/',
      '/api/enrichment/domain-rating',
      '/_next/static/chunks/app.js',
      '/.well-known/security.txt'
    ]) {
      expect(location(path)).toBeNull()
    }
  })
})
