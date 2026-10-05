import { and, asc, count, eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import {
  DOMAIN_TABLE_SORTS,
  DOMAIN_TABLE_CATEGORY_VALUE_LIMIT,
  parseDomainTableFilters,
  type DomainTableSearchParams,
} from '../../domain/domain-table';
import { auctionListings, domains, ingestionRuns } from '../db/schema';
import * as schema from '../db/schema';
import type { DynadotListing } from '../providers/dynadot';
import { queryDomainListingsWithDatabase } from '../queries/domain-listings-query';
import { DynadotSyncError } from './sync-dynadot';
import { createDynadotD1Storage } from './sync-dynadot-d1';

type IntegrationEnv = { DB: D1Database };

const PATH = '/run';
const STARTED_AT = new Date('2026-07-13T00:00:00.000Z');
const QUERY_NOW = new Date('2026-07-13T04:00:00.000Z');

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

async function activeGuardListings(
  database: ReturnType<typeof drizzle<typeof schema>>,
) {
  const [row] = await database
    .select({ value: count() })
    .from(auctionListings)
    .where(
      and(
        like(auctionListings.externalId, 'guard-%'),
        eq(auctionListings.status, 'active'),
      ),
    );
  return row?.value ?? 0;
}

// Runs after every other proof: each step reconciles all earlier fixtures,
// whose auctions have ended by these later timestamps.
async function proveReconciliationSafety(
  database: ReturnType<typeof drizzle<typeof schema>>,
  storage: ReturnType<typeof createDynadotD1Storage>,
) {
  const guardEndsAt = new Date('2026-09-01T00:00:00.000Z');
  const guardListings = Array.from({ length: 600 }, (_, index) => ({
    ...listing(`guard-${index}`, `guard-${index}.integration.test`, 100),
    endsAt: guardEndsAt,
  }));

  const fullRun = await storage.startRun(new Date('2026-07-20T00:00:00.000Z'));
  await storage.upsertListings(fullRun, guardListings);
  await storage.finalizeSuccessfulRun(fullRun, {
    completedAt: new Date('2026-07-20T00:10:00.000Z'),
    pagesFetched: 1,
    recordsFetched: guardListings.length,
    recordsUpserted: guardListings.length,
    recordsRejected: 0,
  });
  assertIntegration(
    (await activeGuardListings(database)) === 600,
    'guard_fixture_active',
  );

  // A short page mid-inventory: most still-running auctions go unseen.
  const shortRun = await storage.startRun(new Date('2026-07-21T00:00:00.000Z'));
  await storage.upsertListings(shortRun, guardListings.slice(0, 10));
  let guardTripped = false;
  try {
    await storage.finalizeSuccessfulRun(shortRun, {
      completedAt: new Date('2026-07-21T00:10:00.000Z'),
      pagesFetched: 1,
      recordsFetched: 10,
      recordsUpserted: 10,
      recordsRejected: 0,
    });
  } catch (error) {
    guardTripped =
      error instanceof DynadotSyncError &&
      error.code === 'dynadot_reconciliation_guard';
  }
  assertIntegration(guardTripped, 'reconciliation_guard_trips');
  assertIntegration(
    (await activeGuardListings(database)) === 600,
    'reconciliation_guard_keeps_listings',
  );

  await storage.completeRun(shortRun, {
    status: 'failed',
    completedAt: new Date('2026-07-21T00:11:00.000Z'),
    pagesFetched: 1,
    recordsFetched: 10,
    recordsUpserted: 10,
    recordsInactivated: 0,
    recordsRejected: 3,
    errorCode: 'dynadot_reconciliation_guard',
    failedPage: 7,
  });
  const [failedRun] = await database
    .select({
      errorCode: ingestionRuns.errorCode,
      failedPage: ingestionRuns.failedPage,
      recordsRejected: ingestionRuns.recordsRejected,
    })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.id, shortRun.runId));
  assertIntegration(
    failedRun?.errorCode === 'dynadot_reconciliation_guard' &&
      failedRun.failedPage === 7 &&
      failedRun.recordsRejected === 3,
    'failed_run_diagnostics',
  );

  // Once the auctions have ended, an empty run inactivates them as normal
  // churn, and the stored count matches the rows actually changed.
  const afterEndRun = await storage.startRun(
    new Date('2026-09-02T00:00:00.000Z'),
  );
  const inactivated = await storage.finalizeSuccessfulRun(afterEndRun, {
    completedAt: new Date('2026-09-02T00:10:00.000Z'),
    pagesFetched: 1,
    recordsFetched: 0,
    recordsUpserted: 0,
    recordsRejected: 2,
  });
  const [succeededRun] = await database
    .select({
      recordsInactivated: ingestionRuns.recordsInactivated,
      recordsRejected: ingestionRuns.recordsRejected,
    })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.id, afterEndRun.runId));
  assertIntegration(
    inactivated === 600 &&
      succeededRun?.recordsInactivated === 600 &&
      succeededRun.recordsRejected === 2 &&
      (await activeGuardListings(database)) === 0,
    'ended_listings_reconciled',
  );
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
    recordsRejected: 0,
    errorCode: 'dynadot_sync_failed',
    failedPage: null,
  });
  const [activeAfterFailure] = await database
    .select({ value: count() })
    .from(auctionListings)
    .where(eq(auctionListings.status, 'active'));
  assertIntegration(activeAfterFailure?.value === 3, 'failed_reconciled');

  const successfulStartedAt = new Date('2026-07-13T02:00:00.000Z');
  const successfulRun = await storage.startRun(successfulStartedAt);
  const shapeFixture = {
    ...listing('shape-clean', 'garden.com', 2_500),
    auctionType: 'EXPIRED',
    bidCount: 10,
    bidderCount: 5,
    startsAt: new Date('2026-07-12T04:00:00.000Z'),
    endsAt: new Date('2026-07-13T05:00:00.000Z'),
    ageYears: 12,
    inboundLinks: 100,
    visitors: 50,
    dynadotAppraisalCents: 50_000,
    renewalPriceCents: 1_200,
  };
  const nullFixture = {
    ...listing('shape-null', 'past.org', 3_000),
    auctionType: 'EXPIRED',
    bidCount: 2,
    bidderCount: 1,
    endsAt: new Date('2026-07-13T04:30:00.000Z'),
    ageYears: null,
    inboundLinks: null,
    visitors: null,
    dynadotAppraisalCents: null,
    renewalPriceCents: null,
  };
  const digitFixture = {
    ...listing('shape-digit', 'garden2.net', 4_000),
    auctionType: 'EXPIRED',
    bidCount: 4,
    bidderCount: 2,
    endsAt: new Date('2026-07-14T04:00:00.000Z'),
  };
  const hyphenFixture = {
    ...listing('shape-hyphen', 'garden-only-hyphen.net', 4_500),
    auctionType: 'EXPIRED',
    bidCount: 4,
    bidderCount: 2,
    endsAt: new Date('2026-07-15T04:00:00.000Z'),
  };
  const activeListings = [
    { ...initial[0], currentBidCents: 5_100 },
    ...Array.from({ length: 50 }, (_, index) =>
      index === 0
        ? shapeFixture
        : index === 1
          ? nullFixture
          : index === 2
            ? digitFixture
            : index === 3
              ? hyphenFixture
              : listing(
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
    recordsRejected: 0,
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
    recordsRejected: 0,
  });
  assertIntegration(repeatedInactivated === 0, 'repeat_reconciled');

  const filtered = await queryDomainListingsWithDatabase(
    parseDomainTableFilters({
      q: 'filter-target',
      source: 'dynadot',
      sort: 'domain',
      direction: 'asc',
    }),
    database,
    QUERY_NOW,
  );
  assertIntegration(filtered.total === 1, 'query_filter');
  assertIntegration(filtered.rows.length === 1, 'query_filter_rows');

  const sortedFirstPage = await queryDomainListingsWithDatabase(
    parseDomainTableFilters({
      source: 'dynadot',
      sort: 'price',
      direction: 'desc',
    }),
    database,
    QUERY_NOW,
  );
  const sortedSecondPage = await queryDomainListingsWithDatabase(
    parseDomainTableFilters({
      source: 'dynadot',
      sort: 'price',
      direction: 'desc',
      page: '2',
    }),
    database,
    QUERY_NOW,
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
    sortedSecondPage.rows[0]?.currentBidCents === 104,
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

  const query = (searchParams: DomainTableSearchParams) =>
    queryDomainListingsWithDatabase(
      parseDomainTableFilters(searchParams),
      database,
      QUERY_NOW,
    );

  const everyFilter = await query({
    q: 'garden',
    source: ['dynadot', 'unsupported'],
    type: ['expired', 'unsupported'],
    tld: ['com', 'org'],
    domainLengthMin: '5',
    domainLengthMax: '12',
    noHyphens: '1',
    noDigits: '1',
    priceMin: '20',
    priceMax: '30',
    bidsMin: '10',
    biddersMin: '5',
    ageMin: '10',
    ageMax: '15',
    linksMin: '100',
    visitorsMin: '50',
    appraisalMin: '500',
    renewalMax: '12',
    endingWithin: '1h',
  });
  assertIntegration(everyFilter.total === 1, 'all_filter_families');
  const [shapeRow] = everyFilter.rows;
  assertIntegration(shapeRow?.bidderCount === 5, 'row_bidder_count');
  assertIntegration(shapeRow.inboundLinks === 100, 'row_links');
  assertIntegration(shapeRow.visitors === 50, 'row_visitors');
  assertIntegration(shapeRow.dynadotAppraisalCents === 50_000, 'row_appraisal');
  assertIntegration(shapeRow.renewalPriceCents === 1_200, 'row_renewal');
  assertIntegration(
    shapeRow.startsAt?.getTime() ===
      new Date('2026-07-12T04:00:00.000Z').getTime(),
    'row_starts_at',
  );
  assertIntegration(shapeRow.domainLength === 10, 'row_domain_length');
  assertIntegration(shapeRow.tld === 'com', 'row_tld');
  assertIntegration(
    !shapeRow.hasHyphen && !shapeRow.hasDigit,
    'row_shape_flags',
  );

  const categoryOr = await query({ tld: ['com', 'org'] });
  assertIntegration(categoryOr.total === 2, 'category_or');
  const categoryAnd = await query({ q: 'garden', tld: ['org'] });
  assertIntegration(categoryAnd.total === 0, 'category_and');

  const endingSoon = await query({ q: 'past', endingWithin: '1h' });
  assertIntegration(endingSoon.total === 1, 'ending_window_includes_upcoming');

  // Once its end time passes, a listing is hidden from rows, counts, and
  // facets even though no sync has reconciled its status yet.
  const afterPastEnds = await queryDomainListingsWithDatabase(
    parseDomainTableFilters({ q: 'past' }),
    database,
    new Date('2026-07-13T04:30:00.000Z'),
  );
  assertIntegration(
    afterPastEnds.total === 0 && afterPastEnds.rows.length === 0,
    'ended_listing_hidden',
  );
  const endedFacets = await queryDomainListingsWithDatabase(
    parseDomainTableFilters({}),
    database,
    new Date('2026-08-01T00:00:00.000Z'),
  );
  assertIntegration(
    endedFacets.total === 0 &&
      endedFacets.tlds.length === 0 &&
      endedFacets.sources.length === 0,
    'ended_listings_leave_facets',
  );

  const nullUnconstrained = await query({ q: 'past' });
  assertIntegration(nullUnconstrained.total === 1, 'null_unconstrained');
  for (const constrained of [
    { ageMin: '0' },
    { linksMin: '0' },
    { visitorsMin: '0' },
    { appraisalMin: '0' },
    { renewalMax: '9999' },
  ]) {
    const nullConstrained = await query({ q: 'past', ...constrained });
    assertIntegration(nullConstrained.total === 0, 'null_constrained');
  }

  const overCapTlds = [
    'com',
    ...Array.from({ length: 80 }, (_, index) => `cap${index}`),
  ];
  const cappedFilters = parseDomainTableFilters({
    q: 'garden',
    source: 'dynadot',
    type: 'expired',
    tld: overCapTlds,
    domainLengthMin: '0',
    domainLengthMax: '253',
    noHyphens: '1',
    noDigits: '1',
    priceMin: '0',
    priceMax: '999999',
    bidsMin: '0',
    biddersMin: '0',
    ageMin: '0',
    ageMax: '999',
    linksMin: '0',
    visitorsMin: '0',
    appraisalMin: '0',
    renewalMax: '999999',
    endingWithin: '7d',
  });
  assertIntegration(
    cappedFilters.sources.length +
      cappedFilters.auctionTypes.length +
      cappedFilters.tlds.length ===
      DOMAIN_TABLE_CATEGORY_VALUE_LIMIT,
    'category_bind_cap',
  );
  const cappedQuery = await queryDomainListingsWithDatabase(
    cappedFilters,
    database,
    QUERY_NOW,
  );
  assertIntegration(cappedQuery.total === 1, 'category_bind_cap_query');

  const fixtureSeenAt = new Date('2026-07-13T04:00:00.000Z');
  const rankedDomains = [
    'rank-a-long.test',
    'rank-b.co',
    'rank-cccc.com',
    'rank-dd.org',
  ];
  const tieDomain = 'tie-domain.test';
  await database.insert(domains).values(
    [...rankedDomains, tieDomain].map((name) => ({
      name,
      firstSeenAt: fixtureSeenAt,
    })),
  );
  const rankedProviders = ['dynadot', 'godaddy', 'namecheap', 'namesilo'];
  const rankedExternalIds = ['rank-0', 'rank-1', 'rank-2', 'rank-3'];
  const rankedListings = rankedExternalIds.map((externalId, index) => ({
    provider: rankedProviders[index]!,
    externalId,
    domainName: rankedDomains[index]!,
    auctionUrl: `https://example.invalid/rank/${index}`,
    auctionType: index === 1 ? 'CLOSEOUT' : index === 3 ? 'AUCTION' : 'EXPIRED',
    currency: 'USD',
    currentBidCents: [300, 100, 400, 200][index]!,
    bidCount: [4, 2, 1, 3][index]!,
    bidderCount: [2, 4, 3, 1][index]!,
    startsAt: null,
    endsAt: new Date(
      `2026-07-14T${String([8, 5, 7, 6][index]).padStart(2, '0')}:00:00.000Z`,
    ),
    ageYears: [3, 1, null, 2][index]!,
    inboundLinks: [null, 30, 10, 20][index]!,
    visitors: [20, null, 30, 10][index]!,
    dynadotAppraisalCents: [4_000, 1_000, 3_000, null][index]!,
    renewalPriceCents: [1_000, 4_000, null, 2_000][index]!,
    status: 'active' as const,
    firstSeenAt: fixtureSeenAt,
    lastSeenAt: fixtureSeenAt,
  }));
  const tieExternalIds = ['tie-b', 'tie-a', 'tie-godaddy'];
  const tieListings = [
    { provider: 'dynadot', externalId: tieExternalIds[0]! },
    { provider: 'dynadot', externalId: tieExternalIds[1]! },
    { provider: 'godaddy', externalId: tieExternalIds[2]! },
  ].map(({ provider, externalId }) => ({
    provider,
    externalId,
    domainName: tieDomain,
    auctionUrl: `https://example.invalid/tie/${externalId}`,
    auctionType: 'EXPIRED',
    currency: 'USD',
    currentBidCents: 777,
    bidCount: 7,
    bidderCount: 7,
    startsAt: null,
    endsAt: new Date('2026-07-15T07:00:00.000Z'),
    ageYears: 7,
    inboundLinks: 70,
    visitors: 70,
    dynadotAppraisalCents: 7_000,
    renewalPriceCents: 700,
    status: 'active' as const,
    firstSeenAt: fixtureSeenAt,
    lastSeenAt: fixtureSeenAt,
  }));
  await database.insert(auctionListings).values(rankedListings);
  await database.insert(auctionListings).values(tieListings);

  const assertFilterCase = async ({
    code,
    searchParams,
    includes,
    excludes,
  }: {
    code: string;
    searchParams: DomainTableSearchParams;
    includes: string[];
    excludes: string[];
  }) => {
    const result = await query(searchParams);
    const externalIds = new Set(
      result.rows.map(({ externalId }) => externalId),
    );
    assertIntegration(
      includes.every((externalId) => externalIds.has(externalId)),
      `${code}_boundary`,
    );
    assertIntegration(
      excludes.every((externalId) => !externalIds.has(externalId)),
      `${code}_near_miss`,
    );
  };

  for (const filterCase of [
    {
      code: 'domain_length_min',
      searchParams: { q: 'rank-', domainLengthMin: '11' },
      includes: ['rank-3'],
      excludes: ['rank-1'],
    },
    {
      code: 'domain_length_max',
      searchParams: { q: 'rank-', domainLengthMax: '13' },
      includes: ['rank-2'],
      excludes: ['rank-0'],
    },
    {
      code: 'price_min',
      searchParams: { q: 'rank-', priceMin: '2' },
      includes: ['rank-3'],
      excludes: ['rank-1'],
    },
    {
      code: 'price_max',
      searchParams: { q: 'rank-', priceMax: '3' },
      includes: ['rank-0'],
      excludes: ['rank-2'],
    },
    {
      code: 'age_min',
      searchParams: { q: 'rank-', ageMin: '2' },
      includes: ['rank-3'],
      excludes: ['rank-1', 'rank-2'],
    },
    {
      code: 'age_max',
      searchParams: { q: 'rank-', ageMax: '2' },
      includes: ['rank-3'],
      excludes: ['rank-0', 'rank-2'],
    },
    {
      code: 'bids_min',
      searchParams: { q: 'rank-', bidsMin: '2' },
      includes: ['rank-1'],
      excludes: ['rank-2'],
    },
    {
      code: 'bidders_min',
      searchParams: { q: 'rank-', biddersMin: '2' },
      includes: ['rank-0'],
      excludes: ['rank-3'],
    },
    {
      code: 'links_min',
      searchParams: { q: 'rank-', linksMin: '20' },
      includes: ['rank-3'],
      excludes: ['rank-2', 'rank-0'],
    },
    {
      code: 'visitors_min',
      searchParams: { q: 'rank-', visitorsMin: '20' },
      includes: ['rank-0'],
      excludes: ['rank-3', 'rank-1'],
    },
    {
      code: 'appraisal_min',
      searchParams: { q: 'rank-', appraisalMin: '30' },
      includes: ['rank-2'],
      excludes: ['rank-1', 'rank-3'],
    },
    {
      code: 'renewal_max',
      searchParams: { q: 'rank-', renewalMax: '20' },
      includes: ['rank-3'],
      excludes: ['rank-1', 'rank-2'],
    },
  ]) {
    await assertFilterCase(filterCase);
  }

  await assertFilterCase({
    code: 'shape_unconstrained',
    searchParams: { q: 'garden', noHyphens: '0', noDigits: 'false' },
    includes: ['shape-clean', 'shape-digit', 'shape-hyphen'],
    excludes: [],
  });
  await assertFilterCase({
    code: 'no_hyphens',
    searchParams: { q: 'garden', noHyphens: '1' },
    includes: ['shape-clean', 'shape-digit'],
    excludes: ['shape-hyphen'],
  });
  await assertFilterCase({
    code: 'no_digits',
    searchParams: { q: 'garden', noDigits: '1' },
    includes: ['shape-clean', 'shape-hyphen'],
    excludes: ['shape-digit'],
  });
  await assertFilterCase({
    code: 'ending_1h',
    searchParams: { endingWithin: '1h' },
    includes: ['shape-clean', 'shape-null'],
    excludes: ['shape-digit'],
  });
  await assertFilterCase({
    code: 'ending_24h',
    searchParams: { endingWithin: '24h' },
    includes: ['shape-digit'],
    excludes: ['shape-hyphen', 'active-04'],
  });
  await assertFilterCase({
    code: 'source_or',
    searchParams: { q: 'rank-', source: ['dynadot', 'godaddy'] },
    includes: ['rank-0', 'rank-1'],
    excludes: ['rank-2', 'rank-3'],
  });
  await assertFilterCase({
    code: 'auction_type_or',
    searchParams: { q: 'rank-', type: ['expired', 'closeout'] },
    includes: ['rank-0', 'rank-1', 'rank-2'],
    excludes: ['rank-3'],
  });
  await assertFilterCase({
    code: 'auction_type_single',
    searchParams: { q: 'rank-', type: ['closeout'] },
    includes: ['rank-1'],
    excludes: ['rank-0', 'rank-2', 'rank-3'],
  });
  await assertFilterCase({
    code: 'auction_type_expired',
    searchParams: { q: 'rank-', type: ['expired'] },
    includes: ['rank-0', 'rank-2'],
    excludes: ['rank-1', 'rank-3'],
  });
  await assertFilterCase({
    code: 'tld_or',
    searchParams: { q: 'rank-', tld: ['co', 'org'] },
    includes: ['rank-1', 'rank-3'],
    excludes: ['rank-0', 'rank-2'],
  });
  await assertFilterCase({
    code: 'query_literal',
    searchParams: { q: 'garden' },
    includes: ['shape-clean', 'shape-digit', 'shape-hyphen'],
    excludes: ['shape-null'],
  });
  const wildcardPercent = await query({ q: '%' });
  const wildcardUnderscore = await query({ q: '_' });
  assertIntegration(wildcardPercent.total === 0, 'query_percent_literal');
  assertIntegration(wildcardUnderscore.total === 0, 'query_underscore_literal');

  const expectedAscendingBySort: Record<
    (typeof DOMAIN_TABLE_SORTS)[number],
    string[]
  > = {
    domain: ['rank-0', 'rank-1', 'rank-2', 'rank-3'],
    source: ['rank-0', 'rank-1', 'rank-2', 'rank-3'],
    price: ['rank-1', 'rank-3', 'rank-0', 'rank-2'],
    bids: ['rank-2', 'rank-1', 'rank-3', 'rank-0'],
    bidders: ['rank-3', 'rank-0', 'rank-2', 'rank-1'],
    endsAt: ['rank-1', 'rank-3', 'rank-2', 'rank-0'],
    age: ['rank-1', 'rank-3', 'rank-0', 'rank-2'],
    links: ['rank-2', 'rank-3', 'rank-1', 'rank-0'],
    visitors: ['rank-3', 'rank-0', 'rank-2', 'rank-1'],
    appraisal: ['rank-1', 'rank-2', 'rank-0', 'rank-3'],
    renewal: ['rank-0', 'rank-3', 'rank-1', 'rank-2'],
    domainLength: ['rank-1', 'rank-3', 'rank-2', 'rank-0'],
  };
  const nullExternalIdBySort = {
    age: 'rank-2',
    links: 'rank-0',
    visitors: 'rank-1',
    appraisal: 'rank-3',
    renewal: 'rank-2',
  } as const;
  for (const sort of DOMAIN_TABLE_SORTS) {
    const ascending = await query({ q: 'rank-', sort, direction: 'asc' });
    const descending = await query({ q: 'rank-', sort, direction: 'desc' });
    const expectedAscending = expectedAscendingBySort[sort];
    const nullExternalId =
      nullExternalIdBySort[sort as keyof typeof nullExternalIdBySort];
    const expectedDescending = [
      ...expectedAscending
        .filter((externalId) => externalId !== nullExternalId)
        .reverse(),
      ...(nullExternalId ? [nullExternalId] : []),
    ];
    assertIntegration(
      ascending.rows.map(({ externalId }) => externalId).join(',') ===
        expectedAscending.join(','),
      `sort_ascending_${sort}`,
    );
    assertIntegration(
      descending.rows.map(({ externalId }) => externalId).join(',') ===
        expectedDescending.join(','),
      `sort_descending_${sort}`,
    );
  }
  for (const sort of DOMAIN_TABLE_SORTS) {
    for (const direction of ['asc', 'desc'] as const) {
      const ties = await query({ q: 'tie-domain', sort, direction });
      const expectedTieOrder =
        sort === 'source' && direction === 'desc'
          ? 'tie-godaddy,tie-a,tie-b'
          : 'tie-a,tie-b,tie-godaddy';
      assertIntegration(
        ties.rows.map(({ externalId }) => externalId).join(',') ===
          expectedTieOrder,
        `sort_tie_${sort}_${direction}`,
      );
    }
  }
  const clampedPage = await query({ q: 'rank-', page: '100000' });
  assertIntegration(clampedPage.page === 1, 'query_page_clamped');
  assertIntegration(clampedPage.rows.length === 4, 'query_page_clamped_rows');

  await database.insert(auctionListings).values({
    ...rankedListings[0]!,
    provider: 'unsupported-provider',
    externalId: 'unsupported-facet',
    auctionType: 'UNSUPPORTED-TYPE',
  });
  const boundedFacets = await query({});
  assertIntegration(
    boundedFacets.sources.join(',') === 'dynadot,godaddy,namecheap,namesilo',
    'source_facets_allowlisted',
  );
  assertIntegration(
    boundedFacets.auctionTypes.join(',') === 'auction,closeout,expired',
    'auction_type_facets_allowlisted',
  );

  assertIntegration(
    sortedFirstPage.auctionTypes.join(',') === 'expired',
    'auction_type_facets',
  );
  assertIntegration(
    sortedFirstPage.tlds.join(',') === 'com,net,org,test',
    'tld_facets',
  );

  const fixtureExternalIds = [
    ...rankedExternalIds,
    ...tieExternalIds,
    'unsupported-facet',
  ];
  await database
    .delete(auctionListings)
    .where(inArray(auctionListings.externalId, fixtureExternalIds));
  await database
    .delete(domains)
    .where(inArray(domains.name, [...rankedDomains, tieDomain]));

  const statuses = await database
    .select({ status: auctionListings.status, value: count() })
    .from(auctionListings)
    .groupBy(auctionListings.status)
    .orderBy(asc(auctionListings.status));
  const [successfulRuns] = await database
    .select({ value: count() })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.status, 'succeeded'));

  await proveReconciliationSafety(database, storage);

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
    expandedFilterProof: true as const,
    sortCount: DOMAIN_TABLE_SORTS.length,
    facetTldCount: sortedFirstPage.tlds.length,
    nullSemantics: true as const,
    categoryBindCap: DOMAIN_TABLE_CATEGORY_VALUE_LIMIT,
    exactSortProof: true as const,
    tieBreakProof: true as const,
    pageClampProof: true as const,
    independentFilterProof: true as const,
    wildcardEscapeProof: true as const,
  };
}

const worker = {
  async fetch(request: Request, env: IntegrationEnv) {
    const url = new URL(request.url);
    if (url.pathname !== PATH) return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });

    try {
      return Response.json(await runProof(env));
    } catch (error) {
      // The proof uses only invented fixtures, so the failing assertion code
      // (or D1 error message) is safe to report.
      return Response.json(
        {
          status: 'failed',
          errorCode: 'd1_integration_failed',
          failure: error instanceof Error ? error.message : 'unknown',
        },
        { status: 500 },
      );
    }
  },
};

export default worker;
