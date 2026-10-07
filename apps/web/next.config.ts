import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // SERP URL standard: pages end in a slash (/filters/), while files and /api/* are served exactly
  // as requested. Next's own slash redirect has no /api exception, so it is skipped and the
  // Worker entry (worker.ts, src/lib/trailing-slash.ts) redirects instead.
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  turbopack: {
    // Do not let lockfiles outside this repository change Next.js's workspace root.
    root: process.cwd()
  }
}

export default nextConfig

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

// `next build` loads this file too and needs no bindings. Without the guard it opens the local D1
// state in .wrangler, which `test:e2e` (scripts/e2e-server.ts) must leave alone.
if (process.env.NODE_ENV === 'development') initOpenNextCloudflareForDev()
