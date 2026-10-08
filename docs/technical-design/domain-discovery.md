# Domain discovery read model and interface

Status: Implemented locally

Last updated: 2026-10-07

## Purpose

This document records the implemented D1 read path, URL contract, derived domain properties, presentation boundary, and measured schema decision for the domain-discovery table. A normal page or health request reads only D1 and never calls a provider. Stable ownership boundaries remain in `ARCHITECTURE.md`; user-visible behavior remains in the product spec.

## Request and state boundary

The page request parses untrusted search parameters into one normalized `DomainTableFilters` value in `apps/web/src/domain/domain-table.ts`. The same value drives link construction, applied-filter summaries, D1 predicates, sorting, and pagination. Raw search parameters never enter the query layer.

The URL is canonical state. The bare address `/`, with no parameters at all, redirects to `/?type=auction&sort=endsAt&direction=asc&page=1` (`openingDomainTableHref`), so the table opens on auctions; every other URL keeps its meaning, and every link the table builds carries the sort, so Clear all and a removed Type chip show every type. Filter submission uses GET and omits `page`, so applying a change returns to page 1. Removing one summary changes only that filter family and also returns to page 1. Sorting and pagination preserve all filters. Invalid enum values are rejected, numeric inputs are bounded, reversed ranges are normalized, and page size is always 50.

Repeated Source, Auction type, and TLD values use OR within their category; all filter families combine with AND. The parser retains at most 64 repeated category values in deterministic source, type, then TLD order. This shared limit keeps the worst accepted production row query at 87 bindings (64 category values, active status, the reference time, 19 scalar filters including the four SEO-metric minimums, row limit, and offset), below D1's 100-bound-parameter ceiling. A workerd test on real D1 runs that worst case.

## D1 query behavior

`queryDomainListingsWithDatabase` accepts only normalized filters and an application database. It selects active listings, applies parameterized predicates, counts the complete result, returns one stable page, and reads Ahrefs DR and feed SEO metrics for that page only, in one D1 batch: three round trips, of which only the count and the page scale with the filtered inventory. A metric sort adds one when its page reaches the listings without a value, and one more when the page starts among them. The page reads the source, auction-type, and TLD facets from the precomputed `listing_facets` table and the latest successful sync time once, in one batch (`queryInventoryStatusWithDatabase`), so a page costs four round trips where it used to cost eight.

SEO-metric minimums (`majesticTfMin`, `majesticCfMin`, `majesticRefDomainsMin`, `semrushAsMin`) filter on `domain_seo_metrics`, the per-domain table that GoDaddy and Namecheap syncs refresh. They become one `domain_name in (select domain_name from domain_seo_metrics where ...)` predicate, so the metric indexes find the matching domains and listings are reached through `auction_listings_domain_name_idx`. A domain's metrics apply to all its listings, whatever their source. Each row carries `seoMetrics` (null when no feed published metrics for the domain), read only for the visible page like Ahrefs DR. GoDaddy bid listings are stored as auction type `AUCTION` and fixed-price listings as `BUY_NOW`, so the Auction type filter's `auction` and `buy_now` values include or exclude them.

Nullable numeric fields remain visible when unconstrained. A constraint on that field excludes nulls because an unknown value cannot honestly satisfy a minimum or maximum. Nullable and metric sorts place unknown values last in both directions. Domain, provider, and external ID complete deterministic tie-breaking, except in metric sorts: there ties, and the listings without a value, follow the domain name and then the rowid in the sort's own direction, the order the indexes that serve those sorts store. Every read (rows, count, and facets) excludes listings whose `ends_at` is at or before the injected reference time, because status changes only when a sync reconciles and sync is not continuous. `ends_at` is `NOT NULL`, so the open-listing predicate is a plain `status = ? and ends_at > ?`; the earlier `ends_at is null or ...` branch could never match and kept SQLite from using `ends_at` in the TLD index. Ending-window filters add an upper bound to that same reference time. When the latest successful sync is more than 24 hours old, the page shows a stale-inventory notice.

Reads remain sequential. Local D1 produced snapshot locking when the count, row, facet, and freshness reads ran concurrently, and no measured navigation need justifies reintroducing that failure mode. A D1 batch is not concurrent: it runs its statements one after another in one round trip, the latency a deployed Worker pays per D1 call.

## Facets

The Source, Auction type, and TLD options do not depend on the filters, so they are not computed per request. `listing_facets` holds one row per `(facet, value)` with `latest_ends_at`, the latest end time among active listings with that value. `apps/web/src/server/db/listing-facets.ts` rebuilds the table from the whole active inventory (every provider) with one `DELETE` and one `INSERT ... SELECT ... GROUP BY`, and `finalizeSuccessfulRun` runs both in a D1 batch right after the batch that inactivates unseen listings and marks the run succeeded. Because the rebuild reads every provider's rows, it is correct whichever provider finishes last; it is idempotent, so it needs no running-run guard of its own. Migration `0006_listing_tld_length_facets.sql` ran the same insert once as a backfill.

A request reads the rows whose `latest_ends_at` is after its reference time, so a value disappears once all of its auctions have ended, as it did when the facets were grouped per request. Sources and auction types are then limited to the parser's allowlists in TypeScript. Every TLD is returned (479 in the local inventory); the earlier 250-value cap is gone.

