// @vitest-environment node
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { auctionListings, domainMetrics, domainSeoMetrics, ingestionRunSeenPages } from './schema'

function foreignKeys(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).foreignKeys.map(key => {
    const { columns, foreignColumns, foreignTable } = key.reference()
    return `${columns.map(column => column.name).join()} -> ${getTableConfig(foreignTable).name}.${foreignColumns.map(column => column.name).join()}`
  })
}

describe('schema foreign keys', () => {
  it('ties listings and domain metrics to their domain, and seen pages to their run', () => {
    expect(foreignKeys(auctionListings)).toEqual(['domain_name -> domains.name'])
    expect(foreignKeys(domainMetrics)).toEqual(['domain_name -> domains.name'])
    expect(foreignKeys(domainSeoMetrics)).toEqual(['domain_name -> domains.name'])
    expect(foreignKeys(ingestionRunSeenPages)).toEqual(['run_id -> ingestion_runs.id'])
  })
})
