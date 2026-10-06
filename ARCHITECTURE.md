# Architecture

## Status

This document maps the current application and its stable boundaries. Dynadot and GoDaddy auction ingestion (a cron-started Cloudflare Workflow per provider), GoDaddy's per-domain SEO metrics, on-demand Ahrefs DR, and the D1-backed discovery table are implemented and verified locally with Wrangler. Nothing is deployed and no remote Cloudflare resources exist; other auction providers are not implemented.

## System purpose

The system collects auction and expired-domain listings, stores normalized data locally, and presents active listings in a filterable and sortable table. The user leaves the application to complete auction activity on the provider's listing page.

## Current system flow

```text
daily Cron Trigger (or local `pnpm sync <provider>`)
        |
        v
ingestion Worker -> one `provider-sync` Workflow instance per provider
        |   [stage feed]       file feeds: fetch zip -> inflate -> split `data`
        |                      array -> 1,000-record page files in R2
        |   sync segments      provider adapter (API, or R2 pages) -> bounded,
        |                      guarded D1 upserts; reconciliation on success
        |   [delete pages]     file feeds: remove the instance's R2 prefix
        v
                                            Cloudflare D1
                                                   |
                                                   | server-side queries only
                                                   v
                                             Next.js application
                                                   |
                                                   v
                                   provider auction page link
```

## Major responsibilities

### Next.js application

`src/app/page.tsx` normalizes URL search parameters, asks `src/server/queries/domain-listings.ts` for active listings, and server-renders `src/components/domain-discovery.tsx`. The URL is canonical filter, sort, and page state. D1 performs every filter, allowlisted sort, count, and fixed 50-row page; only the facet values and the current page cross into the UI. Majestic Topic and Ahrefs DR are displayed as unavailable until real enrichment is implemented.

TLD and domain length are SQLite-generated, indexed columns of `auction_listings`; hyphen and digit presence are query expressions over the normalized name. The read model applies OR within repeated source, auction-type, and TLD values and AND across filter families. The filter-independent facets (sources, auction types, every TLD) are not grouped per request: each successful sync rebuilds the `listing_facets` read model, and a request reads it. Count, page, facet, and freshness reads remain sequential because concurrent local D1 snapshots previously produced locking failures. The full read behavior and measured index decision are recorded in `docs/technical-design/domain-discovery.md`.

The request boundary is D1-only: normal page and health requests may construct the server-side Drizzle client and query D1, but must not import or call provider networking or ingestion entry points. The one exception is `POST /api/enrichment/domain-rating`, described below.

### Auction ingestion

Ingestion is a separate Worker (`wrangler.ingestion.jsonc`, entry `src/server/ingestion/sync-worker.ts`) with no HTTP routes. Its daily Cron Trigger starts one instance of the `provider-sync` Workflow for each provider in `src/server/providers/registry.ts`; Dynadot and GoDaddy are implemented. `sync-worker.ts` is a thin runtime adapter; the steps live in `src/server/ingestion/provider-sync-workflow.ts`. Workflow steps replace the earlier loopback HTTP continuation loop: each step gets its own CPU budget, its result is persisted, and the platform retries an interrupted step. `corepack pnpm sync <provider>` runs the same Workflow inside a temporary local `wrangler dev` (`scripts/sync-provider.ts`).

Adapters implement `ProviderAdapter` from `src/server/providers/types.ts`: they fetch one numbered page, return normalized listings with raw received and rejected counts, and decide whether it is the last page. `src/server/ingestion/sync.ts` defines provider-neutral synchronization behavior, run by the Workflow in segments of 20 pages per step. Continuation state is server-owned in D1, so a retried step resumes from the last committed page. `src/server/ingestion/d1-storage.ts` owns D1 writes and reconciliation for storage bound to one provider, so a provider's run never reads, reconciles, or interrupts another provider's listings or runs. Provider responses are runtime-validated and normalized before persistence. Domains and listings are upserted in bounded batches. Missing listings become inactive only in the same atomic finalization as a successful complete run, which also rebuilds `listing_facets` from the reconciled inventory, and a guard fails the run instead when too many still-running auctions would disappear at once. Individual invalid provider records are skipped and counted rather than failing the run.

GoDaddy publishes no paged API for its inventory, only a daily zipped JSON file of about 600,000 listings (37 MB zipped, 450 MB unzipped). Its registry entry declares a file feed. The Workflow's first step streams the archive with `fetch`, reads the zip entry from its local header, inflates it with `DecompressionStream('deflate-raw')`, splits the `data` array with a byte-level scanner, and writes 1,000-record page files marked with `isLastPage` to the `FEED_PAGES` R2 bucket under the instance's own prefix (`src/server/ingestion/feed-stage.ts`, `feed-pages.ts`). The GoDaddy adapter reads those pages through a `FeedPageSource`, and the run follows the same sync, storage, and reconciliation path as Dynadot. A final step deletes the prefix after success or failure. The whole stage measured about 3 to 8 seconds of Worker CPU and 10 MiB of heap, inside the configured 60-second step limit.

### Domain enrichment

Ahrefs Domain Rating (DR) is fetched on demand for the rows a person is viewing, never for the whole inventory. After the table renders from D1, `src/components/enrich-visible-domain-ratings.tsx` posts the visible domains that lack DR to `POST /api/enrichment/domain-rating`.
- That route is the only request path that calls a provider.
- It accepts at most 50 domains, and `src/server/enrichment/domain-rating.ts` fetches only those with an active listing and no stored rating.
- Ratings come from Ahrefs' free `domain-rating-free` endpoint (`src/server/enrichment/ahrefs.ts`) and are written once to `domain_metrics`. "No rating" is stored too, so it is not requested again.
- When something is stored, the client refreshes the page, which re-renders from D1.
- Every displayed value sits under the "Domain Rating by Ahrefs" attribution link that the DR licence requires (`docs/references/data-licensing.md`).

