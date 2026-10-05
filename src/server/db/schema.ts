import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const domains = sqliteTable('domains', {
  name: text('name').primaryKey(),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
});

export const auctionListings = sqliteTable(
  'auction_listings',
  {
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    domainName: text('domain_name')
      .notNull()
      .references(() => domains.name),
    auctionUrl: text('auction_url').notNull(),
    auctionType: text('auction_type').notNull(),
    currency: text('currency').notNull(),
    currentBidCents: integer('current_bid_cents').notNull(),
    bidCount: integer('bid_count').notNull().default(0),
    bidderCount: integer('bidder_count').notNull().default(0),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }),
    endsAt: integer('ends_at', { mode: 'timestamp_ms' }).notNull(),
    ageYears: integer('age_years'),
    inboundLinks: integer('inbound_links'),
    visitors: integer('visitors'),
    appraisalCents: integer('appraisal_cents'),
    renewalPriceCents: integer('renewal_price_cents'),
    status: text('status', { enum: ['active', 'inactive'] }).notNull(),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.externalId] }),
    check(
      'auction_listings_status_check',
      sql`${table.status} in ('active', 'inactive')`,
    ),
    check(
      'auction_listings_current_bid_cents_nonnegative',
      sql`${table.currentBidCents} >= 0`,
    ),
    check(
      'auction_listings_bid_count_nonnegative',
      sql`${table.bidCount} >= 0`,
    ),
    check(
      'auction_listings_bidder_count_nonnegative',
      sql`${table.bidderCount} >= 0`,
    ),
    check(
      'auction_listings_age_years_nonnegative',
      sql`${table.ageYears} is null or ${table.ageYears} >= 0`,
    ),
    check(
      'auction_listings_inbound_links_nonnegative',
      sql`${table.inboundLinks} is null or ${table.inboundLinks} >= 0`,
    ),
    check(
      'auction_listings_visitors_nonnegative',
      sql`${table.visitors} is null or ${table.visitors} >= 0`,
    ),
    check(
      'auction_listings_dynadot_appraisal_cents_nonnegative',
      sql`${table.appraisalCents} is null or ${table.appraisalCents} >= 0`,
    ),
    check(
      'auction_listings_renewal_price_cents_nonnegative',
      sql`${table.renewalPriceCents} is null or ${table.renewalPriceCents} >= 0`,
    ),
    index('auction_listings_status_provider_idx').on(
      table.status,
      table.provider,
    ),
    index('auction_listings_domain_name_idx').on(table.domainName),
    index('auction_listings_ends_at_idx').on(table.endsAt),
    index('auction_listings_current_bid_cents_idx').on(table.currentBidCents),
    index('auction_listings_bid_count_idx').on(table.bidCount),
    index('auction_listings_age_years_idx').on(table.ageYears),
  ],
);

export const ingestionRuns = sqliteTable(
  'ingestion_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider').notNull(),
    status: text('status', {
      enum: ['running', 'succeeded', 'failed'],
    }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    pagesFetched: integer('pages_fetched').notNull().default(0),
    nextPage: integer('next_page').notNull().default(1),
    recordsFetched: integer('records_fetched').notNull().default(0),
    recordsUpserted: integer('records_upserted').notNull().default(0),
    recordsInactivated: integer('records_inactivated').notNull().default(0),
    recordsRejected: integer('records_rejected').notNull().default(0),
    errorCode: text('error_code'),
    failedPage: integer('failed_page'),
  },
  (table) => [
    check(
      'ingestion_runs_status_check',
      sql`${table.status} in ('running', 'succeeded', 'failed')`,
    ),
    check(
      'ingestion_runs_pages_fetched_nonnegative',
      sql`${table.pagesFetched} >= 0`,
    ),
    check('ingestion_runs_next_page_positive', sql`${table.nextPage} >= 1`),
    check(
      'ingestion_runs_records_fetched_nonnegative',
      sql`${table.recordsFetched} >= 0`,
    ),
    check(
      'ingestion_runs_records_upserted_nonnegative',
      sql`${table.recordsUpserted} >= 0`,
    ),
    check(
      'ingestion_runs_records_inactivated_nonnegative',
      sql`${table.recordsInactivated} >= 0`,
    ),
    check(
      'ingestion_runs_records_rejected_nonnegative',
      sql`${table.recordsRejected} >= 0`,
    ),
    index('ingestion_runs_provider_started_at_idx').on(
      table.provider,
      table.startedAt,
    ),
  ],
);
