# Architecture

## Status

This document maps the current application and its stable boundaries. Dynadot, GoDaddy, Namecheap, and NameSilo auction ingestion (a cron-started Cloudflare Workflow per provider), the feeds' per-domain SEO metrics, on-demand Ahrefs DR, and the D1-backed discovery table are implemented and verified locally with Wrangler, each provider with a real sync. CI deploys the sync and the website to Staging (from the `staging` branch) and Production (from `main`), each environment with its own D1 ([Deployment](docs/technical-design/deployment.md)). Until accounts and payments (#27), both websites are owner-only behind Cloudflare Access. DropCatch is not implemented yet.

How each part behaves in detail is in the [technical design](docs/technical-design/README.md); this document keeps only what is unlikely to change.

## System purpose

The system collects auction and expired-domain listings, stores normalized data in D1, and presents active listings in a filterable and sortable table. The user leaves the application to complete auction activity on the provider's listing page.

## Current system flow

```text
Cron Trigger (or local `pnpm sync <provider>`)
        |
        v
ingestion Worker -> one `provider-sync` Workflow instance per provider
        |   [stage feed]       file feeds: download -> split into
        |                      page files in R2
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

The page normalizes URL search parameters into one filter value, asks the server-only query boundary for active listings, and server-renders the Auctions page. The URL is canonical filter, sort, and page state. D1 performs every filter, allowlisted sort, count, and fixed 96-row page; only the facet values and the current page cross into the UI. Which table columns show is a per-browser choice in the `columns` cookie, read by the server; it is not part of the URL.

Filter-independent facets (sources, auction types, every TLD) are a read model, `listing_facets`, that each successful sync rebuilds; requests read it rather than grouping the inventory. Reads remain sequential, because concurrent local D1 snapshots produced locking failures. The page streams the results behind a skeleton in a `Suspense` boundary keyed by the URL. The read behavior, the derived TLD and length columns, and the measured index decisions are in [Domain discovery](docs/technical-design/domain-discovery.md).

The request boundary is D1-only: normal page and health requests may construct the server-side Drizzle client and query D1, but must not import or call provider networking or ingestion entry points. The one exception is `POST /api/enrichment/domain-rating`, below.

### Auction ingestion

Ingestion is a separate Worker (`apps/web/wrangler.ingestion.jsonc`, entry `apps/web/src/server/ingestion/sync-worker.ts`) with no HTTP routes. Its Cron Trigger starts one instance of the `provider-sync` Workflow for each scheduled provider in `apps/web/src/server/providers/registry.ts`: every provider daily on Production, only GoDaddy weekly on Staging, which exists to test deploys. The Worker entry only adapts the runtime; the steps live in `provider-sync-workflow.ts`. Each step gets its own CPU budget, its result is persisted, and the platform retries an interrupted step. `corepack pnpm sync <provider>` runs the same Workflow inside a temporary local `wrangler dev`.

Adapters implement `ProviderAdapter` (`apps/web/src/server/providers/types.ts`): they fetch one numbered page, return normalized listings with raw received and rejected counts, and decide whether it is the last page. `sync.ts` defines provider-neutral synchronization, run in segments of pages per Workflow step. Continuation state is server-owned in D1, so a segment that runs again resumes the same run from its last committed page. `d1-storage.ts` owns D1 writes and reconciliation for storage bound to one provider, so one provider's run never reconciles or interrupts another's. Missing listings become inactive only in the same atomic finalization as a successful complete run, and a guard fails the run instead when too many still-running auctions would disappear at once. A week after a listing's auction ends, the next successful run of any provider deletes it, with the domain and feed metrics nothing else uses, so storage does not grow with every day's ended auctions. Individual invalid provider records are skipped and counted rather than failing the run.

A provider either has a paged API, paced to its declared rate limit, or publishes one file. A file feed is downloaded once per run and split into page files under the Workflow instance's own prefix in the `FEED_PAGES` R2 bucket; its adapter reads those pages and follows the same sync path. Dynadot and NameSilo are paged APIs; GoDaddy (zipped JSON) and Namecheap (CSV) are file feeds. NameSilo blocks requests from Cloudflare Workers, so a daily GitHub Actions job records its API responses into both buckets and deployed syncs replay them. The details are in [Data ingestion](docs/technical-design/data-ingestion.md) and one leaf per provider.

### Domain enrichment

Ahrefs Domain Rating (DR) is fetched on demand for the rows a person is viewing, never for the whole inventory. After the table renders from D1, the browser posts the visible domains that lack DR to `POST /api/enrichment/domain-rating`, the only request path that calls a provider, in requests of at most 48 domains, so a full page takes two. It accepts at most 50 domains, claims them atomically in D1 so overlapping requests never ask Ahrefs for the same domain, logs every call, and honors a cool-down after a 429. The route has no access control of its own; deployed, it sits behind the website's Access gate until #27. Every displayed value sits under the "Domain Rating by Ahrefs" attribution link the DR licence requires ([Ahrefs licensing](docs/references/data-licensing/ahrefs.md)). Details are in [Ahrefs Domain Rating enrichment](docs/technical-design/domain-rating-enrichment.md). Majestic Topic is not planned (#19).

### Cloudflare D1

D1 is the current source of truth. `apps/web/src/server/db/schema.ts` defines:

- `domains`: normalized domain identity and first-seen time.
- `auction_listings`: provider/external-ID identity, domain foreign key, outbound URL, mutable auction fields, active state, first/last-seen times, and the generated `tld` and `domain_length` columns.
- `listing_facets`: the source, auction-type, and TLD values of the active inventory; derived data that only a successful sync's finalization (and test fixtures) rewrites.
- `domain_metrics`: on-demand domain enrichment keyed by domain and metric (`ahrefs_dr`), write-once once settled.
- `ahrefs_requests`: one row per call to Ahrefs, with any 429 cool-down.
- `domain_seo_metrics`: one row per domain of feed-published Majestic and SEMrush metrics; every sync that carries them overwrites them (latest wins).
- `ingestion_runs`: provider run status, server-owned continuation, counters, a fixed diagnostic code, and why a page's records were rejected.
- `ingestion_run_seen_pages`: the external IDs each page of a running sync returned, so reconciliation needs no write for unchanged listings; deleted when the run finishes.

Reviewed generated migrations are in `apps/web/drizzle/`. The top level of both Wrangler configurations binds a local-only database (`remote: false`); `env.staging` and `env.production` bind that environment's remote database, shared by its sync and website Workers.

### Cloudflare R2 and Workflows

The ingestion Worker binds `FEED_PAGES` (R2) for transient file-feed pages and `PROVIDER_SYNC` (the `provider-sync` Workflow). R2 holds no durable data, and nothing user-facing reads it.

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
- A deployed website serves no data without a valid Cloudflare Access token, and missing gate configuration fails closed (503). Only an explicit `APP_ENV=local` skips the gate.
- Ingestion does not depend on the owner's machine: the Cron Trigger, Workflow, R2, and D1 hold every step and its state.
- Staged feed pages are transient and scoped to one Workflow instance; they are deleted when the instance ends.

## Cross-cutting concerns

Every ingestion run records provider, start and completion times, outcome, page position, counts, and a non-secret error code. The D1 adapter predicates progress and finalization on the matching running run so stale continuations cannot mutate it.

D1 statements stay below its 100-bound-parameter limit, and a sync is segmented into Workflow steps so each fits a Worker invocation's CPU limit. Network calls, archive and document sizes, and page bodies have explicit time and size bounds, and every provider API declares a rate limit that its requests are paced to. Indexes follow the implemented table filters and sorts.

## Physical code map

All application code is under `apps/web/`.

- `worker.ts` is the Worker entry (Wrangler `main`). It wraps the OpenNext build in the application Worker (`src/lib/app-worker.ts`). In a deployment (any `APP_ENV` but `local`) it first answers 503 without its canonical host and Access settings, 308s every other host to the canonical one (`src/lib/deployment.ts`), and 403s any request without a valid Cloudflare Access token (`src/lib/access.ts`). Everywhere, it applies the URL trailing-slash rule (`src/lib/trailing-slash.ts`), then hands the request to OpenNext. Unless `APP_ENV` is `production`, every response carries `X-Robots-Tag: noindex, nofollow` and `/robots.txt` disallows crawling (`src/lib/indexing.ts`).
- `src/app/`: Next.js routes and the root layout. `/` is the Auctions table, `/filters/` the Filters page (the same URL contract, every filter), `/syncs/` Sync status (D1 only, never the provider registry), plus the D1 health and DR enrichment routes. The root layout reads how many providers' latest run failed for the sidebar badge and treats a read failure as zero, so a D1 error never breaks the shell; `error.tsx` catches a failed page read.
- `src/components/`: site components grouped by area (`app-shell/`, `auctions/`, `filters/`, `sync/`); `ui/` holds stock shadcn source.
- `src/domain/`: pure logic shared by server and browser: URL filter parsing and links (`domain-table.ts`), the column registry and `columns` cookie (`table-columns.ts`), the Filters form (`filter-form.ts`), and the sync schedule, which mirrors the ingestion cron under a test.
- `src/server/db/`: the server-only Drizzle schema, client, and the facet rebuild SQL.
- `src/server/queries/`: the server-only read boundary for the table and the Sync status page.
- `src/server/enrichment/`: Ahrefs DR fetching, claims, and storage.
- `src/server/providers/`: the normalized listing and adapter contract, the registry, the shared pacer and normalization helpers, the staged-page reader, and one directory per provider that terminates its shapes.
- `src/server/ingestion/`: the provider-neutral sync, provider-bound D1 storage, the ingestion Worker and Workflow, file-feed staging to R2, and local-runner utilities.
- `scripts/`: the local sync runner, the filter benchmark, and the e2e server.
- `e2e/`: Playwright acceptance against an OpenNext workerd preview with temporary, provider-free D1 fixtures, built and served from `tmp/e2e/` by `scripts/e2e-server.ts` so the developer's `.open-next` stays in place.
- `wrangler.jsonc` and `wrangler.ingestion.jsonc` define the application and ingestion Workers; `wrangler.e2e.jsonc` is the browser-test configuration. The `workers` Vitest project (`vitest.config.mts`) runs `*.workers.test.ts` in workerd with the ingestion configuration's bindings, held in memory. Neither uses the owner's local inventory.

Browser components must not import `apps/web/src/server/`. Provider-specific shapes must not escape their adapter. Only ingestion code may cross both the provider-network and database boundaries; it runs only in the ingestion Worker, never in the web application's request path.
