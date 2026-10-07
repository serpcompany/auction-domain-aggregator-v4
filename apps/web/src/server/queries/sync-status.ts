import 'server-only'

import { getDb } from '@/server/db/client'
import type { AppDatabase } from '@/server/db/types'
import {
  type IngestionRun,
  type ProviderSyncSummary,
  queryFailedSyncCountWithDatabase,
  querySyncStatusWithDatabase,
  type SyncStatus
} from './sync-status-query'

export type { IngestionRun, ProviderSyncSummary, SyncStatus }

export async function querySyncStatus(database: AppDatabase = getDb()): Promise<SyncStatus> {
  return querySyncStatusWithDatabase(database)
}

export async function queryFailedSyncCount(database: AppDatabase = getDb()) {
  return queryFailedSyncCountWithDatabase(database)
}
