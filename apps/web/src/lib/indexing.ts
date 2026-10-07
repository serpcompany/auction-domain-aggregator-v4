/**
 * SERP environment-configuration standard: a deployment is non-production, so it sends noindex
 * and disallows crawling, unless it is explicitly marked production. The Worker entry
 * (`worker.ts`) applies this to every response. `APP_ENV` is `production` only in the production
 * environment's `vars`, and it is read per request rather than at module load.
 */
export function isProduction(env: { APP_ENV?: string }) {
  return env.APP_ENV === 'production'
}

export function robotsTxt(production: boolean) {
  return new Response(production ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  })
}

export function withIndexingPolicy(response: Response, production: boolean) {
  if (production) return response
  const headers = new Headers(response.headers)
  headers.set('x-robots-tag', 'noindex, nofollow')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
