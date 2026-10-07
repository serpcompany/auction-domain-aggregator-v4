// Real D1 and R2 for `*.workers.test.ts`, which run in workerd. vitest.workers-setup.ts empties
// both and applies the migrations before every test.
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './db/schema'

export const testEnv = env as unknown as { DB: D1Database; FEED_PAGES: R2Bucket }

export function testDatabase() {
  return drizzle(testEnv.DB, { schema })
}

export type TestDatabase = ReturnType<typeof testDatabase>
