# Domain discovery read model and interface

Status: Implemented locally

Last updated: 2026-10-06

## Purpose

This document records the implemented D1 read path, URL contract, derived domain properties, presentation boundary, and measured schema decision for the first domain-discovery table. Stable ownership boundaries remain in `ARCHITECTURE.md`; user-visible behavior remains in the product spec.

## Request and state boundary

The page request parses untrusted search parameters into one normalized `DomainTableFilters` value in `apps/web/src/domain/domain-table.ts`. The same value drives link construction, applied-filter summaries, D1 predicates, sorting, and pagination. Raw search parameters never enter the query layer.

The URL is canonical state. Filter submission uses GET and omits `page`, so applying a change returns to page 1. Removing one summary changes only that filter family and also returns to page 1. Sorting and pagination preserve all filters. Invalid enum values are rejected, numeric inputs are bounded, reversed ranges are normalized, and page size is always 50.

Repeated Source, Auction type, and TLD values use OR within their category; all filter families combine with AND. The parser retains at most 64 repeated category values in deterministic source, type, then TLD order. This shared limit keeps the worst accepted production row query at 87 bindings (64 category values, active status, the reference time, 19 scalar filters including the four SEO-metric minimums, row limit, and offset), below D1's 100-bound-parameter ceiling. The real-D1 integration proof runs that worst case.

## D1 query behavior

`queryDomainListingsWithDatabase` accepts only normalized filters and an application database. It selects active listings, applies parameterized predicates, counts the complete result, returns one stable page, reads Ahrefs DR and feed SEO metrics for that page only, and reads the source, auction-type, and TLD facets from the precomputed `listing_facets` table plus the latest successful sync time: six statements per request, of which only the count and the page scale with the filtered inventory.

SEO-metric minimums (`majesticTfMin`, `majesticCfMin`, `majesticRefDomainsMin`, `semrushAsMin`) filter on `domain_seo_metrics`, the per-domain table that GoDaddy syncs refresh. They become one `domain_name in (select domain_name from domain_seo_metrics where ...)` predicate, so the metric indexes find the matching domains and listings are reached through `auction_listings_domain_name_idx`. A domain's metrics apply to all its listings, whatever their source. Each row carries `seoMetrics` (null when no feed published metrics for the domain), read only for the visible page like Ahrefs DR. GoDaddy bid listings are stored as auction type `AUCTION` and fixed-price listings as `BUY_NOW`, so the Auction type filter's `auction` and `buy_now` values include or exclude them.

Nullable numeric fields remain visible when unconstrained. A constraint on that field excludes nulls because an unknown value cannot honestly satisfy a minimum or maximum. Nullable sorts place unknown values last in both directions. Domain, provider, and external ID complete deterministic tie-breaking. Every read (rows, count, and facets) excludes listings whose `ends_at` is at or before the injected reference time, because status changes only when a sync reconciles and sync is not continuous. `ends_at` is `NOT NULL`, so the open-listing predicate is a plain `status = ? and ends_at > ?`; the earlier `ends_at is null or ...` branch could never match and kept SQLite from using `ends_at` in the TLD index. Ending-window filters add an upper bound to that same reference time. When the latest successful sync is more than 24 hours old, the page shows a stale-inventory notice.

Reads remain sequential. Local D1 produced snapshot locking when the count, row, facet, and freshness reads ran concurrently, and no measured navigation need justifies reintroducing that failure mode.

## Facets

The Source, Auction type, and TLD options do not depend on the filters, so they are not computed per request. `listing_facets` holds one row per `(facet, value)` with `latest_ends_at`, the latest end time among active listings with that value. `apps/web/src/server/db/listing-facets.ts` rebuilds the table from the whole active inventory (every provider) with one `DELETE` and one `INSERT ... SELECT ... GROUP BY`, and `finalizeSuccessfulRun` runs both in the same D1 batch that inactivates unseen listings and marks the run succeeded. Migration `0006_listing_tld_length_facets.sql` ran the same insert once as a backfill.

A request reads the rows whose `latest_ends_at` is after its reference time, so a value disappears once all of its auctions have ended, as it did when the facets were grouped per request. Sources and auction types are then limited to the parser's allowlists in TypeScript. Every TLD is returned (479 in the local inventory); the earlier 250-value cap is gone.

