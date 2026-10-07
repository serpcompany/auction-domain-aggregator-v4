# Data ingestion and persistence

Status: Implemented for Dynadot, GoDaddy, Namecheap, and NameSilo, verified locally (Wrangler), and deployed to Staging and Production ([Deployment](deployment.md))

Last updated: 2026-10-07

## Purpose

This document defines the provider-neutral write path: the ingestion Worker and Workflow, how a run synchronizes and reconciles listings, and what D1 records about it. It expands the stable boundaries in `ARCHITECTURE.md`. The read side is in [Domain discovery](domain-discovery.md): a normal page or health request reads only D1 and never calls a provider.

Related leaves:

- [Dynadot](dynadot-sync.md), [GoDaddy](godaddy-sync.md), [Namecheap](namecheap-sync.md), and [NameSilo](namesilo-sync.md) synchronization: each provider's source, adapter, record mapping, error codes, and evidence.
- [Provider rate limits](provider-rate-limits.md): what each provider allows and what the sync enforces.
- [Local sync runs](local-sync-runs.md): `corepack pnpm sync <provider>` and its credential handling.
- [Deployment](deployment.md): the deployed Workers, their resources, and the CI deploy.

## Ingestion Worker and Workflow

Ingestion runs in its own Worker, configured by `apps/web/wrangler.ingestion.jsonc` with entry `apps/web/src/server/ingestion/sync-worker.ts`. It has no `fetch` handler, so it serves no HTTP routes. Its bindings are `DB` (D1), `FEED_PAGES` (R2), and `PROVIDER_SYNC` (the `provider-sync` Workflow, class `ProviderSyncWorkflow`); the Dynadot and NameSilo keys are Worker secrets.

A daily Cron Trigger (`30 15 * * *`, after GoDaddy publishes its file around 14:30 UTC) calls `scheduled()`, which creates one `provider-sync` instance per implemented provider with ID `<provider>-<yyyymmdd>T<hhmm>` from the scheduled time, so a repeated delivery of the same firing cannot start a second instance. Instances run independently; one provider's failure does not affect another's.

`sync-worker.ts` only adapts the runtime: `ProviderSyncWorkflow.run` passes its step object, bindings, and `NonRetryableError` to `runProviderSync` in `apps/web/src/server/ingestion/provider-sync-workflow.ts`, which holds the steps and is unit-tested directly:

