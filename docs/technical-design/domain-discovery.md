# Domain discovery read model and interface

Status: Implemented locally

Last updated: 2026-10-08

## Purpose

This document records the implemented D1 read path, URL contract, derived domain properties, presentation boundary, and measured schema decision for the domain-discovery table. A normal page or health request reads only D1 and never calls a provider. Stable ownership boundaries remain in `ARCHITECTURE.md`; user-visible behavior remains in the product spec.

## Request and state boundary

The page request parses untrusted search parameters into one normalized `DomainTableFilters` value in `apps/web/src/domain/domain-table.ts`. The same value drives link construction, applied-filter summaries, D1 predicates, sorting, and pagination. Raw search parameters never enter the query layer.

The URL is canonical state. Filter submission uses GET and omits `page`, so applying a change returns to page 1. Removing one summary changes only that filter family and also returns to page 1. Sorting and pagination preserve all filters. Invalid enum values are rejected, numeric inputs are bounded, reversed ranges are normalized, and page size is always 50.

Repeated Source, Auction type, and TLD values use OR within their category; all filter families combine with AND. The parser retains at most 64 repeated category values in deterministic source, type, then TLD order. This shared limit keeps the worst accepted production row query at 87 bindings (64 category values, active status, the reference time, 19 scalar filters including the four SEO-metric minimums, row limit, and offset), below D1's 100-bound-parameter ceiling. A workerd test on real D1 runs that worst case.

## D1 query behavior

`queryDomainListingsWithDatabase` accepts only normalized filters and an application database. It selects active listings, applies parameterized predicates, counts the complete result, returns one stable page, and reads Ahrefs DR and feed SEO metrics for that page only, in one D1 batch: three round trips per request, of which only the count scales with the filtered inventory. A nullable or metric sort adds one when its page reaches the listings without a value, and one more when the page starts among them. The page reads the source, auction-type, and TLD facets from the precomputed `listing_facets` table and the latest successful sync time once, beside the listing query, in one batch (`queryInventoryStatusWithDatabase`).

SEO-metric minimums (`majesticTfMin`, `majesticCfMin`, `majesticRefDomainsMin`, `semrushAsMin`) filter on `domain_seo_metrics`, the per-domain table that GoDaddy and Namecheap syncs refresh. They become one `domain_name in (select domain_name from domain_seo_metrics where ...)` predicate, so the metric indexes find the matching domains and listings are reached through `auction_listings_open_domain_name_idx`. A domain's metrics apply to all its listings, whatever their source. Each row carries `seoMetrics` (null when no feed published metrics for the domain), read only for the visible page like Ahrefs DR. GoDaddy bid listings are stored as auction type `AUCTION` and fixed-price listings as `BUY_NOW`, so the Auction type filter's `auction` and `buy_now` values include or exclude them.

Nullable numeric fields remain visible when unconstrained. A constraint on that field excludes nulls because an unknown value cannot honestly satisfy a minimum or maximum. Nullable and metric sorts place unknown values last in both directions. Ties, and the listings without a value, are ordered by domain name, then end time, then rowid, in the sort's own direction, so a descending page lists tied domains from Z to A (see [Indexes](#indexes-and-measured-request-time) for why). Every read (rows, count, and facets) excludes listings whose `ends_at` is at or before the injected reference time, because status changes only when a sync reconciles and sync is not continuous. `ends_at` is `NOT NULL`, so the open-listing predicate is a plain `status = 'active' and ends_at > ?`; the earlier `ends_at is null or ...` branch could never match and kept SQLite from using `ends_at` in an index. The status is a literal, not a bound value, because SQLite uses a partial index only when the query repeats its predicate. Ending-window filters add an upper bound to that same reference time. When the latest successful sync is more than 24 hours old, the page shows a stale-inventory notice.

Reads remain sequential. Local D1 produced snapshot locking when the count, row, facet, and freshness reads ran concurrently, and no measured navigation need justifies reintroducing that failure mode. A D1 batch is not concurrent: it runs its statements one after another in one round trip, which is what deployed D1 charges latency for.

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

Every sort except Source, Type, and Length reads its page from an index already in the page's order and stops after the page, instead of sorting every open listing. The listing indexes are partial (`WHERE status = 'active'`), so inactive listings cost them nothing:

| Index | Columns | Serves |
| --- | --- | --- |
| `auction_listings_open_ends_at_idx` | `ends_at, domain_name, provider, auction_type, current_bid_cents` | The default sort, and a covering count for the unfiltered page and the source, type, price, ending-window, and domain-name filters |
| `auction_listings_open_domain_name_idx` | `domain_name, ends_at` | The Domain sort, listings without a metric, the listing side of metric sorts, and SEO-metric filters |
| `auction_listings_open_<column>_idx` | `<column>, domain_name, ends_at` | Price, bids, age, links, visitors, appraisal, and renewal: the sort, and a covering count with that column's filter |
| `domain_seo_metrics_<metric>_domain_name_idx` | `<metric>, domain_name` | Trust Flow, Citation Flow, referring domains, and Authority Score sorts and minimums |
| `domain_metrics_metric_value_domain_name_idx` | `metric, value, domain_name` | The Domain Rating sort |
| `auction_listings_provider_status_idx` | `provider, status` | Reconciliation, and source filters |

The TLD and length indexes, `(tld, status, ends_at)` and `(domain_length, status, ends_at)`, are unchanged.