Majestic Topic is not planned (#19).

### Cloudflare D1

D1 is the current source of truth. `src/server/db/schema.ts` defines:

- `domains`: normalized domain identity and first-seen time.
- `auction_listings`: provider/external-ID identity, domain foreign key, outbound URL, mutable auction fields, active state, first/last-seen times, and the generated `tld` and `domain_length` columns.
- `listing_facets`: the source, auction-type, and TLD values of the active inventory, each with its latest end time; derived data that only a successful sync's finalization (and test fixtures) rewrites.
- `domain_metrics`: write-once domain enrichment keyed by domain and metric (`ahrefs_dr`), with an `ok`/`not_found` status.
- `domain_seo_metrics`: one row per domain of feed-published Majestic and SEMrush metrics in typed, indexed columns, with the publishing source. Every sync that carries metrics overwrites them (latest wins).
- `ingestion_runs`: provider run status, server-owned next-page continuation, timestamps, counters, and a fixed diagnostic code.

Generated migrations are in `drizzle/`; `0001_smooth_alex_wilder.sql` adds persisted continuation state, and `0005_greedy_glorian.sql` adds `domain_seo_metrics` and makes `auction_listings.bidder_count` nullable, because GoDaddy publishes no bidder count. `0006_listing_tld_length_facets.sql` adds the generated columns, their indexes, and `listing_facets` with a one-time backfill. Both application and ingestion Wrangler configurations bind the same local-only database with `remote: false`.

### Cloudflare R2 and Workflows

The ingestion Worker binds `FEED_PAGES` (R2) for transient file-feed pages and `PROVIDER_SYNC` (the `provider-sync` Workflow). Both are local-only; R2 holds no durable data, and nothing user-facing reads it.

## Architectural invariants

- User-facing reads come from D1, never directly from an external provider.
- External responses are runtime-validated and normalized at their provider boundary.
- A domain and an auction listing are separate concepts. Listings use provider plus external ID as identity.
- Synchronization is idempotent and safe to resume or retry.
- A failed, partial, stale, or interrupted run cannot reconcile unseen listings as inactive.
- Successfully stored Ahrefs DR is write-once and never automatically refreshed. Metrics published inside a provider's auction feed are different: they arrive with every sync and the latest values replace the stored ones.
- Unknown provider values are stored as null, never as an invented zero.
- Provider credentials remain outside the repository and must not appear in logs, fixtures, errors, or documentation.
- Remote D1, deployment, and provider calls are not part of routine checks.
- Ingestion does not depend on the owner's machine: the Cron Trigger, Workflow, R2, and D1 hold every step and its state.
- Staged feed pages are transient and scoped to one Workflow instance; they are deleted when the instance ends.

## Cross-cutting concerns

Every ingestion run records provider, start and completion times, outcome, page position, counts, and a non-secret error code. The D1 adapter predicates progress and finalization on the matching running run so stale continuations cannot mutate it.

D1 statements stay below its 100-bound-parameter limit, and a sync is segmented into Workflow steps so each fits a Worker invocation's CPU limit. Network calls, archive and document sizes, and page bodies have explicit time and size bounds. Indexes follow the implemented table filters and sorts.

Detailed behavior and verified ingestion evidence are in `docs/technical-design/data-ingestion.md`.

## Physical code map

- `src/app/` owns Next.js routes, layout, global styles, and the D1 health route.
- `src/components/domain-discovery.tsx` composes the page, `src/components/domain-filters.tsx` owns the single URL-backed filter-form island, and `src/components/domain-results-table.tsx` owns the server-rendered comparison table. `src/components/ui/` contains repository-owned shadcn source.
- `src/domain/domain-table.ts` owns pure filter parsing, link construction, and presentation formatting.
- `src/server/db/` owns the server-only Drizzle schema, client, and database types, and `listing-facets.ts`, the SQL that rebuilds the facet read model.
- `src/server/queries/domain-listings.ts` is the server-only application boundary for the D1 table read model implemented in `domain-listings-query.ts`.
- `src/server/providers/types.ts` defines the normalized listing and adapter contract; `src/server/providers/registry.ts` maps implemented providers to their secret names, optional file feed, and adapters; `src/server/providers/normalize.ts` holds shared domain, money, and bounded-body parsing; `src/server/providers/dynadot/` and `src/server/providers/godaddy/` terminate each provider's shapes.
- `src/server/ingestion/` owns the provider-neutral sync flow, provider-bound D1 storage, the ingestion Worker and Workflow (`sync-worker.ts`, `provider-sync-workflow.ts`), web-stream file-feed staging (`feed-stage.ts`) and its R2 pages (`feed-pages.ts`), and local-runner utilities. `zip-fixture.ts` builds invented archives for tests only.
- `scripts/sync-provider.ts` runs one provider's Workflow in a temporary local `wrangler dev`.
- `e2e/` contains Playwright acceptance against an OpenNext workerd preview with temporary, provider-free D1 fixtures.
- `wrangler.jsonc` and `wrangler.ingestion.jsonc` define the application and ingestion Workers sharing local D1 only; the ingestion configuration adds the local R2 bucket, the Workflow, the Cron Trigger, and its CPU limit. `wrangler.integration.jsonc` (D1 and R2) and `wrangler.e2e.jsonc` are isolated proof configurations and never use the owner's local inventory.

Browser components must not import `src/server/`. Provider-specific shapes must not escape their adapter. Only ingestion code may cross both the provider-network and database boundaries; it runs only in the ingestion Worker, never in the web application's request path.
