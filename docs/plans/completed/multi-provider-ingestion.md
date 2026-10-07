# Multi-provider ingestion

Completed 2026-10-06 (Claude) for #14. This is the outcome summary; the full ExecPlan is in git history (`git show 907d382:docs/plans/completed/multi-provider-ingestion.md`).

## Outcome

The sync service, D1 storage, local worker, and runner had all hard-coded Dynadot. They became provider-neutral, so a new provider needs only an adapter and a registry entry:

- `ProviderAdapter` (`apps/web/src/server/providers/types.ts`), `runSyncSegment` (`sync.ts`, replacing `sync-dynadot.ts`), and `createD1IngestionStorage(db, provider)` (`d1-storage.ts`, replacing `sync-dynadot-d1.ts`).
- A provider registry (`registry.ts`) mapping each provider to its secret names and adapter factory.
- `corepack pnpm sync <provider>`, with `sync:dynadot` kept as an alias, which passes the child only that provider's registered secrets.
- `dynadot_appraisal_cents` renamed to `appraisal_cents` (migration `0003`).

## Key decisions

- **Adapters page by integer index and report `isLastPage` themselves.** Every known provider pages by number, and a file feed can expose its pages the same way. A string cursor column waits until a provider needs one.
- **Sync-level error codes are provider-neutral** (`sync_failed`, `sync_reconciliation_guard`); provider codes keep their prefix (`dynadot_http_error`). Historical `dynadot_sync_*` values already stored in `ingestion_runs` were left as they are.
- **One generic `appraisal_cents` column,** with the provider identifying whose appraisal it is, instead of a side table: GoDaddy also publishes a valuation, and one nullable column keeps filtering and sorting unchanged.
- **Storage is bound to one provider,** so a provider's run never reads, reconciles, or interrupts another provider's listings or runs.
- **Provider secret names are a closed union in the registry.** An env type with an open string index conflicted with the `DB` binding, and the closed union is stricter anyway.

## Discoveries

- drizzle-kit asks interactively whether a column was created or renamed, so migration `0003` and its snapshot were written by hand; `db:generate` afterwards reports no changes.
- SQLite `RENAME COLUMN` rewrites a CHECK expression but keeps the constraint's name; the schema keeps `auction_listings_dynadot_appraisal_cents_nonnegative` to avoid a table rebuild.

## Evidence

171 unit tests at 100 percent coverage; the real-D1 proof showed that storage bound to a second provider rejects foreign listings, leaves the other provider's runs running, and reconciles only its own listings; 4 e2e tests; no `'dynadot'` literal left in `src/server/ingestion/` outside tests.

## Follow-ups at completion

- Freshness was still the global latest successful sync; it should become per provider.
- The loopback runner remained until [Cloud ingestion](cloud-ingestion.md) replaced it with a Workflow.