The facets describe the active inventory as of the last successful sync. Listings that a running or failed sync upserted appear in the table at once, but a source, auction type, or TLD that only they carry is offered after the next successful sync; it can still be filtered by URL. Fixtures that insert listings directly (the D1 tests and the browser-test seed) run the same rebuild statements. On the 1.02-million-active-listing local inventory the rebuild took 1.7 seconds warm and 3.3 seconds cold, once per successful sync.

## Derived domain properties

These values come from `auction_listings.domain_name`:

- TLD: the final dot-separated label, lowercased. Multi-label suffixes are not special: `example.co.uk` has TLD `uk`. It is the virtual generated column `tld`, `lower(substr(domain_name, length(rtrim(domain_name, replace(domain_name, '.', ''))) + 1))`: `rtrim` strips the last label, so the remaining length is where the TLD starts. The earlier expression built a JSON array from the name and called `json_extract`, which threw "malformed JSON" for any name containing a double quote or a backslash and turned the whole page into a 500. The new one uses only string functions, and the D1 tests read names containing both.
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

Metric sorts (#65) take one of two paths, chosen by the count the request already has. Up to 50,000 matches (`LISTING_DRIVEN_METRIC_SORT_LIMIT`), they read each match's value from `domain_seo_metrics` or `domain_metrics` through a correlated scalar subquery by primary key and sort the matches; the subquery is evaluated once per row (descending relies on SQLite placing nulls last, and ascending replaces a null with the largest integer). Above that, the page is read in two parts. Listings whose domain has the value come first: `domain_seo_metrics` `CROSS JOIN` `auction_listings`, which keeps the metric table the outer loop, walks the metric's `(metric, domain_name)` index in order (`domain_metrics_metric_value_domain_name_idx` for DR) and finds each domain's listings through `auction_listings_domain_name_idx`, stopping after the page. Listings without the value follow by walking `auction_listings_domain_name_idx` with `NOT EXISTS`. Both write every filter column as `+column` (`activeListingWhere(..., pinned)`), which SQLite cannot use to choose an index, so a TLD or price filter cannot make it read that filter's index and sort every match instead (5.6 seconds for `.com` when measured). Only a page that starts among the listings without a value counts the others. Under 50,000, the join could scan the whole metric index for a filter few listings match; above it, the sort of every match is what costs.

The metric indexes replaced the single-column ones one for one (migration `0010_metric_sort_indexes.sql`), and the DR index holds one entry per rated domain, so the change adds no listing writes. Measured with `corepack pnpm benchmark:filters` on 2026-10-08 against copies of the local inventory (2,279,518 open listings), median whole requests went from 2.77 s to 0.24 s for a Trust Flow sort, 3.00 s to 0.27 s for its page 200, 2.74 s to 0.24 s for Semrush Authority, 0.94 s to 0.25 s for Ahrefs DR, and 0.35 s to 0.06 s for DR within `.com`; most of what remains is the count. Other shapes kept their times, a few milliseconds faster from the fewer round trips. A workerd test explains every metric sort, with and without TLD and price filters, and fails on `USE TEMP B-TREE FOR ORDER BY`.

`auction_listings` has no single-column index on end time, price, bids, or age. Migration `0011_drop_unused_listing_indexes.sql` dropped them: in every measured plan SQLite chose `auction_listings_status_provider_idx` instead, and D1 bills a written row per index on every insert and change. Measured with D1's `rows_written` on the sync's own upsert, a new listing went from 10 written rows to 6 and a listing whose bid changed from 9 to 5; an unchanged listing still writes none.

## Ahrefs DR

The page reads stored DR for the visible rows only. Fetching it, on demand from the browser, is in [Ahrefs Domain Rating enrichment](domain-rating-enrichment.md).

## UI boundary

The toolbar is one client island (`apps/web/src/components/auctions/auctions-toolbar.tsx`): search, faceted Source and TLD filters, Max bid, and Ends each push a canonical URL from `buildDomainTableHref` on page 1. Every other filter lives on the Filters page (`/filters/`), a client form that reads its draft into the same parser and pushes the same canonical URL. Applied constraints render as server-side removable links.

The table is a server-rendered stock `Table` whose columns come from one registry (`apps/web/src/domain/table-columns.ts`) and a per-browser `columns` cookie the page reads. Every column is a URL-backed sort. Column widths are a second per-browser cookie, `column-widths` (`key:width` pairs; absent keys use the registry default). The table uses fixed layout and a `<colgroup>` whose widths read CSS variables, with the default as each fallback; the Details column has no width and takes what the others leave. `apps/web/src/components/auctions/column-resize.tsx` is the one client island: a provider that holds the widths as those variables, and a separator handle in each header's right padding that changes them by pointer drag or keyboard and writes the cookie when a change ends. A drag therefore re-lays out the table without re-rendering rows, and the server renders saved widths on the next request. Each resizable header carries an `aria-label`, so the handle's label stays out of the header's name. Relative end time and absolute UTC are computed on the server from one request reference time. A contained scroll region, sticky headers, and a sticky Domain column keep the table usable at narrow widths.


## Provider-free verification

The workerd D1 tests and the browser tests run every predicate, sort, and facet rebuild against invented rows in isolated D1; how they stay isolated is in [Isolated verification](isolated-verification.md).
