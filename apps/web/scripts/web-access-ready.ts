/**
 * CI's website deploy guard: `web-access-ready.ts <staging|production>` reports whether that
 * environment's `vars` in wrangler.jsonc carry a canonical host and a valid Access team domain
 * and AUD tag. In GitHub Actions it writes `ready=true|false` to the step output and warns when
 * not ready, so the job skips the website deploy (the sync still deploys). Exits non-zero only
 * on a usage or read error.
 */
import { appendFile } from 'node:fs/promises'

import { isDeployedEnvironment, readWebEnvironment } from './deploy-config'

async function main() {
  const env = process.argv[2]
  if (!isDeployedEnvironment(env)) {
    process.stderr.write('usage: web-access-ready.ts <staging|production>\n')
    process.exitCode = 2
    return
  }
  const { configured } = readWebEnvironment(env)
  if (configured) {
    process.stdout.write(`The ${env} website is configured for Cloudflare Access.\n`)
  } else {
    process.stdout.write(
      `::warning::The ${env} website is not deployed until ACCESS_TEAM_DOMAIN and ACCESS_AUD ` +
        `are set in env.${env}.vars of apps/web/wrangler.jsonc ` +
        '(docs/technical-design/deployment.md).\n'
    )
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `ready=${configured}\n`)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `web_access_ready_failed: ${error instanceof Error ? error.message : 'unknown error'}\n`
  )
  process.exitCode = 1
})
