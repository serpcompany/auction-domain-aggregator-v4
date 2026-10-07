import { describe, expect, it } from 'vitest'

import { ingestionRuns } from '../db/schema'
import { testDatabase } from '../test-database'
import { queryFailedSyncCountWithDatabase, querySyncStatusWithDatabase } from './sync-status-query'

describe('smoke', () => {
  it('starts empty', async () => {
    const database = testDatabase()
    expect(await queryFailedSyncCountWithDatabase(database)).toBe(0)
    await database.insert(ingestionRuns).values({
      provider: 'dynadot',
      status: 'failed',
      startedAt: new Date(),
      nextPage: 1
    } as never)
    expect(await queryFailedSyncCountWithDatabase(database)).toBe(1)
    expect((await querySyncStatusWithDatabase(database)).providers).toHaveLength(1)
  })

  it('isolates each test', async () => {
    expect(await queryFailedSyncCountWithDatabase(testDatabase())).toBe(0)
  })
})
