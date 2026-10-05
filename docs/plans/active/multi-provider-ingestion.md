# Multi-provider ingestion

## Purpose / Big Picture

Ingestion currently works only for Dynadot: the sync service, D1 storage, local worker, and command-line runner all hard-code it. DropCatch (#17) and then GoDaddy (#16) are next, and the product is becoming a paid SaaS with daily syncs per provider (#15, #27). This plan makes the sync path provider-neutral so a new provider only needs an adapter and a registry entry.

When this is done, `corepack pnpm sync dynadot` behaves exactly like today's `corepack pnpm sync:dynadot`, and a second provider can be added without touching the sync service, D1 storage, worker, or runner. The issue is serpcompany/auction-domain-aggregator-v4#14.

## Progress

- [x] (2026-10-06) Plan written.
- [ ] Milestone 1: provider-neutral adapter interface, sync service, and D1 storage; Dynadot ported.
- [ ] Milestone 2: generic local worker route and `pnpm sync <provider>` runner.
- [ ] Milestone 3: rename `dynadot_appraisal_cents` to `appraisal_cents`.
- [ ] Validation: quick checks, integration proof, e2e, migration on the real local inventory.

## Surprises & Discoveries

None yet.

## Decision Log

- 2026-10-06 (Claude): Adapters page by integer page index and report `isLastPage` themselves. Dynadot and the known DropCatch endpoints page by number. GoDaddy may use bulk feed files, which an adapter can expose as a single page. A string cursor column is not added until a provider needs it.
- 2026-10-06 (Claude): Sync-level error codes become provider-neutral (`sync_failed`, `sync_reconciliation_guard`, and so on). Provider error codes keep their provider prefix (`dynadot_http_error`). Historical `dynadot_sync_*` values already stored in `ingestion_runs` are left as they are.
- 2026-10-06 (Claude): The provider's own appraisal becomes a generic `appraisal_cents` column, with the provider identifying whose appraisal it is, instead of a side table. GoDaddy also publishes a valuation, and one nullable column keeps filtering and sorting unchanged.
- 2026-10-06 (Claude): The loopback runner stays for now and only becomes generic. #15 replaces it with a `scheduled()` handler; rewriting it here would be wasted work.

## Outcomes & Retrospective

Not started.

## Context and Orientation

- `src/server/providers/dynadot/index.ts` fetches one Dynadot `get_open_auctions` page and returns `{ listings, received, rejected }`. `received` counts raw auctions, including invalid ones that were skipped.
- `src/server/ingestion/sync-dynadot.ts` runs bounded segments of pages. It persists continuation state, ends on the first short page, and finalizes reconciliation. Its storage interface is `DynadotIngestionStorage`.
- `src/server/ingestion/sync-dynadot-d1.ts` implements that storage on D1. It hard-codes `'dynadot'` in raw SQL and Drizzle predicates, and it applies the vanished-listings reconciliation guard.
- `src/server/ingestion/local-worker.ts` is a loopback-only Wrangler worker (`wrangler.ingestion.jsonc`) serving `POST /sync-dynadot`. `scripts/sync-dynadot.ts` starts it and drives segments.
- `src/server/ingestion/integration-worker.ts` is the real-D1 proof run by `corepack pnpm test:integration`.
- On the read side, `src/domain/domain-table.ts` and the query layer are already provider-neutral apart from the appraisal column. `DOMAIN_TABLE_AUCTION_SOURCES` already lists `dynadot`, `dropcatch` and `godaddy`.

## Plan of Work

**Milestone 1.** Add `src/server/providers/types.ts` with `AuctionProvider`, `NormalizedListing` (today's `DynadotListing` with `provider: AuctionProvider` and `appraisalCents`), `ProviderPage` (`listings`, `received`, `rejected`, `isLastPage`), `ProviderError` (a fixed, non-secret `code`), and `ProviderAdapter` (`provider`, `fetchPage({ pageIndex })`). Port Dynadot to `createDynadotAdapter({ apiKey, fetchImpl })`, keeping its validation unchanged. Rename `sync-dynadot.ts` to `sync.ts` (`runSyncSegment(adapter, storage, options)`) and `sync-dynadot-d1.ts` to `d1-storage.ts` (`createD1IngestionStorage(db, provider)`), replacing every hard-coded provider with the bound one. Move and adapt the unit tests and the integration proof.

**Milestone 2.** Add `src/server/providers/registry.ts`, which maps each provider to its required secret names and adapter factory. Change the local worker to `POST /sync/<provider>`, building the adapter from the registry and its env. Replace `scripts/sync-dynadot.ts` with `scripts/sync-provider.ts <provider>`, which writes only that provider's secrets into the temporary env file. Package scripts: `sync <provider>`, with `sync:dynadot` kept as an alias.

**Milestone 3.** Rename the column through a Drizzle migration (`ALTER TABLE ... RENAME COLUMN`), and update the query layer, UI labels ("Appraisal", with the source shown per row) and tests.

## Concrete Steps

Run from the repository root:

    corepack pnpm check:quick          # 0 failures, 100% configured coverage
    corepack pnpm test:integration     # prints {"status":"succeeded",...}
    corepack pnpm db:generate && corepack pnpm db:check
    corepack pnpm db:migrate:local     # applies the rename to the local inventory
    corepack pnpm test:e2e             # 4 passed

## Validation and Acceptance

- All checks above pass.
- No `'dynadot'` literal remains in `src/server/ingestion/` outside tests and fixtures.
- The integration proof exercises storage bound to a second provider id and shows that it neither reads, reconciles nor guards the other provider's listings.
- After the migration, the local inventory keeps its appraisal values under `appraisal_cents`.

## Idempotence and Recovery

Migrations are forward-only and safe to rerun through Wrangler's migration table. The renamed column keeps its data. If Milestone 3 must be reverted, add a reverse rename migration rather than editing an applied one.

## Artifacts and Notes

None yet.

## Interfaces and Dependencies

No new packages. Stable interfaces after this plan:

    type ProviderAdapter = {
      provider: AuctionProvider;
      fetchPage(input: { pageIndex: number }): Promise<ProviderPage>;
    };
    runSyncSegment(adapter, storage, { runId?, segmentPages?, maxPages?, clock? })
    createD1IngestionStorage(db, provider): IngestionStorage

Revision note (2026-10-06, Claude): Initial plan.
