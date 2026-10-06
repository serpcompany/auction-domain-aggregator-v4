# Domain discovery read model and interface

Status: Implemented locally

Last updated: 2026-07-13

## Purpose

This document records the implemented D1 read path, URL contract, derived domain properties, presentation boundary, and measured schema decision for the first domain-discovery table. Stable ownership boundaries remain in `ARCHITECTURE.md`; user-visible behavior remains in the product spec.

## Request and state boundary

The page request parses untrusted search parameters into one normalized `DomainTableFilters` value in `src/domain/domain-table.ts`. The same value drives link construction, applied-filter summaries, D1 predicates, sorting, and pagination. Raw search parameters never enter the query layer.

The URL is canonical state. Filter submission uses GET and omits `page`, so applying a change returns to page 1. Removing one summary changes only that filter family and also returns to page 1. Sorting and pagination preserve all filters. Invalid enum values are rejected, numeric inputs are bounded, reversed ranges are normalized, and page size is always 50.

Repeated Source, Auction type, and TLD values use OR within their category; all filter families combine with AND. The parser retains at most 64 repeated category values in deterministic source, type, then TLD order. This shared limit keeps the worst accepted production row query at 87 bindings (64 category values, active status, the reference time, 19 scalar filters including the four SEO-metric minimums, row limit, and offset), below D1's 100-bound-parameter ceiling. The real-D1 integration proof runs that worst case.

## D1 query behavior

`queryDomainListingsWithDatabase` accepts only normalized filters and an application database. It selects active listings, applies parameterized predicates, counts the complete result, returns one stable page, and separately reads bounded source, auction-type, and TLD facets plus the latest successful sync time.

SEO-metric minimums (`majesticTfMin`, `majesticCfMin`, `majesticRefDomainsMin`, `semrushAsMin`) filter on `domain_seo_metrics`, the per-domain table that GoDaddy syncs refresh. They become one `domain_name in (select domain_name from domain_seo_metrics where ...)` predicate, so the metric indexes find the matching domains and listings are reached through `auction_listings_domain_name_idx`. A domain's metrics apply to all its listings, whatever their source. Each row carries `seoMetrics` (null when no feed published metrics for the domain), read only for the visible page like Ahrefs DR. GoDaddy bid listings are stored as auction type `AUCTION` and fixed-price listings as `BUY_NOW`, so the Auction type filter's `auction` and `buy_now` values include or exclude them.

Nullable numeric fields remain visible when unconstrained. A constraint on that field excludes nulls because an unknown value cannot honestly satisfy a minimum or maximum. Nullable sorts place unknown values last in both directions. Domain, provider, and external ID complete deterministic tie-breaking. Every read (rows, count, and facets) excludes listings whose `ends_at` is at or before the injected reference time, because status changes only when a sync reconciles and sync is not continuous. Listings without an end time remain visible. Ending-window filters add an upper bound to that same reference time. When the latest successful sync is more than 24 hours old, the page shows a stale-inventory notice.

Reads remain sequential. Local D1 produced snapshot locking when the count, row, facet, and freshness reads ran concurrently, and no measured navigation need justifies reintroducing that failure mode.

## Derived domain properties

The read model derives these values from `auction_listings.domain_name`:

- TLD: the final label, extracted with SQLite JSON string operations so multi-dot names are handled correctly.
- Domain length: the normalized full domain-name length.
- Shape: whether the normalized name contains a hyphen or an ASCII digit.

These properties are query expressions, not schema columns. Ingestion therefore has no backfill or dual-write responsibility for them.

## Measured schema and index decision

The real local inventory contained 426,400 listings, 426,398 active. Warm count and 50-row page measurements for TLD, length, shape, price/timing, auction activity, and stored metric filters stayed below 155 ms. A deliberately broad substring case stayed below 116 ms. The production-sized 250-value TLD facet was the slowest read at roughly 283 ms mean in the reproducible benchmark.

Query plans use `auction_listings_status_provider_idx` for active inventory and temporary B-trees where expression ordering or grouping requires them. Those results meet the accepted local navigation targets, so no derived-field migration or new index was added. `corepack pnpm benchmark:filters` reruns sanitized aggregate measurements against the populated local binding without printing domain rows or loading `.env`.

## UI boundary

The filter controls are one client island inside a semantic GET form. Quick controls remain on the page; `More filters` is a near-full-page stock shadcn `Sheet` of `Field` groups. Source, TLD, and auction type are stock shadcn `Combobox` chips; Base UI submits one hidden input per selected value, so the GET form receives repeated parameters. The ending window is a stock `Select` that submits nothing for "Any time". Local control changes never query D1 until Apply. The server renders result counts, summaries, pagination, and the table.

The table is a semantic ten-column comparison surface with eight URL-backed sortable headers. Relative end time and absolute UTC are computed on the server from one request reference time. A contained scroll region, sticky header, and sticky Domain column preserve the table at narrow widths without changing it into cards.

## Provider-free verification

The D1 integration proof applies migrations to temporary persistence, exercises every predicate and sort against invented rows, terminates workerd, and removes its state. Playwright uses a separate `wrangler.e2e.jsonc` and `scripts/start-e2e-preview.ts`; that runner creates an isolated temporary D1, inserts 60 deterministic invented listings, and serves the built OpenNext worker.

Playwright global setup creates a temporary build workspace from an explicit source manifest. Only required root configuration and `.ts`, `.tsx`, `.css`, SVG, and `_headers` files under `src` and `public` are copied; dotenv files, `.dev.vars`, local key material, `.git`, `.wrangler`, generated output, and repository temporary state are never traversed into the workspace. Dependencies are reconstructed from the locked local pnpm store with `--offline --frozen-lockfile --ignore-scripts`, so the workspace does not symlink back through the repository. OpenNext and Next build entirely inside that workspace, then only `.open-next` is published for the preview and the workspace is removed in `finally`. A controlled-fixture test proves dotenv sentinels and local-state paths are absent from the copied manifest. The verified E2E build output does not report a loaded environment file.

After the isolated build, global setup proves the configured loopback port is free, starts the preview runner as a direct child with a unique run identifier, and returns an awaited teardown. The seed includes a domain containing that identifier, and readiness requires both a healthy D1 response and a filtered page containing that exact domain. A stale or unrelated server therefore cannot satisfy readiness even in the race after the port check.

The runner installs signal handlers before setup and all normal, failure, and signal paths share one cleanup promise that stops the active child before removing that run's directory. Teardown fails if any directory with its exact unique prefix remains. Focused lifecycle tests independently prove the port guard rejects an occupied listener without touching it, concurrent cleanup callers share the same promise, child shutdown finishes before removal, and cleanup removes only the supplied directory. Neither proof reads repository dotenv files, calls a provider, uses remote D1, or mutates `.wrangler` and the owner's inventory.
