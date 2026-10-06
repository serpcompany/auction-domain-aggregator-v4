# Data ingestion and persistence

Status: Implemented locally for Dynadot and GoDaddy; future-provider sections are design constraints

Last updated: 2026-10-06

## Purpose

This document defines the current external-data write path and its persistence rules. It expands the stable boundaries in `ARCHITECTURE.md`; it is not a deployment claim or a database migration.

## Read path

The Next.js application queries local D1 for table contents, filtering, sorting, pagination, source options, and latest successful sync time. A normal page or health request does not call Dynadot, Ahrefs, Majestic, or another external provider.

`src/server/queries/domain-listings.ts` is the implemented table read model. User input is normalized or selected from allowlists before Drizzle constructs parameterized queries. Only active listings and the fields needed by the table are selected.

## Implemented Dynadot synchronization

Dynadot is synchronized manually with `pnpm sync dynadot` (alias `pnpm sync:dynadot`). There is no Cloudflare Cron Trigger, public ingestion route, remote D1 database, or deployed worker in the current repository state.

The command first applies local migrations with remote bindings disabled. `scripts/sync-provider.ts dynadot` then starts a short-lived Wrangler worker bound to `127.0.0.1` and calls `POST /sync/dynadot`. That worker builds the Dynadot adapter from `src/server/providers/registry.ts`, which uses `src/server/providers/dynadot/index.ts` to request `get_open_auctions`, validates unknown provider JSON at runtime, normalizes it, and passes only application listings to the ingestion service.

The provider adapter requests up to 1,000 expired-auction records per page and accepts at most 1,000 pages. It enforces a 30-second request timeout, a 10 MiB response limit, a maximum response cardinality equal to the requested page size, bounded provider strings, normalized domain syntax, nonnegative counters, safe integer money in cents, and valid timestamps. Errors crossing the boundary are fixed codes and never contain the API key or request URL.

One workerd request could not reliably contain the observed complete inventory. The runner therefore processes at most 20 provider pages per loopback request. It has a 30-second worker-readiness timeout and a 120-second segment timeout. The HTTP client sends only an optional run ID; `next_page`, the run start timestamp, and all counters are reloaded from D1 and remain server-owned.

For a synchronization:

1. Atomically mark any abandoned Dynadot run interrupted and create a new running row.
2. Fetch and validate pages sequentially.
3. Upsert normalized domains and provider listings in bounded D1 batches.
4. Persist page position and counts after every completed segment.
5. Continue until the provider returns fewer than 1,000 rows.
6. Apply the reconciliation guard (below), then in one D1 batch guarded by the same still-running run, record the inactivation count, mark older unseen Dynadot listings inactive, and mark the run successful.

A stale or completed run ID is rejected. Every listing write, progress update, failure transition, and success reconciliation is guarded by run ID, provider, running status, and start timestamp. A failed or partial synchronization leaves prior active data readable and does not reconcile omissions.

## Implemented GoDaddy synchronization

GoDaddy is synchronized manually with `pnpm sync godaddy`. It needs no credentials: the source is the public, daily `all_biddable_auctions.json.zip` from `https://inventory.auctions.godaddy.com/` (index at `/metadata.json`), about 37 MB zipped and 450 MB unzipped, shaped as `{ "meta": {...}, "data": [ ...listings ] }`. GoDaddy licenses this content for internal use only (`docs/references/data-licensing.md`), so it is for the owner's own use.

The file is too large for one workerd request and has no paging, so the registry declares it as a file feed and the Node runner stages it before starting the worker (`src/server/ingestion/file-feed.ts`):

1. Download the archive into the run's mode-0700 temporary directory, failing above 512 MiB or after 10 minutes.
2. Stream the archive entry through the system `unzip -p` into `stream-json`, which emits one element of the top-level `data` array at a time; the document is never held in memory. Unzipped output above 4 GiB fails the run.
3. Write elements into `page-N.json` files of 1,000 raw records as `{ page, isLastPage, records }`. A full page is held back until the next record arrives, so the last page is always marked even when the record count is a multiple of 1,000. An empty feed fails with `feed_empty`.
4. Delete the archive, serve the pages read-only (`GET /page-N.json`) on an ephemeral `127.0.0.1` port, and pass that base URL to the worker as `GODADDY_FEED_PAGES_URL` in the mode-0600 env file.

