/**
 * `smoke-web.ts <staging|production> <workers.dev subdomain>`: CI's post-deploy smoke test of the
 * website (`smoke-checks.ts`) at `https://<worker name>.<subdomain>.workers.dev`. The Worker name
 * and canonical host come from that environment in wrangler.jsonc.
 */
import { isDeployedEnvironment, readWebEnvironment } from './deploy-config'
import { runSmoke } from './smoke-checks'

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

async function main() {
  const [env, subdomain] = process.argv.slice(2)
  if (!isDeployedEnvironment(env) || !subdomain || !SUBDOMAIN.test(subdomain)) {
    process.stderr.write('usage: smoke-web.ts <staging|production> <workers.dev subdomain>\n')
    process.exitCode = 2
    return
  }
  const { name, canonicalHost } = readWebEnvironment(env)
  const origin = `https://${name}.${subdomain}.workers.dev`
  process.stdout.write(`Smoke-testing the ${env} website at ${origin}\n`)
  const failures = await runSmoke(fetch, { env, origin, canonicalHost })
  if (failures.length > 0) {
    process.stderr.write(`The ${env} website failed its smoke test.\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`The ${env} website passed its smoke test.\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(
    `smoke_failed: ${error instanceof Error ? error.message : 'unknown error'}\n`
  )
  process.exitCode = 1
})
