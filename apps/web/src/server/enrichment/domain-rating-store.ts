import { gt, max } from 'drizzle-orm'

import { ahrefsRequests } from '../db/schema'
import type { AppDatabase } from '../db/types'
import type { DomainRatingStore } from './domain-rating'

// One statement, so D1 decides each claim atomically: a domain is claimed by
// inserting a `pending` row, or by taking over an omission or claim whose
// retry time has passed. RETURNING lists only rows this statement wrote, so a
// domain another request holds is left out. Domain names arrive as one JSON
// array, which keeps the statement far below D1's 100 bound parameters.
const CLAIM_SQL = `
  INSERT INTO domain_metrics (domain_name, metric, status, value, fetched_at, retry_after)
  SELECT DISTINCT domain_name, 'ahrefs_dr', 'pending', NULL, ?, ?
  FROM auction_listings
  WHERE status = 'active' AND domain_name IN (SELECT value FROM json_each(?))
  ON CONFLICT (domain_name, metric) DO UPDATE SET
    status = 'pending',
    fetched_at = excluded.fetched_at,
    retry_after = excluded.retry_after
  WHERE domain_metrics.status IN ('omitted', 'pending')
    AND domain_metrics.retry_after <= excluded.fetched_at
  RETURNING domain_name
`

const RELEASE_SQL = `
  DELETE FROM domain_metrics
  WHERE metric = 'ahrefs_dr' AND status = 'pending' AND retry_after = ?
    AND domain_name IN (SELECT value FROM json_each(?))
`

// `ok` and `not_found` are write-once: a result replaces only a claim or an
// omission.
const STORE_RESULTS_SQL = `
  INSERT INTO domain_metrics (domain_name, metric, status, value, fetched_at, retry_after)
  SELECT
    json_extract(value, '$.domainName'), 'ahrefs_dr', json_extract(value, '$.status'),
    json_extract(value, '$.value'), ?, json_extract(value, '$.retryAfter')
  FROM json_each(?)
  WHERE true
  ON CONFLICT (domain_name, metric) DO UPDATE SET
    status = excluded.status,
    value = excluded.value,
    fetched_at = excluded.fetched_at,
    retry_after = excluded.retry_after
  WHERE domain_metrics.status IN ('omitted', 'pending')
  RETURNING domain_name
`

const RECORD_REQUEST_SQL = `
  INSERT INTO ahrefs_requests (requested_at, domain_count, outcome, cool_down_until)
  VALUES (?, ?, ?, ?)
`

export function createD1DomainRatingStore(db: AppDatabase): DomainRatingStore {
  return {
    async coolDownUntil(now) {
      const [row] = await db
        .select({ until: max(ahrefsRequests.coolDownUntil) })
        .from(ahrefsRequests)
        .where(gt(ahrefsRequests.coolDownUntil, now))
      return row?.until ?? null
    },

    async claim(domains, now, until) {
      const { results } = await db.$client
        .prepare(CLAIM_SQL)
        .bind(now.getTime(), until.getTime(), JSON.stringify(domains))
        .all<{ domain_name: string }>()
      return results.map(row => row.domain_name)
    },

    async release(domains, until) {
      await db.$client.prepare(RELEASE_SQL).bind(until.getTime(), JSON.stringify(domains)).run()
    },

    async record(request, results) {
      const log = db.$client
        .prepare(RECORD_REQUEST_SQL)
        .bind(
          request.requestedAt.getTime(),
          request.domainCount,
          request.outcome,
          request.coolDownUntil?.getTime() ?? null
        )
      if (results.length === 0) {
        await log.run()
        return 0
      }
      const [, stored] = await db.$client.batch<{ domain_name: string }>([
        log,
        db.$client.prepare(STORE_RESULTS_SQL).bind(
          request.requestedAt.getTime(),
          JSON.stringify(
            results.map(result => ({
              ...result,
              retryAfter: result.retryAfter?.getTime() ?? null
            }))
          )
        )
      ])
      return stored?.results.length ?? 0
    }
  }
}