The worker's GoDaddy adapter (`src/server/providers/godaddy/index.ts`) accepts the page URL only when it is `http://127.0.0.1:<port>/`. It fetches each page with a 30-second timeout and 10 MiB limit, requires the envelope's page number to match, and validates each record separately with the same 10% page rejection threshold as Dynadot. The run then uses the unchanged sync service, storage, segmenting, and reconciliation guard. Staging failures print fixed codes (`feed_download_failed`, `feed_too_large`, `feed_extract_failed`, `feed_parse_error`, `feed_empty`); adapter failures use `godaddy_*` codes, and a worker without the page URL answers `godaddy_missing_feed`.

Record mapping:

| Feed field | Stored as |
| --- | --- |
| numeric suffix of `link` path | `external_id` |
| `link` (must be `https://www.godaddy.com/domain-auctions/...`) | `auction_url`, unchanged |
| `domainName` | lowercase, punycode `domain_name` |
| `auctionType` `Bid` / `BuyNow` | `AUCTION` / `BUY_NOW` |
| `price`, `valuation` (`"$1,234"`) | `current_bid_cents`, `appraisal_cents` |
| `numberOfBids` (required for `Bid`, 0 for `BuyNow` when absent) | `bid_count` |
| `auctionEndTime` (ISO UTC) | `ends_at` |
| `domainAge`, `pageviews` | `age_years`, `visitors` |
| not published | `bidder_count`, `starts_at`, `inbound_links`, `renewal_price_cents` are null |
| `majesticTf`, `majesticCf`, `majesticBacklinks`, `majesticReferringDomains`, `semrushAs`, `semrushReferringDomains`, `semrushBacklinks` | one `domain_seo_metrics` row |

## Feed-published SEO metrics

`domain_seo_metrics` has one row per domain with typed integer columns (`majestic_tf`, `majestic_cf`, `majestic_backlinks`, `majestic_ref_domains`, `semrush_as`, `semrush_ref_domains`, `semrush_backlinks`), the publishing `source`, and `updated_at` (the run start). TF, CF, and AS are checked to 0 to 100, counts to be nonnegative, and the four filtered columns are indexed. Each page's metrics are upserted in the same guarded D1 batch as its listings, in JSON batches of 100, so a stale run cannot write them. Unlike write-once Ahrefs DR in `domain_metrics`, every sync that carries metrics replaces them (latest wins). A listing without metrics, such as any Dynadot listing, leaves the stored row alone. Rows are not deleted when a domain leaves the feed; they keep their last values and `updated_at`.

## Verified local evidence

