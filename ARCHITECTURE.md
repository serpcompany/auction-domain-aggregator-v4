# Architecture

## Status

This document maps the current application and its stable boundaries. Dynadot auction ingestion and the D1-backed discovery table are implemented locally. Scheduling, remote Cloudflare resources, additional auction providers, and domain-metric ingestion are not implemented.

## System purpose

The system collects auction and expired-domain listings, stores normalized data locally, and presents active listings in a filterable and sortable table. The user leaves the application to complete auction activity on the provider's listing page.

## Current system flow

```text
manual `pnpm sync:dynadot`
        |
        v
loopback-only Wrangler worker -> Dynadot adapter -> bounded D1 upserts
                                                   |
                                                   v
                                            local Cloudflare D1
                                                   |
                                                   | server-side queries only
                                                   v
                                             Next.js application
                                                   |
                                                   v
                                        Dynadot auction page link
```

## Major responsibilities

### Next.js application

`src/app/page.tsx` normalizes URL search parameters, asks `src/server/queries/domain-listings.ts` for active listings, and server-renders `src/components/domain-discovery.tsx`. The URL is canonical filter, sort, and page state. D1 performs every filter, allowlisted sort, count, and fixed 50-row page; only bounded facets and the current page cross into the UI. Majestic Topic and Ahrefs DR are displayed as unavailable until real enrichment is implemented.

The read model derives TLD, domain length, hyphen presence, and digit presence from normalized listing names. It applies OR within repeated source, auction-type, and TLD values and AND across filter families. Count, page, facet, and freshness reads remain sequential because concurrent local D1 snapshots previously produced locking failures. The full read behavior and measured index decision are recorded in `docs/technical-design/domain-discovery.md`.

The request boundary is D1-only: normal page and health requests may construct the server-side Drizzle client and query D1, but must not import or call provider networking or ingestion entry points.

### Dynadot ingestion

`pnpm sync:dynadot` is the only implemented ingestion trigger. `scripts/sync-dynadot.ts` starts a temporary, loopback-only Wrangler worker from `src/server/ingestion/local-worker.ts`. The runner sends bounded continuation requests; the worker owns continuation state in D1 and calls the adapter in `src/server/providers/dynadot/`.

`src/server/ingestion/sync-dynadot.ts` defines synchronization behavior. `src/server/ingestion/sync-dynadot-d1.ts` owns D1 writes and reconciliation. Provider responses are runtime-validated and normalized before persistence. Domains and listings are upserted in bounded batches. Missing listings become inactive only in the same atomic finalization as a successful complete run, and a guard fails the run instead when too many still-running auctions would disappear at once. Individual invalid provider records are skipped and counted rather than failing the run.

The local runner gives the worker only an allowlisted process environment and a mode-0600 temporary file containing the Dynadot key. It removes the file and terminates the child process on normal exit and handled interruption. This local mechanism is not a deployed API or a scheduling design.

### Domain enrichment

Ahrefs Domain Rating and Majestic Topic remain planned domain-level enrichment. When implemented, a successful result is stored once per domain and is not automatically refreshed. No enrichment table or provider call exists yet.

### Cloudflare D1

D1 is the current source of truth. `src/server/db/schema.ts` defines:

- `domains`: normalized domain identity and first-seen time.
- `auction_listings`: provider/external-ID identity, domain foreign key, outbound URL, mutable auction fields, active state, and first/last-seen times.
- `ingestion_runs`: provider run status, server-owned next-page continuation, timestamps, counters, and a fixed diagnostic code.

Generated migrations are in `drizzle/`; `0001_smooth_alex_wilder.sql` adds persisted continuation state. Both application and ingestion Wrangler configurations bind the same local-only database with `remote: false`.

## Architectural invariants

- User-facing reads come from D1, never directly from an external provider.
- External responses are runtime-validated and normalized at their provider boundary.
- A domain and an auction listing are separate concepts. Listings use provider plus external ID as identity.
- Synchronization is idempotent and safe to resume or retry.
- A failed, partial, stale, or interrupted run cannot reconcile unseen listings as inactive.
- Successfully stored Ahrefs and Majestic enrichment will be write-once and never automatically refreshed.
- Provider credentials remain outside the repository and must not appear in logs, fixtures, errors, or documentation.
- Remote D1, deployment, and provider calls are not part of routine checks.

## Cross-cutting concerns

Every ingestion run records provider, start and completion times, outcome, page position, counts, and a non-secret error code. The D1 adapter predicates progress and finalization on the matching running run so stale continuations cannot mutate it.

D1 statements stay below its 100-bound-parameter limit, and a local sync is segmented to fit the workerd request-duration boundary. Network calls and response bodies have explicit time and size bounds. Indexes follow the implemented table filters and sorts.

Detailed behavior and verified ingestion evidence are in `docs/technical-design/data-ingestion.md`.

## Physical code map

- `src/app/` owns Next.js routes, layout, global styles, and the D1 health route.
- `src/components/domain-discovery.tsx` composes the page, `src/components/domain-filters.tsx` owns the single URL-backed filter-form island, and `src/components/domain-results-table.tsx` owns the server-rendered comparison table. `src/components/ui/` contains repository-owned shadcn source.
- `src/domain/domain-table.ts` owns pure filter parsing, link construction, and presentation formatting.
- `src/server/db/` owns the server-only Drizzle schema, client, and database types.
- `src/server/queries/domain-listings.ts` is the server-only application boundary for the D1 table read model implemented in `domain-listings-query.ts`.
- `src/server/providers/dynadot/` terminates Dynadot response shapes and returns normalized listings.
- `src/server/ingestion/` owns provider-independent sync flow, Dynadot D1 storage, the protected local worker, and local-runner utilities.
- `scripts/sync-dynadot.ts` orchestrates the manual loopback sync.
- `e2e/` contains Playwright acceptance against an OpenNext workerd preview with temporary, provider-free D1 fixtures.
- `wrangler.jsonc` and `wrangler.ingestion.jsonc` define application and ingestion workers sharing local D1 only. `wrangler.integration.jsonc` and `wrangler.e2e.jsonc` are isolated proof configurations and never use the owner's local inventory.

Browser components must not import `src/server/`. Provider-specific shapes must not escape their adapter. Only ingestion code may cross both the provider-network and database boundaries.
