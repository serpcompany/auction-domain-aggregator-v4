import { hasValidAccessToken, type VerifyAccessOptions } from './access'
import { canonicalHostRedirect, deployment } from './deployment'
import { isProduction, robotsTxt, withIndexingPolicy } from './indexing'
import { trailingSlashRedirect } from './trailing-slash'

type FetchHandler = {
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response>
}

/**
 * The application Worker around an OpenNext build (OpenNext's "custom worker" pattern). In a
 * deployment (Staging, Production) it first fails closed with 503 when the canonical host or
 * Access configuration is missing, redirects every other host to the canonical one, and, after
 * `/robots.txt`, refuses any request without a valid Cloudflare Access token with 403
 * (`deployment.ts`, `access.ts`). Then, everywhere: the SERP trailing-slash redirect and the
 * OpenNext handler, with the indexing policy on every response. `worker.ts` wraps the developer
 * build and `e2e/worker.ts` the browser-test build. `access` is for tests only.
 */
export function createAppWorker(openNext: FetchHandler, access: VerifyAccessOptions = {}) {
  return {
    async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
      const production = isProduction(env)
      return withIndexingPolicy(await respond(request, env, ctx), production)
    }
  } satisfies ExportedHandler<CloudflareEnv>

  async function respond(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url)
    const target = deployment(env)
    if (target.kind === 'misconfigured') {
      console.error('deployment_not_configured: set CANONICAL_HOST, ACCESS_TEAM_DOMAIN, ACCESS_AUD')
      return plain('Service unavailable: this deployment is not configured.', 503)
    }
    if (target.kind === 'deployed') {
      const redirect = canonicalHostRedirect(request, url, target.canonicalHost)
      if (redirect) return redirect
    }
    if (url.pathname === '/robots.txt') return robotsTxt(isProduction(env))
    if (
      target.kind === 'deployed' &&
      !(await hasValidAccessToken(request, target.access, access))
    ) {
      return plain('Forbidden: sign in through Cloudflare Access.', 403)
    }
    return trailingSlashRedirect(url) ?? (await openNext.fetch(request, env, ctx))
  }
}

function plain(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
  })
}
