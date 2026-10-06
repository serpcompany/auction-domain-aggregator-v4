import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const domains = sqliteTable('domains', {
  name: text('name').primaryKey(),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
});

// The TLD is the final dot-separated label of the normalized name, lowercased;
// multi-label suffixes are not special (`example.co.uk` is `uk`). `rtrim`
// strips the last label, so its length is where the TLD starts. Plain string
// functions keep the expression deterministic for a generated column and safe
// for any character in the name.
const TLD_SQL = sql`lower(substr("domain_name", length(rtrim("domain_name", replace("domain_name", '.', ''))) + 1))`;

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
    // Null when the provider does not publish a bidder count (GoDaddy).
    bidderCount: integer('bidder_count'),
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
    // Derived from `domain_name` by SQLite. Virtual generated columns need no
    // ingestion writes or backfill; their indexes store the computed values.
    tld: text('tld').generatedAlwaysAs(TLD_SQL, { mode: 'virtual' }).notNull(),
    domainLength: integer('domain_length')
      .generatedAlwaysAs(sql`length("domain_name")`, { mode: 'virtual' })
      .notNull(),
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
      sql`${table.bidderCount} is null or ${table.bidderCount} >= 0`,
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
    // Column-first, so the planner never prefers them over the status index
    // for unfiltered pages. `ends_at` makes them covering for counts, and a
    // TLD equality returns rows already ordered by the default end-time sort.
    // Without `sqlite_stat1` SQLite still picks the status index over a length
    // range; see docs/technical-design/domain-discovery.md.
    index('auction_listings_tld_status_ends_at_idx').on(
      table.tld,
      table.status,
      table.endsAt,
    ),
    index('auction_listings_domain_length_status_ends_at_idx').on(
      table.domainLength,
      table.status,
      table.endsAt,
    ),
  ],
);

// Filter-independent facet values (sources, auction types, TLDs) of the active
// inventory, rebuilt in the same D1 batch that finalizes a successful sync, so
// page requests read a few hundred rows instead of grouping every listing.
// `latest_ends_at` is the latest end time among active listings with that
// value: a value is offered only while one of its auctions can still be open.
export const listingFacets = sqliteTable(
  'listing_facets',
  {
    facet: text('facet', { enum: ['source', 'auction_type', 'tld'] }).notNull(),
    value: text('value').notNull(),
    latestEndsAt: integer('latest_ends_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.facet, table.value] }),
    check(
      'listing_facets_facet_check',
      sql`${table.facet} in ('source', 'auction_type', 'tld')`,
    ),
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

// Domain-level enrichment, fetched on demand and stored once per domain and
// metric. Only `ahrefs_dr` exists today.
export const domainMetrics = sqliteTable(
  'domain_metrics',
  {
    domainName: text('domain_name')
      .notNull()
      .references(() => domains.name),
    metric: text('metric', { enum: ['ahrefs_dr'] }).notNull(),
    status: text('status', { enum: ['ok', 'not_found'] }).notNull(),
    value: real('value'),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.domainName, table.metric] }),
    check('domain_metrics_metric_check', sql`${table.metric} in ('ahrefs_dr')`),
    check(
      'domain_metrics_status_check',
      sql`${table.status} in ('ok', 'not_found')`,
    ),
    check(
      'domain_metrics_value_check',
      sql`(${table.status} = 'ok' and ${table.value} between 0 and 100) or (${table.status} = 'not_found' and ${table.value} is null)`,
    ),
  ],
);

// Third-party SEO metrics published per domain in an auction provider's feed
// (GoDaddy today). Unlike `domain_metrics`, every sync that carries them
// overwrites the row, so the latest values win. Typed columns keep the table
// filters index-friendly.
export const domainSeoMetrics = sqliteTable(
  'domain_seo_metrics',
  {
    domainName: text('domain_name')
      .primaryKey()
      .references(() => domains.name),
    source: text('source').notNull(),
    majesticTf: integer('majestic_tf'),
    majesticCf: integer('majestic_cf'),
    majesticBacklinks: integer('majestic_backlinks'),
    majesticRefDomains: integer('majestic_ref_domains'),
    semrushAs: integer('semrush_as'),
    semrushRefDomains: integer('semrush_ref_domains'),
    semrushBacklinks: integer('semrush_backlinks'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'domain_seo_metrics_majestic_tf_range',
      sql`${table.majesticTf} is null or ${table.majesticTf} between 0 and 100`,
    ),
    check(
      'domain_seo_metrics_majestic_cf_range',
      sql`${table.majesticCf} is null or ${table.majesticCf} between 0 and 100`,
    ),
    check(
      'domain_seo_metrics_majestic_backlinks_nonnegative',
      sql`${table.majesticBacklinks} is null or ${table.majesticBacklinks} >= 0`,
    ),
    check(
      'domain_seo_metrics_majestic_ref_domains_nonnegative',
      sql`${table.majesticRefDomains} is null or ${table.majesticRefDomains} >= 0`,
    ),
    check(
      'domain_seo_metrics_semrush_as_range',
      sql`${table.semrushAs} is null or ${table.semrushAs} between 0 and 100`,
    ),
    check(
      'domain_seo_metrics_semrush_ref_domains_nonnegative',
      sql`${table.semrushRefDomains} is null or ${table.semrushRefDomains} >= 0`,
    ),
    check(
      'domain_seo_metrics_semrush_backlinks_nonnegative',
      sql`${table.semrushBacklinks} is null or ${table.semrushBacklinks} >= 0`,
    ),
    index('domain_seo_metrics_majestic_tf_idx').on(table.majesticTf),
    index('domain_seo_metrics_majestic_cf_idx').on(table.majesticCf),
    index('domain_seo_metrics_majestic_ref_domains_idx').on(
      table.majesticRefDomains,
    ),
    index('domain_seo_metrics_semrush_as_idx').on(table.semrushAs),
  ],
);