GoDaddy evidence (2026-10-06, the 2026-10-05 feed build, fresh local D1 in a worktree, owner's Mac): `corepack pnpm sync godaddy` succeeded in 233 seconds wall time, including migrations, download, about 2 minutes of staging, and 587 worker pages. It fetched and upserted 586,958 records with 0 rejected and 0 inactivated. Local D1 then held 586,958 active GoDaddy listings, all with null bidder counts and type `AUCTION`, and 586,958 `domain_seo_metrics` rows. Peak resident memory was about 294 MiB for the Node runner and about 376 MiB for the worker's workerd processes; the temporary directory was removed. A selective metric filter (`semrush_as >= 20`, 144 listings) counted in about 130 ms; a filter matching every metrics row (`majestic_cf >= 0`, 529,860 open listings) took about 2 seconds, because the subquery then returns the whole inventory.

The initial live synchronization completed in 427 pages with 426,328 fetched/upserted records and no inactivations. A second complete pre-hardening synchronization completed in 427 pages with 426,398 fetched/upserted records and 2 inactivations. The resulting local database contained 426,400 domains and listings: 426,398 active and 2 inactive, with no duplicate domain identities, duplicate provider/external-ID identities, running ingestion rows, or foreign-key violations.

No live provider resynchronization was performed after continuation, timeout, environment-isolation, and signal-cleanup hardening. Those changes are covered by invented fixtures and local, provider-free tests; the preceding counts are evidence from the last live run, not a claim that the hardened runner has called Dynadot.

Implementation uncovered three important runtime constraints:

- Wrangler `getPlatformProxy()` hung under the available Node 25 runtime, so the manual command uses a loopback-only local worker instead.
- A monolithic workerd request exceeded its practical request-duration window, so ingestion is segmented and resumed from D1 state.
- D1 rejected the initial multi-value statements above 100 bound parameters. The current guarded implementation binds each bounded batch as JSON, using batches of 100 domains and 25 listings while retaining exact running-run predicates and one atomic D1 batch per fetched page.

## Credentials and local process isolation

The package command loads `.secrets/providers.env`, when it exists, only into the Node orchestrator; GoDaddy needs no secrets, and Dynadot fails with `dynadot_missing_credentials` without it. Credentials are never kept in `.env*` files, because OpenNext inlines those into the Worker bundle at build time. The child Wrangler process receives an explicit allowlist of ordinary process variables, not the parent's entire environment. The Dynadot key is supplied only through a mode-0600 temporary env file outside the repository. Normal exit, `SIGINT`, and `SIGTERM` terminate the child process group and remove that directory.

The command prints only its fixed success summary or a fixed error code. Provider response bodies, URLs containing query credentials, authorization material, and credential values must never be logged, committed, or copied into tests or documentation.

## Listing identity and lifecycle

`domains.name` is normalized domain identity. `auction_listings` uses `(provider, external_id)` as its composite primary key and references the domain. Reprocessing the same listing updates mutable auction fields, sets it active, and records the current run start as `last_seen_at` without duplicating either identity.

A listing becomes inactive only when a successful full reconciliation confirms that its `last_seen_at` predates the completed run. It is not deleted. Failure, interruption, a page cap, malformed provider data, and stale continuation cannot trigger reconciliation.

The final page is the first page whose raw auction count is below the page size, counted before validation so a skipped record cannot end a run early. Individual auctions that fail validation are skipped and counted in `records_rejected`; a page where more than 10% of auctions are invalid fails as a response-format change. Internationalized domain names are stored in punycode.

Unseen listings whose auction has already ended are normal churn. Unseen listings whose auction was still scheduled to run usually mean the provider returned a short or empty page partway through the inventory, so finalization fails with `dynadot_reconciliation_guard` and leaves every listing untouched when more than `max(500, 10% of fetched records)` would be removed. An auction wrongly inactivated below that threshold returns to active on the next run that sees it.

## Ingestion run state

`ingestion_runs` records provider, status, start/completion timestamps, fetched pages, server-owned `next_page`, fetched/upserted/inactivated/rejected counts, a fixed error code, and the failing page. Failed runs keep the specific provider code (for example `dynadot_http_error` or `dynadot_response_error`) rather than a generic failure, and the sync command prints it. Migration `0001_smooth_alex_wilder.sql` adds `next_page`, and `0002_sticky_lily_hollister.sql` adds `records_rejected` and `failed_page`, both preserving existing local rows.

The run start timestamp also identifies every listing seen in that run. Final reconciliation and run completion are atomic from the application's perspective: if completion cannot update the guarded running row, its batched listing inactivation is rolled back.

## Future domain enrichment

Ahrefs Domain Rating and Majestic Topic are domain-level data but are not ingested or stored yet. When implemented, a successful metric result is permanent for that domain and provider; it has no refresh deadline and must not be selected by scheduled refresh work. Failed or unavailable attempts may be retried under a separately accepted design.

The future schema must enforce domain/metric-provider identity. A later listing for the same domain reuses successful stored enrichment. Until then, the UI shows em dashes rather than invented values.

## Future providers and scheduling

Additional auction adapters implement `ProviderAdapter` (`src/server/providers/types.ts`) and register their secret names and factory in `src/server/providers/registry.ts`; the sync service, D1 storage, worker, and runner need no changes. Adapters page by number and decide `isLastPage` from raw counts. They must preserve the same boundary: runtime validation, normalized outputs, stable provider listing identity, bounded requests/writes, idempotent upserts, persisted run state, and success-only reconciliation. A provider-specific deterministic identity must be documented before ingesting any provider without a stable listing ID.

Scheduling, Queues, and remote execution require separate implementation and verification. They must not change the D1-only user request path. Queues are justified only when fan-out, retry timing, rate limits, or execution duration require them.

## Recovery and routine verification

The sync is restartable. A later complete run repairs mutable fields and performs reconciliation, so a provider or parser failure does not require clearing local D1. An already-applied migration is a no-op. Routine checks and browser tests apply migrations to local D1 but never load provider secrets or call Dynadot.