1. Before any step, an unknown provider or missing credentials ends the instance with `sync_unknown_provider` or `<provider>_missing_credentials`.
2. `start run`: `startSyncRun` marks any running run of the provider interrupted and creates a new running row, returning its ID. A D1 error is retried as `sync_failed`. It comes first so the Sync status page shows a file feed while it downloads.
3. `stage feed` (file feeds only; see [GoDaddy](godaddy-sync.md#staging) and [Namecheap](namecheap-sync.md#staging)): download and split the feed into R2 pages, writing up to six pages at once. Retried twice for `feed_download_failed`, `feed_extract_failed` (a truncated or corrupt download), and `feed_page_write_failed`; re-staging rewrites the same page keys. Other feed errors describe the feed itself and are not retried. When staging fails for good, a `record failed run` step marks the run failed with the feed's code. Each attempt logs `feed_staged` or `feed_stage_failed` to Workers Logs with its duration in seconds, the pages written, and the average wait per page write, which tells a slow download from slow R2 writes.
4. `sync pages, segment N`: one `runSyncSegment` call of up to 20 provider pages for that run ID, returning only `{ done, runId }` or the final summary. Continuation state (`next_page`, counters, run start) stays server-owned in D1, so a segment that runs again, after an interruption or a retry, resumes from the last committed page.
   - A **transient** failure leaves the run running and is retried. Transient means a provider error marked transient (`dynadot_network_error`, `dynadot_rate_limited`, `dynadot_http_error` for 429 and 5xx, `dynadot_api_error` after page 1, `namesilo_network_error`, `namesilo_http_error` for 429 and 5xx, `namesilo_api_error` after the first request, `godaddy_page_read_error`, `namecheap_page_read_error`), or an unexpected error raised by D1 storage (a batch failing during an upsert, a progress update, or finalization), which `runSyncSegment` wraps as a storage failure. Any other unexpected error, such as a bug in an adapter, fails the run at once as `sync_failed` with its page, because a retry would only repeat it. A page's counters are added only once its upsert has succeeded. When a page fails after earlier pages of the segment were stored, their progress is committed (`updateRunProgress`) before the error is thrown, so the retry resumes at the failing page and does not fetch the earlier ones again. A failure while finishing the segment (the final progress update or finalization) commits nothing, and the retry fetches and re-upserts the segment's pages, which is idempotent. Either way the counters stay exact. Retries wait 1, 2, then 4 minutes, since Dynadot's rate limit asks for a minute.
   - When the provider said how long to wait (a `Retry-After` header on a 429 or 503, in seconds or as an HTTP date, or Dynadot's "try again in N minutes"), the error carries the delay. The step then returns it instead of throwing, the Workflow sleeps (`step.sleep`, step `wait before segment N, retry K`) for the longer of that delay and the step's own 1, 2, or 4 minute backoff, and runs the segment again as `sync pages, segment N, retry K`. A segment gets as many waits as the step has retries. After that, or when a provider asks for more than an hour, the run is recorded failed as below. An unparseable `Retry-After` falls back to the ordinary retries.
   - When the retries or waits run out, a `record failed run` step marks the run failed with that code (`failSyncRun`), using the last committed counters and no failing page. If that step fails too, the next sync interrupts the run.
   - Any other sync error has already marked the run failed with its code (or the run is no longer running, `sync_stale_continuation`), so it is thrown as non-retryable: the reconciliation guard, the page limit, validation and format errors.
   - An error loading the run before a page is read is retried as `sync_failed`.
5. `delete staged pages` (file feeds only): runs after success and after failure. A cleanup failure fails an otherwise successful instance with its code; after a sync failure the sync's code is kept. In production an R2 lifecycle rule also expires staged pages after 2 days.

Workflows runs a step again after a retryable error, or when the platform interrupts it before its result is persisted. Every step above is safe to run again. One known gap: if the final segment's finalization commits and the step is then interrupted, its re-run finds the run already succeeded and the instance fails with `sync_stale_continuation`. D1 still holds the successful run, which is what the app reads.

The instance output is the sync summary. A failed instance's error message is a fixed code (for example `sync_reconciliation_guard`, `feed_download_failed`, `godaddy_response_error`); anything else is reported as `sync_failed`. Workflows retains instance state and step history (30 days on Workers Paid).

The ingestion Worker's per-invocation CPU limit applies to each step separately; `limits.cpu_ms` is 60,000. Local workerd does not enforce it.

## Synchronization run

Each run, whatever the provider:

1. Atomically marks any abandoned run of the same provider interrupted and creates a new running row.
2. Fetches and validates pages sequentially.
3. Upserts normalized domains and provider listings in bounded D1 batches.
4. Persists page position and counts after every completed segment.
5. Continues until the adapter reports the last page.
6. Applies the reconciliation guard (below), then in one D1 batch guarded by the same still-running run, marks older unseen listings of that provider inactive and marks the run successful with that count (`changes()`); the same batch then rebuilds `listing_facets` ([Domain discovery](domain-discovery.md#facets)). D1 resets a request that runs too long, so the unseen-listing comparison runs once in the batch: on Staging's 1.1-million-listing Namecheap inventory each pass takes 12 to 18 seconds, and a second pass that only counted made Namecheap's finalization fail on 2026-10-07. A storage failure logs `sync_storage_failed` with D1's message to Workers Logs.

A stale or completed run ID is rejected. Every listing write, progress update, failure transition, and success reconciliation is guarded by run ID, provider, running status, and start timestamp. A failed or partial synchronization leaves prior active data readable and does not reconcile omissions. Because a new run interrupts an older running one, two overlapping instances of the same provider leave only the newer run able to finish; the older one fails with `sync_stale_continuation`.

Storage is bound to one provider (`apps/web/src/server/ingestion/d1-storage.ts`), so a provider's run never reconciles or interrupts another provider's listings or runs; only the facet rebuild reads every provider's active listings.

Implementation uncovered these runtime constraints:

- A monolithic workerd request exceeded its practical request-duration window, so ingestion is segmented and resumed from D1 state; Workflow steps now carry the segments.
- D1 rejected the initial multi-value statements above 100 bound parameters. The guarded implementation binds each bounded batch as JSON, using batches of 100 domains and 25 listings while retaining exact running-run predicates and one atomic D1 batch per fetched page.
- workerd's `fetch` sends no `User-Agent`, and its `DecompressionStream` rejects trailing bytes after deflate data ([GoDaddy staging](godaddy-sync.md#staging)).

## Listing identity and lifecycle

`domains.name` is normalized domain identity. `auction_listings` uses `(provider, external_id)` as its composite primary key and references the domain. Reprocessing the same listing writes it only when a mutable auction field differs or it was inactive; it then updates those fields, sets it active, and records the current run start as `last_seen_at`. Feed SEO metrics follow the same rule, so `updated_at` is when a value last changed.

D1 bills every row written, plus a row for each index the write touches. Rewriting every listing on every sync cost 14 rows per GoDaddy listing (8.0 million per sync), so an unchanged listing is not written at all. Instead, each fetched page stores its external IDs as one JSON row in `ingestion_run_seen_pages`, in the same guarded D1 batch as the upserts; inserting nothing there is how a stale continuation is detected. After the change, an unchanged GoDaddy sync wrote no listing rows, and a Dynadot sync two days after the last one wrote 1.6 rows per listing.

A listing becomes inactive only when a successful full reconciliation finds it active and absent from every seen page of the completed run. It is not deleted. Finishing a run, successfully or not, deletes its seen pages, and starting a run deletes any left by that provider's crashed runs. Failure, interruption, a page cap, malformed provider data, and stale continuation cannot trigger reconciliation.

The final page is the first page whose raw auction count is below the page size, counted before validation so a skipped record cannot end a run early. Individual auctions that fail validation are skipped and counted in `records_rejected`. A page where more than 10% of auctions are invalid fails the run with `<provider>_too_many_rejected`, distinct from `<provider>_response_error` (a page whose envelope fails its schema). The failed run's `rejection_reasons` counts that page's rejected records by `<field>: <code>`, for example `{"renewal_price: invalid_decimal": 117}`: the field and code of the first schema issue, or the field whose normalization failed with its fixed code (`invalid_decimal`, `invalid_domain`, and so on; any other message is stored as `invalid`, so no record text is kept). A format change can be diagnosed from that row without running the sync again. Internationalized domain names are stored in punycode.

Unseen listings whose auction has already ended are normal churn. Unseen listings whose auction was still scheduled to run usually mean the provider returned a short or empty page partway through the inventory, so finalization fails with `sync_reconciliation_guard` and leaves every listing untouched when more than `max(500, 10% of fetched records)` would be removed. An auction wrongly inactivated below that threshold returns to active on the next run that sees it.

## Ingestion run state

`ingestion_runs` records provider, status, start/completion timestamps, fetched pages, server-owned `next_page`, fetched/upserted/inactivated/rejected counts, a fixed error code, the failing page, and, for a `*_too_many_rejected` failure, `rejection_reasons`. Failed runs keep the specific provider code (for example `dynadot_http_error` or `dynadot_response_error`) rather than a generic failure, and the sync command prints it. Migration `0001_smooth_alex_wilder.sql` adds `next_page`, and `0002_sticky_lily_hollister.sql` adds `records_rejected` and `failed_page`, and `0009_run_rejection_reasons.sql` adds `rejection_reasons`, all preserving existing local rows.

The run start timestamp also identifies every listing seen in that run. Final reconciliation and run completion are atomic from the application's perspective: if completion cannot update the guarded running row, its batched listing inactivation is rolled back.

## Feed-published SEO metrics

`domain_seo_metrics` has one row per domain with typed integer columns (`majestic_tf`, `majestic_cf`, `majestic_backlinks`, `majestic_ref_domains`, `semrush_as`, `semrush_ref_domains`, `semrush_backlinks`), the publishing `source` (`godaddy` or `namecheap`), and `updated_at` (the start of the run that last changed a value). TF, CF, and AS are checked to 0 to 100, counts to be nonnegative, and the four filtered columns are indexed. Each page's metrics are upserted in the same guarded D1 batch as its listings, in JSON batches of 100, so a stale run cannot write them. Unlike write-once Ahrefs DR in `domain_metrics` ([Ahrefs Domain Rating enrichment](domain-rating-enrichment.md)), every sync that carries metrics replaces them (latest wins). A listing without metrics, such as any Dynadot listing, leaves the stored row alone. Rows are not deleted when a domain leaves the feed; they keep their last values and `updated_at`.

`auction_listings.tld` and `domain_length` are virtual generated columns, so ingestion writes neither of them.

## Future providers

Additional auction adapters implement `ProviderAdapter` (`apps/web/src/server/providers/types.ts`) and register their secret names, rate limit ([Provider rate limits](provider-rate-limits.md)) or file feed, and factory in `apps/web/src/server/providers/registry.ts`; the sync service, D1 storage, and Workflow need no changes, and the Cron Trigger picks the provider up automatically. Adapters page by number and decide `isLastPage` from raw counts. They must preserve the same boundary: runtime validation, normalized outputs, stable provider listing identity, bounded requests/writes, idempotent upserts, persisted run state, and success-only reconciliation. A provider-specific deterministic identity must be documented before ingesting any provider without a stable listing ID. Queues are justified only when fan-out, retry timing, rate limits, or execution duration require them.

## Recovery and routine verification

The sync is restartable. A later complete run repairs mutable fields and performs reconciliation, so a provider or parser failure does not require clearing D1. Every instance stages under its own R2 prefix, so retries and overlapping instances never read each other's pages. An already-applied migration is a no-op. Routine checks and browser tests apply migrations to isolated local D1 and R2 but never load provider secrets or call a provider ([Isolated verification](isolated-verification.md)). Workerd tests run the Workflow on real D1 and R2 with invented feeds.