What the planner needs, and the workerd test that explains every indexed sort's statements checks:

- SQLite uses an index for `ORDER BY ... LIMIT` only when the index satisfies every term. With the earlier fixed tie-break (domain, provider, external ID, always ascending), every sort fell back to sorting all open listings, so ties follow the sort's direction and end with end time and rowid, the order the indexes store.
- Without `sqlite_stat1`, SQLite assumes an equality matches about ten rows, so the earlier `(status, provider)` index won every query on `status = ?` and its rows were sorted. It is now `(provider, status)`, which reconciliation still uses.
- The status is a literal, so the partial indexes apply. A Domain-ordered page writes `+ends_at`, so SQLite walks the domain index rather than an end-time range and a sort.
- Metric values live in other tables. Above 50,000 matches (`LISTING_DRIVEN_METRIC_SORT_LIMIT`), a metric sort `CROSS JOIN`s from the metric's index, which SQLite always keeps as the outer loop, to each domain's listings, and then lists the listings without the value through `NOT EXISTS` in domain order. Up to 50,000 it reads each match's metric by primary key and sorts them (about 60 ms at the limit), because a filter that few listings match would make the join scan the whole metric index (about 0.5 s for a nine-listing substring).
- Nullable sorts read `column is not null` from the column's index, then `column is null` from the same index in domain order. Only a page that starts among the unknown values counts the known ones.

`ANALYZE`, which Cloudflare suggests through `PRAGMA optimize`, is not needed: on a scratch copy it changed no plan.

`corepack pnpm benchmark:filters` calls `queryDomainListingsWithDatabase`, the function the page uses, through Wrangler's local D1 binding (`getPlatformProxy` on `apps/web/wrangler.jsonc`, loading no env or `apps/web/.dev.vars` file): one warm-up and five measured runs per shape. It reports each whole request's time and each statement's time, with the query plans of the count and row statements, and uses the latest successful sync time as a reproducible reference time. It prints no domain rows.

Measured 2026-10-08 on copies of the owner's local inventory (all four providers: 2,910,215 listings, 2,343,554 active, 2,279,518 open at the reference time), before and after migrations `0010` to `0013`. Median of five warm requests, in ms; before includes the facet and freshness reads (about 10 ms) that now happen once beside the listing query:

| Request | Matches | Before | After |
| --- | ---: | ---: | ---: |
| Default page (end-time sort) | 2,279,518 | 792 | 78 |
| End-time sort, page 2,000 | 2,279,518 | 1,378 | 287 |
| Price, bids, age, renewal, or Domain sort | 2,279,518 | 636 to 700 | 72 to 75 |
| Trust Flow or Authority Score sort | 2,279,518 | 3,090 to 3,307 | 73 |
| Trust Flow sort, page 200 | 2,279,518 | 3,392 | 105 |
| Trust Flow sort, Dynadot only | 454,801 | 531 | 94 |
| Domain Rating sort | 2,279,518 | 1,079 | 74 |
| Links sort, page 2,000 | 2,279,518 | 1,514 | 75 |
| TLD `com` | 761,192 | 126 | 89 |
| Price $1 to $500, ending within 24 hours | 261,892 | 749 | 146 |
| Contains `a`, max $500, no hyphens | 1,184,834 | 1,261 | 391 |
| No hyphens, no digits | 1,515,173 | 1,355 | 423 |
| Expired, 3 or more bids, bids sort | 416 | 963 | 40 |
| Semrush AS 20 or more | 149 | 1,137 | 38 |
| Source or Type sort | 2,279,518 | 658 to 719 | 263 to 274 |
| Length 8 to 15 | 1,340,571 | 972 | 754 |

What remains is the count, which reads every match from a covering index: 40 ms for every open listing, but 360 to 390 ms when a hyphen, digit, or substring test runs on each name. Source and Type sorts still sort every open listing. A length range picks the length index and then sorts its matches, because without statistics SQLite rates a two-sided range as more selective than the end-time walk. Deep pages walk their offset.

The indexes add 0.6 GB to the 1.4 GB local database, and D1 bills index writes as written rows. Each partial index adds one row written for each new listing and one for each listing a sync inactivates, about 165,000 of each per day across the four providers: net of the four dropped indexes, about 2.3 million more rows written per day per environment.

## Ahrefs DR

The page reads stored DR for the visible rows only. Fetching it, on demand from the browser, is in [Ahrefs Domain Rating enrichment](domain-rating-enrichment.md).

## UI boundary

The toolbar is one client island (`apps/web/src/components/auctions/auctions-toolbar.tsx`): search, faceted Source and TLD filters, Max bid, and Ends each push a canonical URL from `buildDomainTableHref` on page 1. Every other filter lives on the Filters page (`/filters/`), a client form that reads its draft into the same parser and pushes the same canonical URL. Applied constraints render as server-side removable links.

The table is a server-rendered stock `Table` whose columns come from one registry (`apps/web/src/domain/table-columns.ts`) and a per-browser `columns` cookie the page reads. Every column is a URL-backed sort. Relative end time and absolute UTC are computed on the server from one request reference time. A contained scroll region, sticky headers, and a sticky Domain column keep the table usable at narrow widths.


## Provider-free verification

The workerd D1 tests and the browser tests run every predicate, sort, and facet rebuild against invented rows in isolated D1; how they stay isolated is in [Isolated verification](isolated-verification.md).
