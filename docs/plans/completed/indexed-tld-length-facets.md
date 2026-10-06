# Indexed TLD and length columns, precomputed facets

## Purpose / Big Picture

Every table request (a page, sort, or filter change) ran six sequential D1 reads, three of them facets that do not depend on the filters: sources, auction types, and a TLD facet that built a JSON array from each of about a million names. A request took about 1.7 to 2.6 seconds on the owner's local inventory, and 1.45 seconds of that was facets. The TLD facet was capped at 250 values while the inventory has 479 active TLDs, and the JSON-based TLD expression threw for any name containing `"` or `\`, which returned a 500 for the whole page. The benchmark timed hand-written SQL rather than the request. The issue is serpcompany/auction-domain-aggregator-v4#5; sort indexes are #6.

Now TLD and domain length are indexed generated columns, each successful sync rebuilds a small facet table that requests read, every TLD is offered, and `corepack pnpm benchmark:filters` times whole requests through the page's read function. A person can see it by opening the TLD filter (all TLDs, scrolling inside the popup), filtering by a TLD (well under 100 ms locally), and running the benchmark.

## Progress

- [x] (2026-10-06 10:45 JST) Read the issues, repository docs, schema, query module, ingestion storage, tests, and benchmark; branched `issue-5-indexed-tld-length-facets` from `origin/main`.
- [x] (2026-10-06 11:00 JST) Rewrote the benchmark to call `queryDomainListingsWithDatabase` and measured the unchanged code on a copy of the owner's inventory.
- [x] (2026-10-06 11:10 JST) Compared index layouts with the SQLite shell on scratch copies; chose column-first covering indexes and removed the dead `ends_at is null` branch.
- [x] (2026-10-06 11:15 JST) Schema, migration `0006_listing_tld_length_facets.sql` with backfill, facet rebuild in successful finalization, query changes, integration and unit proofs, e2e seed.
- [x] (2026-10-06 11:20 JST) Migrated the worktree's inventory copy and measured again; checked the TLD filter at 1440 px and 390 px.
- [x] (2026-10-06 11:40 JST) `check:quick`, `test:integration`, `test:e2e`; documentation.

## Surprises & Discoveries

- The open-listing predicate `(ends_at is null or ends_at > ?)` stopped SQLite from using a `(tld, status, ends_at)` index for the row query: it chose `auction_listings_status_provider_idx` and took 640 ms for a 5,028-row TLD. `ends_at` is `NOT NULL`, so the branch was dead; without it the same query uses the TLD index and takes under 1 ms in the SQLite shell.
- With no `sqlite_stat1`, SQLite treats `status = ?` as very selective. A status-first index such as `(status, domain_length, ends_at)` was chosen for unfiltered pages and fetched rows in that index's order: the default row query went from 171 ms to 837 ms. Column-first indexes avoid that, but SQLite then prefers the status index to a `domain_length` range, so length filters do not use their index yet.
- After `ANALYZE` on a scratch copy, length ranges used their index (count for 8 to 15 from 182 ms to 49 ms), but every unfiltered query skip-scanned the TLD index and its row query became 3 to 7 times slower (default page 171 ms to 1,124 ms). Statistics need the sort indexes from #6 first.
- SQLite accepts `NOT NULL` on a virtual generated column added by `ALTER TABLE`; it checks existing rows.
- Wrangler's `getPlatformProxy` loads `.dev.vars` unless `envFiles` is non-empty, and logs the env file it loaded to stdout. The benchmark passes `envFiles: ['/dev/null']` and sets `WRANGLER_LOG=error`.

## Decision Log

- 2026-10-06 (Claude): Virtual generated columns rather than columns written at upsert time. SQLite computes them, so ingestion, test fixtures, and future providers cannot get them wrong, and there is no backfill beyond the index build. `ALTER TABLE ... ADD COLUMN` allows only virtual generated columns; stored ones would need a table rebuild.
- 2026-10-06 (Claude): The TLD stays the final label, as the app derived it before; multi-label suffixes are not special. The expression uses `rtrim`, `substr`, and `replace` only, so any character is safe.
- 2026-10-06 (Claude): Facets in a D1 table rebuilt in the successful-finalization batch, rather than a per-isolate cache keyed by the latest run ID. Worker isolates are short-lived and many, so a cache would still pay the full group-by on most cold requests; the table costs about 6 ms per request everywhere, and the rebuild (1.7 to 3.3 s locally) runs once per sync inside the batch that changes the active set. Each row keeps the latest end time of its listings, so a request still hides values whose auctions have all ended.
- 2026-10-06 (Claude): Only successful runs rebuild the facets, as the issue proposed. A failed or running run's upserts are visible in the table immediately; values only they carry appear in the options after the next successful run. This is documented in the product spec.
- 2026-10-06 (Claude): Indexes `(tld, status, ends_at)` and `(domain_length, status, ends_at)`. The length index is not chosen until statistics exist; it is kept because the issue asks for it and #6 is expected to add `ANALYZE`, with which it is used.
- 2026-10-06 (Claude): `ANALYZE` and sort indexes are left to #6.

