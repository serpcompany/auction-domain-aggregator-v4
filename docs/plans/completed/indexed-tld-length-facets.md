# Indexed TLD and length columns, precomputed facets

Completed 2026-10-06 (Claude) for #5; sort indexes are #6. This is the outcome summary; the full ExecPlan is in git history (`git show 907d382:docs/plans/completed/indexed-tld-length-facets.md`).

## Outcome

Every table request had run six sequential D1 reads, three of them filter-independent facets. One built a JSON array from each of about a million names. A request took 1.7 to 2.6 s locally, 1.45 s of it facets. The TLD facet was capped at 250 of 479 active TLDs, and the JSON-based TLD expression threw for any name containing `"` or `\`, failing the whole page.

Now:

- TLD and domain length are virtual generated columns of `auction_listings` with indexes (migration `0006_listing_tld_length_facets.sql`).
- Each successful sync rebuilds a small `listing_facets` table that requests read, and every TLD is offered.
- `corepack pnpm benchmark:filters` times whole requests through `queryDomainListingsWithDatabase`, the page's read path, instead of hand-written SQL.

## Key decisions

- **Virtual generated columns,** not columns written at upsert time. SQLite computes them, so ingestion, fixtures, and future providers cannot get them wrong. `ALTER TABLE ... ADD COLUMN` allows only virtual ones; stored ones would need a table rebuild.
- **The TLD is the final label,** as before; multi-label suffixes are not special. The expression uses only `rtrim`, `substr`, and `replace`, so any character is safe.
- **Facets in a D1 table rebuilt in the successful-finalization batch,** not a per-isolate cache. Worker isolates are short-lived and many, so a cache would still pay the full group-by on most cold requests. The table costs about 6 ms per request, and the rebuild (1.7 to 3.3 s locally) runs once per sync. Each row keeps the latest end time of its listings, so a request can hide values whose auctions have all ended.
- **Only successful runs rebuild facets.** Values that only a failed or running run carries appear after the next successful run (recorded in the product spec).
- **Column-first indexes `(tld, status, ends_at)` and `(domain_length, status, ends_at)`.** The length index is not chosen until SQLite has statistics; `ANALYZE` and sort indexes were left to #6.

## Discoveries

- The dead branch `(ends_at is null or ends_at > ?)` (`ends_at` is `NOT NULL`) stopped SQLite from using the TLD index: 640 ms for a 5,028-row TLD, under 1 ms without it.
- Without `sqlite_stat1`, SQLite treats `status = ?` as very selective, so a status-first index made the default row query go from 171 ms to 837 ms. Column-first indexes avoid that.
- After `ANALYZE` on a scratch copy, length ranges used their index (182 to 49 ms), but unfiltered queries skip-scanned the TLD index and became 3 to 7 times slower. Statistics need the sort indexes first.
- Wrangler's `getPlatformProxy` loads `.dev.vars` unless `envFiles` is non-empty and logs the file it loaded; the benchmark passes `envFiles: ['/dev/null']` and `WRANGLER_LOG=error`.

## Evidence

Median of five warm requests on a copy of the owner's inventory (1,445,804 listings, 1,019,404 active): default page 1,886 to 333 ms, TLD `com` 2,498 to 81 ms, TLD `io` 2,527 to 65 ms, length 8 to 15 1,886 to 417 ms. The full table is in [Domain discovery](../../technical-design/domain-discovery.md). `pnpm check` passed with 238 unit tests, the integration proofs for multi-label and quote or backslash names and an uncapped 300-TLD facet, and 4 e2e tests. The TLD popup was checked at 1440 and 390 px with 478 options.

## Follow-ups at completion

- Counts and sorted pages still read every open listing for most shapes (#6).
- Length filters use their index only once statistics exist.
- A deep links-sorted page still took about 1.4 s.
