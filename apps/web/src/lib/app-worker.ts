import { isProduction, robotsTxt, withIndexingPolicy } from './indexing'
import { trailingSlashRedirect } from './trailing-slash'

type FetchHandler = {
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response>
}

/**
 * The application Worker around an OpenNext build (OpenNext's "custom worker" pattern): the SERP
 * trailing-slash redirect, then the OpenNext handler, with the indexing policy on every response
 * and `/robots.txt` answered here. `worker.ts` wraps the developer build and `e2e/worker.ts` the
 * browser-test build.
 */
export function createAppWorker(openNext: FetchHandler) {
  return {
    async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url)
      const production = isProduction(env)
      if (url.pathname === '/robots.txt') {
        return withIndexingPolicy(robotsTxt(production), production)
      }
      const response = trailingSlashRedirect(url) ?? (await openNext.fetch(request, env, ctx))
      return withIndexingPolicy(response, production)
    }
  } satisfies ExportedHandler<CloudflareEnv>
}
