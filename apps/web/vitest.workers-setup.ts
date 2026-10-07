import { applyD1Migrations, type D1Migration, env, reset } from 'cloudflare:test'
import { beforeEach } from 'vitest'

// Per-test isolation: every test starts from empty D1 and R2, with the migrations applied.
beforeEach(async () => {
  await reset()
  const { DB, TEST_MIGRATIONS } = env as unknown as {
    DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
  }
  await applyD1Migrations(DB, TEST_MIGRATIONS)
})