The facets describe the active inventory as of the last successful sync. Listings that a running or failed sync upserted appear in the table at once, but a source, auction type, or TLD that only they carry is offered after the next successful sync; it can still be filtered by URL. Fixtures that insert listings directly (the integration proof and the browser-test seed) run the same rebuild statements. On the 1.02-million-active-listing local inventory the rebuild took 1.7 seconds warm and 3.3 seconds cold, once per successful sync.

## Derived domain properties

These values come from `auction_listings.domain_name`:

- TLD: the final dot-separated label, lowercased. Multi-label suffixes are not special: `example.co.uk` has TLD `uk`. It is the virtual generated column `tld`, `lower(substr(domain_name, length(rtrim(domain_name, replace(domain_name, '.', ''))) + 1))`: `rtrim` strips the last label, so the remaining length is where the TLD starts. The earlier expression built a JSON array from the name and called `json_extract`, which threw "malformed JSON" for any name containing a double quote or a backslash and turned the whole page into a 500. The new one uses only string functions, and the integration proof reads names containing both.
- Domain length: `length(domain_name)`, the virtual generated column `domain_length`.
- Shape: whether the normalized name contains a hyphen or an ASCII digit. These remain query expressions.

`ALTER TABLE ... ADD COLUMN` can add virtual generated columns but not stored ones, and virtual columns can be indexed: the index stores the computed value, so filters and counts read it without recomputing. SQLite computes the columns itself, so ingestion has no write, dual-write, or backfill responsibility for them. Applying the migration to the 1.45-million-row local table, including the index builds and the facet backfill, took about 11 seconds. drizzle-kit 0.31 copies generated columns when it rebuilds a table, which SQLite rejects, so a future migration that rebuilds `auction_listings` (a nullability or CHECK change, or a new TLD expression) must be hand-edited to leave `tld` and `domain_length` out of its `INSERT ... SELECT`.

## Indexes and measured request time

`auction_listings_tld_status_ends_at_idx` is `(tld, status, ends_at)` and `auction_listings_domain_length_status_ends_at_idx` is `(domain_length, status, ends_at)`. Both lead with their own column. Status-first versions were tried and rejected: without statistics, SQLite treats `status = ?` as highly selective, chose the narrower status-first index for unfiltered pages, and fetched rows in that index's order, which made the default page's row query about five times slower. `ends_at` makes the indexes covering for counts, and after a TLD equality it returns rows already in the default end-time order, so a TLD page stops after 50 rows instead of sorting every match.

There is no `sqlite_stat1`, and without statistics SQLite still prefers `auction_listings_status_provider_idx` to a range on `domain_length`, so length filters do not use their index yet; they now cost what they did before, minus the facets. On a scratch copy after `ANALYZE`, the planner did use it (the count for lengths 8 to 15 fell from about 180 ms to 50 ms), but it also skip-scanned the TLD index for every unfiltered query, which made unfiltered row pages three to seven times slower. Statistics therefore belong with the sort indexes in #6.

`corepack pnpm benchmark:filters` calls `queryDomainListingsWithDatabase`, the function the page uses, through Wrangler's local D1 binding (`getPlatformProxy` on `apps/web/wrangler.jsonc`, loading no env or `apps/web/.dev.vars` file): one warm-up and five measured runs per shape. It reports each whole request's time and each statement's time, with the query plans of the count and row statements, and uses the latest successful sync time as a reproducible reference time. It prints no domain rows.

Measured 2026-10-06 on a copy of the owner's local inventory (Dynadot and GoDaddy: 1,445,804 listings, 1,019,404 active, 957,630 open at the reference time). Median of five warm requests, in ms:

| Request | Matches | Before | After |
| --- | ---: | ---: | ---: |
| Default page (end-time sort) | 957,630 | 1,886 | 333 |
| TLD `com` | 459,494 | 2,498 | 81 |
| TLD `io` | 5,028 | 2,527 | 65 |
| Length 8 to 15 | 512,821 | 1,886 | 417 |
| Length 6 or less | 1,116 | 1,894 | 335 |
| No hyphens, no digits | 682,649 | 2,050 | 597 |
| Price $1 to $500, ending within 24 hours | 100,205 | 1,714 | 336 |
| Expired, 3 or more bids, bids sort | 344 | 1,864 | 445 |
| 10 or more links, links sort | 333,974 | 1,783 | 320 |
| Contains `a`, max $500, no hyphens | 518,309 | 1,882 | 565 |
| Semrush AS 20 or more | 144 | 2,343 | 501 |
| Links sort, page 2,000 | 957,630 | 2,622 | 1,364 |

