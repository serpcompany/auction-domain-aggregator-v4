import 'server-only';

import type { DomainTableFilters } from '@/domain/domain-table';
import { getDb } from '@/server/db/client';
import type { AppDatabase } from '@/server/db/types';
import {
  queryDomainListingsWithDatabase,
  type DomainListingRow,
  type DomainListingsResult,
} from './domain-listings-query';

export type { DomainListingRow, DomainListingsResult };

export async function queryDomainListings(
  filters: DomainTableFilters,
  database: AppDatabase = getDb(),
): Promise<DomainListingsResult> {
  return queryDomainListingsWithDatabase(filters, database);
}
