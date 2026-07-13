import { asc, count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { DOMAIN_TABLE_PAGE_SIZE } from '../../domain/domain-table';
import { auctionListings, ingestionRuns } from '../db/schema';
import * as schema from '../db/schema';
import type { DynadotListing } from '../providers/dynadot';
import { queryDomainListingsWithDatabase } from '../queries/domain-listings-query';
import { DynadotSyncError } from './sync-dynadot';
import { createDynadotD1Storage } from './sync-dynadot-d1';

type IntegrationEnv = { DB: D1Database };

const PATH = '/run';
const STARTED_AT = new Date('2026-07-13T00:00:00.000Z');

function assertIntegration(
  condition: unknown,
  code: string,
): asserts condition {
  if (!condition) throw new Error(code);
}

function listing(
  externalId: string,
  domainName: string,
  currentBidCents: number,
): DynadotListing {
  return {
    provider: 'dynadot',
    externalId,
    domainName,
    auctionUrl: `https://example.invalid/auction/${externalId}`,
    auctionType: 'expired',
    currency: 'USD',
    currentBidCents,
    bidCount: currentBidCents % 7,
    bidderCount: currentBidCents % 5,
    startsAt: null,
    endsAt: new Date('2026-07-20T00:00:00.000Z'),
    ageYears: 5,
    inboundLinks: 10,
    visitors: 20,
    dynadotAppraisalCents: 10_000,
    renewalPriceCents: 1_200,
  };
}

async function listingCount(
  database: ReturnType<typeof drizzle<typeof schema>>,
) {
  const [row] = await database.select({ value: count() }).from(auctionListings);
  return row?.value ?? 0;
}

async function runProof(env: IntegrationEnv) {
  const database = drizzle(env.DB, { schema });
  const storage = createDynadotD1Storage(database);
  const initial = [
    listing('initial-a', 'initial-a.integration.test', 100),
    listing('initial-b', 'initial-b.integration.test', 200),
    listing('initial-c', 'initial-c.integration.test', 300),
  ];

  const firstRun = await storage.startRun(STARTED_AT);
  await storage.upsertListings(firstRun, initial);
  const initialCount = await listingCount(database);
  assertIntegration(initialCount === 3, 'initial_count');

  await storage.upsertListings(firstRun, [
    { ...initial[0], currentBidCents: 175 },
    initial[1],
    initial[2],
  ]);
  const idempotentCount = await listingCount(database);
  const [updatedInitial] = await database
    .select({
      price: auctionListings.currentBidCents,
      firstSeenAt: auctionListings.firstSeenAt,
    })
    .from(auctionListings)
    .where(eq(auctionListings.externalId, 'initial-a'));
  assertIntegration(idempotentCount === 3, 'idempotent_count');
  assertIntegration(updatedInitial?.price === 175, 'mutable_update');
  assertIntegration(
    updatedInitial.firstSeenAt.getTime() === STARTED_AT.getTime(),
    'first_seen_preserved',
  );

  const failedStartedAt = new Date('2026-07-13T01:00:00.000Z');
  const failedRun = await storage.startRun(failedStartedAt);
  let staleRejected = false;
  try {
    await storage.upsertListings(firstRun, [
      { ...initial[0], currentBidCents: 999_999 },
    ]);
  } catch (error) {
    staleRejected =
      error instanceof DynadotSyncError &&
      error.code === 'dynadot_stale_continuation';
  }
  const [afterStale] = await database
    .select({
      price: auctionListings.currentBidCents,
      lastSeenAt: auctionListings.lastSeenAt,
    })
    .from(auctionListings)
    .where(eq(auctionListings.externalId, 'initial-a'));
  assertIntegration(staleRejected, 'stale_not_rejected');
  assertIntegration(afterStale?.price === 175, 'stale_mutated_price');
  assertIntegration(
    afterStale.lastSeenAt.getTime() === STARTED_AT.getTime(),
    'stale_mutated_timestamp',
  );

  await storage.upsertListings(failedRun, [
    { ...initial[0], currentBidCents: 250 },
  ]);
  await storage.completeRun(failedRun, {
    status: 'failed',
    completedAt: new Date('2026-07-13T01:30:00.000Z'),
    pagesFetched: 1,
    recordsFetched: 1,
    recordsUpserted: 1,
    recordsInactivated: 0,
    errorCode: 'dynadot_sync_failed',
  });
  const [activeAfterFailure] = await database
    .select({ value: count() })
    .from(auctionListings)
    .where(eq(auctionListings.status, 'active'));
  assertIntegration(activeAfterFailure?.value === 3, 'failed_reconciled');

  const successfulStartedAt = new Date('2026-07-13T02:00:00.000Z');
  const successfulRun = await storage.startRun(successfulStartedAt);
  const activeListings = [
    { ...initial[0], currentBidCents: 5_100 },
    ...Array.from({ length: 50 }, (_, index) =>
      listing(
        `active-${index.toString().padStart(2, '0')}`,
        index === 17
          ? 'filter-target.integration.test'
          : `active-${index.toString().padStart(2, '0')}.integration.test`,
        100 + index,
      ),
    ),
  ];
  await storage.upsertListings(successfulRun, activeListings);
  const inactivated = await storage.finalizeSuccessfulRun(successfulRun, {
    completedAt: new Date('2026-07-13T02:30:00.000Z'),
    pagesFetched: 1,
    recordsFetched: activeListings.length,
    recordsUpserted: activeListings.length,
  });
  assertIntegration(inactivated === 2, 'success_reconcile_count');

  const repeatedRun = await storage.startRun(
    new Date('2026-07-13T03:00:00.000Z'),
  );
  await storage.upsertListings(repeatedRun, activeListings);
  const repeatedInactivated = await storage.finalizeSuccessfulRun(repeatedRun, {
    completedAt: new Date('2026-07-13T03:30:00.000Z'),
    pagesFetched: 1,
    recordsFetched: activeListings.length,
    recordsUpserted: activeListings.length,
  });
  assertIntegration(repeatedInactivated === 0, 'repeat_reconciled');

  const filtered = await queryDomainListingsWithDatabase(
    {
      query: 'filter-target',
      source: 'dynadot',
      sort: 'domain',
      direction: 'asc',
      page: 1,
      pageSize: DOMAIN_TABLE_PAGE_SIZE,
    },
    database,
  );
  assertIntegration(filtered.total === 1, 'query_filter');
  assertIntegration(filtered.rows.length === 1, 'query_filter_rows');

  const sortedFirstPage = await queryDomainListingsWithDatabase(
    {
      source: 'dynadot',
      sort: 'price',
      direction: 'desc',
      page: 1,
      pageSize: DOMAIN_TABLE_PAGE_SIZE,
    },
    database,
  );
  const sortedSecondPage = await queryDomainListingsWithDatabase(
    {
      source: 'dynadot',
      sort: 'price',
      direction: 'desc',
      page: 2,
      pageSize: DOMAIN_TABLE_PAGE_SIZE,
    },
    database,
  );
  assertIntegration(sortedFirstPage.total === 51, 'query_total');
  assertIntegration(sortedFirstPage.rows.length === 50, 'query_first_page');
  assertIntegration(
    sortedFirstPage.rows[0]?.currentBidCents === 5_100,
    'query_sort',
  );
  assertIntegration(sortedSecondPage.page === 2, 'query_page_number');
  assertIntegration(sortedSecondPage.rows.length === 1, 'query_second_page');
  assertIntegration(
    sortedSecondPage.rows[0]?.currentBidCents === 100,
    'query_page_value',
  );
  assertIntegration(
    sortedFirstPage.sources.join(',') === 'dynadot',
    'query_sources',
  );
  assertIntegration(
    sortedFirstPage.latestSuccessfulSync?.getTime() ===
      new Date('2026-07-13T03:30:00.000Z').getTime(),
    'query_latest_sync',
  );

  const statuses = await database
    .select({ status: auctionListings.status, value: count() })
    .from(auctionListings)
    .groupBy(auctionListings.status)
    .orderBy(asc(auctionListings.status));
  const [successfulRuns] = await database
    .select({ value: count() })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.status, 'succeeded'));

  return {
    status: 'succeeded' as const,
    initialCount,
    idempotentCount,
    staleRejected,
    failedRunActiveCount: activeAfterFailure.value,
    successfulReconciled: inactivated,
    repeatedReconciled: repeatedInactivated,
    activeCount: statuses.find(({ status }) => status === 'active')?.value ?? 0,
    inactiveCount:
      statuses.find(({ status }) => status === 'inactive')?.value ?? 0,
    filteredTotal: filtered.total,
    firstPageCount: sortedFirstPage.rows.length,
    secondPageCount: sortedSecondPage.rows.length,
    successfulRunCount: successfulRuns?.value ?? 0,
  };
}

const worker = {
  async fetch(request: Request, env: IntegrationEnv) {
    const url = new URL(request.url);
    if (url.pathname !== PATH) return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });

    try {
      return Response.json(await runProof(env));
    } catch {
      return Response.json(
        { status: 'failed', errorCode: 'd1_integration_failed' },
        { status: 500 },
      );
    }
  },
};

export default worker;
