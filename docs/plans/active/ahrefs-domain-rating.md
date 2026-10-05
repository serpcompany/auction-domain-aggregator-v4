# Ahrefs Domain Rating enrichment

## Purpose / Big Picture

The table's Ahrefs DR column is always empty. This plan fills it with real Ahrefs Domain Rating (DR), fetched on demand for the rows a person is looking at, cached once per domain, and shown with the attribution Ahrefs' DR licence requires. After this, a page of results shows DR values within a moment of loading, and later views of the same domains read them from D1 with no Ahrefs call. The issue is serpcompany/auction-domain-aggregator-v4#18.

## Progress

- [x] (2026-10-06) Plan written.
- [x] (2026-10-06) Milestone 1: `domain_metrics` table (migration `0004`) and the Ahrefs free-DR client.
- [x] (2026-10-06) Milestone 2: enrichment service and the bounded `POST /api/enrichment/domain-rating` route.
- [x] (2026-10-06) Milestone 3: the table reads DR from D1, shows the attribution, and requests missing DR for visible rows. The empty Majestic column and the unusable Metrics filter group were removed.
- [x] (2026-10-06) Validation without provider calls: 196 unit tests at 100% coverage; integration proof (active-only, write-once, table read); e2e (4 passed, seeded DR plus attribution).
- [ ] One authorized live lookup on port 30001. This needs an Ahrefs APIv3 key in `.dev.vars`, plus a fresh Dynadot sync, because the local inventory has no open auctions.

## Surprises & Discoveries

- A left join from listings to `domain_metrics` could make SQLite join every filtered row before sorting. DR is therefore read in a second query for only the visible page's domains.
- 50 rows times 5 columns is 250 bound parameters, above D1's limit of 100. Inserts are chunked at 16 rows.

## Decision Log

- 2026-10-06 (Claude): Use Ahrefs' free `POST https://api.ahrefs.com/v3/public/domain-rating-free`. It takes up to 1,000 targets, consumes no API units, and needs any APIv3 key, including a free account's. Its licence allows display in our product when "Domain Rating by Ahrefs" with a link to `https://ahrefs.com/` sits next to the values, and it forbids bulk harvesting to build a competing dataset. See `docs/references/data-licensing.md`.
- 2026-10-06 (Claude): Fetch on demand, only for visible rows; never enrich the whole inventory. This respects the licence's anti-harvesting clause and matches how SpamZilla behaves. The consequence is that DR cannot be filtered or sorted across the whole inventory, so the DR filter stays disabled.
- 2026-10-06 (Claude): Page rendering stays D1-only (an architectural invariant). A small client component posts the visible domains that lack DR to a dedicated route. That route is the only request path that calls Ahrefs. It accepts at most 50 domains, and only domains with an active listing, so it cannot be used as a free public DR proxy. After a successful store, the client calls `router.refresh()` and the server re-renders from D1.
- 2026-10-06 (Claude): A stored DR is write-once, as the architecture already specifies for enrichment. "Not found" results are stored too, so they are not requested again. Failed requests store nothing and are retried on a later view.
- 2026-10-06 (Claude): The app worker reads `AHREFS_API_KEY` from its Cloudflare env: `.dev.vars` locally (never bundled by OpenNext) and `wrangler secret put` remotely. Without a key the route returns a fixed error and the column keeps showing "not collected".

## Outcomes & Retrospective

Not started.

## Context and Orientation

- `src/server/db/schema.ts` has `domains` (`name` primary key), `auction_listings` (with `domain_name` referencing `domains`), and `ingestion_runs`.
- `src/server/queries/domain-listings-query.ts` builds the table read. `src/components/domain-results-table.tsx` renders the Ahrefs DR column as "not collected", and `src/components/domain-filters.tsx` renders a disabled "Metrics" group.
- `src/server/db/client.ts` gets D1 from `getCloudflareContext()`. The same context provides worker env vars and secrets.
- The real-D1 proof is `src/server/ingestion/integration-worker.ts`, run by `corepack pnpm test:integration`. Browser acceptance is `corepack pnpm test:e2e`, against `wrangler.e2e.jsonc` with seeded fixtures and no provider credentials.

## Plan of Work

**Milestone 1.**
- Add `domain_metrics(domain_name, metric, status, value, fetched_at)`, with primary key `(domain_name, metric)` and a foreign key to `domains`. `metric` is `'ahrefs_dr'` for now, and `status` is `'ok' | 'not_found'`.
- Add `src/server/enrichment/ahrefs.ts`, which exports `fetchDomainRatings({ apiKey, domains, fetchImpl })`.
- The client validates the response with Zod, applies a timeout and a size bound, maps errors to fixed `ahrefs_*` codes, and never logs the key.

**Milestone 2.**
- Add `src/server/enrichment/domain-rating.ts` with `enrichDomainRatings(db, fetchRatings, domains)`. It deduplicates, keeps only domains that have an active listing, skips domains already stored, fetches the rest in one call, and inserts with `ON CONFLICT DO NOTHING`.
- Add `src/app/api/enrichment/domain-rating/route.ts`. It validates `{ domains: string[] }` (1 to 50 normalized names) and returns `{ stored }`.

**Milestone 3.**
- The row query left-joins `domain_metrics` for DR.
- The DR column shows the value, and the header carries "Domain Rating by Ahrefs" linked to `https://ahrefs.com/`.
- A client component `EnrichVisibleDomainRatings` receives the visible domains that lack DR, posts them once, and calls `router.refresh()` when `stored > 0`.

## Concrete Steps

From the repository root:

    corepack pnpm db:generate && corepack pnpm db:check
    corepack pnpm check:quick
    corepack pnpm test:integration
    corepack pnpm test:e2e

## Validation and Acceptance

- Unit tests cover:
  - Ahrefs response parsing and error mapping;
  - route validation;
  - the client component posting once and refreshing only after a store.
- The integration proof stores DR for active domains only, ignores unknown or inactive ones, never overwrites an existing value, and returns the DR in the table read.
- The e2e run uses no Ahrefs key. Seeded DR values render with the attribution link, and missing ones show "not collected".
- One live lookup is run on port 30001 with the owner's key, after explicit authorization: a page of results gains DR values, and a reload issues no Ahrefs call.

## Idempotence and Recovery

The migration only adds a table. Enrichment inserts are `ON CONFLICT DO NOTHING`, so repeated or concurrent requests are harmless. Deleting rows from `domain_metrics` forces a fetch on the next view.

## Artifacts and Notes

None yet.

## Interfaces and Dependencies

No new packages.

    fetchDomainRatings({ apiKey, domains, fetchImpl? }): Promise<Map<string, number | null>>
    enrichDomainRatings(db, fetchRatings, domains): Promise<{ stored: number }>
    POST /api/enrichment/domain-rating  { domains: string[] } -> { stored: number }

Revision note (2026-10-06, Claude): Initial plan. Updated after implementation with the discoveries and validation evidence. The live lookup remains.
