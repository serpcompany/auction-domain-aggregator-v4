import 'server-only'

import type { DomainTableFilters } from '@/domain/domain-table'
import { getDb } from '@/server/db/client'
import type { AppDatabase } from '@/server/db/types'
import {
  type DomainListingRow,
  type DomainListingsResult,
  type InventoryStatus,
  type ListingFacets,
  queryDomainListingsWithDatabase,
  queryInventoryStatusWithDatabase,
  queryListingFacetsWithDatabase
} from './domain-listings-query'

export type { DomainListingRow, DomainListingsResult, InventoryStatus, ListingFacets }

export async function queryDomainListings(
  filters: DomainTableFilters,
  database: AppDatabase = getDb()
): Promise<DomainListingsResult> {
  return queryDomainListingsWithDatabase(filters, database)
}

export async function queryListingFacets(database: AppDatabase = getDb()): Promise<ListingFacets> {
  return queryListingFacetsWithDatabase(database)
}

export async function queryInventoryStatus(
  database: AppDatabase = getDb()
): Promise<InventoryStatus> {
  return queryInventoryStatusWithDatabase(database)
}