## Outcomes & Retrospective

Achieved, median of five warm requests through `queryDomainListingsWithDatabase` on a copy of the owner's inventory (1,445,804 listings, 1,019,404 active): default page 1,886 to 333 ms, TLD `com` 2,498 to 81 ms, TLD `io` 2,527 to 65 ms, length 8 to 15 1,886 to 417 ms, length 6 or less 1,894 to 335 ms. The full table is in `docs/technical-design/domain-discovery.md`. All 479 TLDs are offered; names with quotes or backslashes no longer fail a read.

Remaining: the count and sorted page still read every open listing for most shapes (#6). Length filters will use their index only once statistics exist. A deep links-sorted page still takes about 1.4 seconds.

## Context and Orientation

- `src/server/db/schema.ts`: `auction_listings.tld` and `domain_length` (virtual generated), their indexes, and `listing_facets`.
- `src/server/db/listing-facets.ts`: the rebuild SQL and a helper returning Drizzle batch items.
- `src/server/ingestion/d1-storage.ts`: `finalizeSuccessfulRun` appends the rebuild to its batch.
- `src/server/queries/domain-listings-query.ts`: filters use the columns; facets are read from `listing_facets`.
- `drizzle/0006_listing_tld_length_facets.sql`: generated by `db:generate`, renamed, with a hand-added backfill insert.
- `scripts/benchmark-domain-filters.ts`: the per-request benchmark.
- `src/server/ingestion/integration-worker.ts`, `scripts/test-d1-integration.ts`: new proofs `derivedNameColumnProof` and `uncappedTldFacetProof`, plus facet assertions after a real Workflow sync.
- `scripts/start-e2e-preview.ts`: the seed runs the rebuild.

## Plan of Work

Measure first with a benchmark that calls the real read function, then add the columns, indexes, and facet table in one migration, switch the read path, prove the behavior on real local D1, and measure again on the same inventory copy.

## Concrete Steps

From the worktree root:

    cp <main checkout>/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<db>.sqlite .wrangler/state/v3/d1/miniflare-D1DatabaseObject/
    corepack pnpm benchmark:filters        # before, on unchanged code
    corepack pnpm db:generate && corepack pnpm db:check
    corepack pnpm db:migrate:local         # about 11 s on the copy
    corepack pnpm benchmark:filters        # after
    corepack pnpm check:quick && corepack pnpm test:integration && corepack pnpm test:e2e

## Validation and Acceptance

- `check:quick`: format, lint, types, 238 unit tests at 100% configured coverage, including a TLD combobox test with 479 options.
- `test:integration`: all proofs, including `derivedNameColumnProof` (multi-label and quote/backslash names, TLD and length filters) and `uncappedTldFacetProof` (300 TLDs offered), and the facet rebuild by a successful Workflow sync.
- `test:e2e`: 4 passed.
- Browser at 1440 px and 390 px against the migrated copy: 478 TLD options in a 252 px scrolling popup, no horizontal page overflow, `?tld=zone` filters correctly.

## Idempotence and Recovery

The migration is applied once by Wrangler's migration table. The facet rebuild is a full delete and insert, safe to repeat; rerunning any successful sync repairs the table. If the rebuild statement failed, the whole finalization batch would roll back and the run would fail without reconciling.

## Artifacts and Notes

Benchmark JSON (before and after) was kept outside the repository; the summary table is in the design document.

## Interfaces and Dependencies

No new packages. `listing_facets(facet, value, latest_ends_at)` with primary key `(facet, value)`; `REFRESH_LISTING_FACETS_SQL` and `refreshListingFacetsQueries(db)` in `src/server/db/listing-facets.ts`.

Revision note (2026-10-06): created and completed in one session; recorded here because the change adds a migration and a derived table.
