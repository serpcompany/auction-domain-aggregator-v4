import { SMOKE_TEST_HEADER } from '../src/lib/deployment'
import type { DeployedEnvironment } from './deploy-config'

type Fetch = (url: string, init: RequestInit) => Promise<Response>

export type SmokeTarget = {
  env: DeployedEnvironment
  /** The deployment's `https://<worker>.<subdomain>.workers.dev` origin. */
  origin: string
  canonicalHost: string
}

/**
 * Post-deploy smoke checks through the `*.workers.dev` host (SERP environment-configuration
 * standard). They prove the deployment serves no data without an Access token, sends the
 * environment's indexing policy, and redirects the platform host. Returns what failed.
 */
export async function smokeFailures(fetchFn: Fetch, target: SmokeTarget): Promise<string[]> {
  const failures: string[] = []
  const smoke = { [SMOKE_TEST_HEADER]: '1' }
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetchFn(`${target.origin}${path}`, { headers, redirect: 'manual' })
  const expect = (ok: boolean, message: string) => {
    if (!ok) failures.push(message)
  }
  const staging = target.env === 'staging'

  for (const path of ['/', '/api/health']) {
    const response = await get(path, smoke)
    await response.body?.cancel()
    expect(
      response.status === 403,
      `GET ${path} without an Access token: ${response.status}, expected 403`
    )
    const robots = response.headers.get('x-robots-tag')
    expect(
      staging ? robots === 'noindex, nofollow' : robots === null,
      `GET ${path}: x-robots-tag ${JSON.stringify(robots)} in ${target.env}`
    )
  }

  const robots = await get('/robots.txt', smoke)
  const body = await robots.text()
  expect(
    robots.status === 200 && body.includes(staging ? 'Disallow: /' : 'Allow: /'),
    `GET /robots.txt: ${robots.status}, crawling ${staging ? 'not disallowed' : 'not allowed'}`
  )

  const redirect = await get('/filters?tld=com')
  await redirect.body?.cancel()
  const expected = `https://${target.canonicalHost}/filters/?tld=com`
  const location = redirect.headers.get('location')
  expect(
    redirect.status === 308 && location === expected,
    `GET /filters?tld=com without the smoke-test header: ${redirect.status} to ${location}, expected 308 to ${expected}`
  )
  return failures
}

/**
 * Retries for about two minutes: a new version, or a new Worker's workers.dev host, takes a while
 * to reach the edge.
 */
export async function runSmoke(
  fetchFn: Fetch,
  target: SmokeTarget,
  { attempts = 24, delayMs = 5_000, log = (line: string) => process.stdout.write(`${line}\n`) } = {}
) {
  let failures: string[] = []
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      failures = await smokeFailures(fetchFn, target)
    } catch (error) {
      failures = [`request failed: ${error instanceof Error ? error.message : 'unknown error'}`]
    }
    if (failures.length === 0) return failures
    log(`attempt ${attempt}/${attempts}: ${failures.join('; ')}`)
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  return failures
}