Before, every request spent about 1,450 ms in the three facet statements (about 150 ms for sources, 500 ms for auction types, and 800 ms for the TLD group). After, the facet read takes about 6 ms. The earlier "below 155 ms" figure timed individual hand-written statements on a 426,000-listing inventory and never summed a request.

What remains is the count and the sorted page. For most shapes both still read every open listing through `auction_listings_status_provider_idx`, and the page sorts them in a temporary B-tree: about 110 to 290 ms for each statement, and 1.2 seconds for a deep links-sorted page. That is #6.

Metric sorts (#65) read `domain_seo_metrics` and `domain_metrics` through a correlated scalar subquery per listing, by primary key, then sort in a temporary B-tree. The subquery is evaluated once per row: descending relies on SQLite placing nulls last, and ascending replaces a null with the largest integer. Measured with `corepack pnpm benchmark:filters` against 901,512 open listings on 2026-10-07, median whole-request times were 1.19 s for a Trust Flow sort, 1.29 s for Semrush Authority, 0.43 s for Ahrefs DR (a small table), and 0.24 s for DR within `.com`, against 0.28 s for a price sort. Evaluating the subquery twice (the `is null` pattern of the other nullable sorts) cost about 0.5 s more. If metric sorts need to be faster, copy the metrics onto `auction_listings` at sync time and index them.

## UI boundary

The toolbar is one client island (`apps/web/src/components/auctions/auctions-toolbar.tsx`): search, faceted Source and TLD filters, Max bid, and Ends each push a canonical URL from `buildDomainTableHref` on page 1. Every other filter lives on the Filters page (`/filters/`), a client form that reads its draft into the same parser and pushes the same canonical URL. Applied constraints render as server-side removable links.

The table is a server-rendered stock `Table` whose columns come from one registry (`apps/web/src/domain/table-columns.ts`) and a per-browser `columns` cookie the page reads. Every column is a URL-backed sort. Relative end time and absolute UTC are computed on the server from one request reference time. A contained scroll region, sticky headers, and a sticky Domain column keep the table usable at narrow widths.


## Provider-free verification

The D1 integration proof applies migrations to temporary persistence, exercises every predicate and sort against invented rows (including multi-label names and names with quotes and backslashes), proves that a successful Workflow sync rebuilds the facets and that 300 TLDs are all offered, terminates workerd, and removes its state. Playwright uses a separate `apps/web/wrangler.e2e.jsonc` and `apps/web/scripts/start-e2e-preview.ts`; that runner creates an isolated temporary D1, inserts 60 deterministic invented listings, rebuilds the facets as a successful sync would, and serves the built OpenNext worker.

Playwright global setup creates a temporary build workspace from an explicit source manifest. Only required root configuration and `.ts`, `.tsx`, `.css`, SVG, and `_headers` files under `src` and `public` are copied; dotenv files, `apps/web/.dev.vars`, local key material, `.git`, `apps/web/.wrangler`, generated output, and repository temporary state are never traversed into the workspace. Dependencies are reconstructed from the locked local pnpm store with `--offline --frozen-lockfile --ignore-scripts`, so the workspace does not symlink back through the repository. OpenNext and Next build entirely inside that workspace, then only `.open-next` is published for the preview and the workspace is removed in `finally`. A controlled-fixture test proves dotenv sentinels and local-state paths are absent from the copied manifest. The verified E2E build output does not report a loaded environment file.

After the isolated build, global setup proves the configured loopback port is free, starts the preview runner as a direct child with a unique run identifier, and returns an awaited teardown. The seed includes a domain containing that identifier, and readiness requires both a healthy D1 response and a filtered page containing that exact domain. A stale or unrelated server therefore cannot satisfy readiness even in the race after the port check.

The runner installs signal handlers before setup and all normal, failure, and signal paths share one cleanup promise that stops the active child before removing that run's directory. Teardown fails if any directory with its exact unique prefix remains. Focused lifecycle tests independently prove the port guard rejects an occupied listener without touching it, concurrent cleanup callers share the same promise, child shutdown finishes before removal, and cleanup removes only the supplied directory. Neither proof reads repository dotenv files, calls a provider, uses remote D1, or mutates `apps/web/.wrangler` and the owner's inventory.
