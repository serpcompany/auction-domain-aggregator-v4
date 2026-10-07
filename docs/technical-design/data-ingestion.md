# Data ingestion and persistence

Status: Implemented and verified locally (Wrangler) for Dynadot and GoDaddy; not deployed. Future-provider sections are design constraints

Last updated: 2026-10-07

## Purpose

This document defines the current external-data write path and its persistence rules. It expands the stable boundaries in `ARCHITECTURE.md`; it is not a deployment claim or a database migration.

## Read path

The Next.js application queries D1 for table contents, filtering, sorting, pagination, source options, and latest successful sync time. A normal page or health request does not call Dynadot, Ahrefs, Majestic, or another external provider.

`apps/web/src/server/queries/domain-listings.ts` is the implemented table read model. User input is normalized or selected from allowlists before Drizzle constructs parameterized queries. Only active listings and the fields needed by the table are selected. The source, auction-type, and TLD filter options come from `listing_facets`, which the write path rebuilds (below).

## Ingestion Worker and Workflow

Ingestion runs in its own Worker, configured by `apps/web/wrangler.ingestion.jsonc` with entry `apps/web/src/server/ingestion/sync-worker.ts`. It has no `fetch` handler, so it serves no HTTP routes. Its bindings are `DB` (D1), `FEED_PAGES` (R2), and `PROVIDER_SYNC` (the `provider-sync` Workflow, class `ProviderSyncWorkflow`); the Dynadot key is a Worker secret.

A daily Cron Trigger (`30 15 * * *`, after GoDaddy publishes its file around 14:30 UTC) calls `scheduled()`, which creates one `provider-sync` instance per implemented provider with ID `<provider>-<yyyymmdd>T<hhmm>` from the scheduled time, so a repeated delivery of the same firing cannot start a second instance. Instances run independently; one provider's failure does not affect another's.

`sync-worker.ts` only adapts the runtime: `ProviderSyncWorkflow.run` passes its step object, bindings, and `NonRetryableError` to `runProviderSync` in `apps/web/src/server/ingestion/provider-sync-workflow.ts`, which holds the steps and is unit-tested directly:

1. Before any step, an unknown provider or missing credentials ends the instance with `sync_unknown_provider` or `<provider>_missing_credentials`.
2. `stage feed` (file feeds only, described below): download and split the feed into R2 pages. Retried twice for `feed_download_failed`, `feed_extract_failed` (a truncated or corrupt download), and `feed_page_write_failed`; re-staging rewrites the same page keys. Other feed errors describe the feed itself and are not retried.
3. `start run`: `startSyncRun` marks any running run of the provider interrupted and creates a new running row, returning its ID. A D1 error is retried as `sync_failed`.
4. `sync pages, segment N`: one `runSyncSegment` call of up to 20 provider pages for that run ID, returning only `{ done, runId }` or the final summary. Continuation state (`next_page`, counters, run start) stays server-owned in D1, so a segment that runs again, after an interruption or a retry, resumes from the last committed page.
   - A **transient** failure leaves the run running and is retried. Transient means a provider error marked transient (`dynadot_network_error`, `dynadot_rate_limited`, `dynadot_http_error` for 429 and 5xx, `dynadot_api_error` after page 1, `godaddy_page_read_error`, `namecheap_page_read_error`), or any error that is neither a provider error nor a sync error (a D1 batch failing during an upsert, a progress update, or finalization). The retry refetches and re-upserts the segment's pages, which is idempotent, and the counters stay exact because they are committed only at segment boundaries. Retries wait 1, 2, then 4 minutes, since Dynadot's rate limit asks for a minute.
   - When the provider said how long to wait (a `Retry-After` header on a 429 or 503, in seconds or as an HTTP date, or Dynadot's "try again in N minutes"), the error carries the delay. The step then returns it instead of throwing, the Workflow sleeps (`step.sleep`, step `wait before segment N, retry K`) for the longer of that delay and the step's own 1, 2, or 4 minute backoff, and runs the segment again as `sync pages, segment N, retry K`. A segment gets as many waits as the step has retries. After that, or when a provider asks for more than an hour, the run is recorded failed as below. An unparseable `Retry-After` falls back to the ordinary retries.
   - When the retries or waits run out, a `record failed run` step marks the run failed with that code (`failSyncRun`), using the counters of the last committed segment and no failing page. If that step fails too, the next sync interrupts the run.
   - Any other sync error has already marked the run failed with its code (or the run is no longer running, `sync_stale_continuation`), so it is thrown as non-retryable: the reconciliation guard, the page limit, validation and format errors.
   - An error loading the run before a page is read is retried as `sync_failed`.
5. `delete staged pages` (file feeds only): runs after success and after failure. A cleanup failure fails an otherwise successful instance with its code; after a sync failure the sync's code is kept.

Workflows runs a step again after a retryable error, or when the platform interrupts it before its result is persisted. Every step above is safe to run again. One known gap: if the final segment's finalization commits and the step is then interrupted, its re-run finds the run already succeeded and the instance fails with `sync_stale_continuation`. D1 still holds the successful run, which is what the app reads.

The instance output is the sync summary. A failed instance's error message is a fixed code (for example `sync_reconciliation_guard`, `feed_download_failed`, `godaddy_response_error`); anything else is reported as `sync_failed`. Workflows retains instance state and step history (30 days on Workers Paid).

The ingestion Worker's per-invocation CPU limit applies to each step separately; `limits.cpu_ms` is 60,000. Local workerd does not enforce it.

## Provider rate limits

Every provider in `apps/web/src/server/providers/registry.ts` declares its rate limit, and the type rejects a paged-API provider without one:

- A paged API declares `rateLimit: { intervalMs, source }`, the minimum time between the starts of two requests and where that number comes from. The Workflow builds a pacer from it (`createPacer` in `apps/web/src/server/providers/rate-limit.ts`), and the adapter awaits the pacer before every request. The pacer does not delay the first request, spaces later ones at least `intervalMs` apart, and makes concurrent callers take turns.
- A provider without a published limit uses `DEFAULT_RATE_LIMIT`, one request every 2 seconds, until it confirms a real number.
- A file feed declares `rateLimit: 'one download per run'`: the stage step downloads it once, and the adapter reads only the staged pages.

`parseRetryAfter` in the same module reads a `Retry-After` header in either form. The Workflow's handling of a provider's requested wait is described in step 4 above.

| Provider | Access | Published limit | Enforced | Source | Verified |
| --- | --- | --- | --- | --- | --- |
| Dynadot | `get_open_auctions` API | 60 requests a minute for a regular account ("60/min (1/sec)"); bulk 600, super bulk 6,000 | 1 request every 1.1 s | [Dynadot API commands](https://www.dynadot.com/domain/api-commands) | 2026-10-07, a full paced sync with no rate limit |
| GoDaddy | public inventory file | none for the file (the Auctions API, which is not used, allows 60 requests a minute per endpoint) | one download per run | [GoDaddy inventory files](https://www.godaddy.com/help/download-inventory-files-for-godaddy-auctions-41284), [GoDaddy API Terms of Use](https://www.godaddy.com/en/legal/agreements/godaddy-api-terms-of-use) | 2026-10-06 |
| Namecheap | public market sales CSV | none; the Universal Terms of Service forbid "repetitive, high volume requests" | one download per run | [Namecheap Universal ToS](https://www.namecheap.com/legal/universal/universal-tos/) | 2026-10-07 |
| Ahrefs | `domain-rating-free`, on demand from the web app, not a sync | not recorded; Ahrefs may rate-limit or throttle without notice | one call per claimed batch of at most 50 domains, and a cool-down after a 429 honoring `Retry-After` (`docs/technical-design/domain-discovery.md`); not yet on the shared pacer | [Ahrefs free DR endpoint](https://docs.ahrefs.com/en/api/reference/public/post-domain-rating-free) | not verified |
| NameSilo, DropCatch | not implemented | none published | `DEFAULT_RATE_LIMIT` when added | `docs/references/data-licensing.md` | 2026-10-06 |

## Dynadot synchronization

The Dynadot adapter (`apps/web/src/server/providers/dynadot/index.ts`) requests `get_open_auctions`, validates unknown provider JSON at runtime, normalizes it, and passes only application listings to the sync service. It requests up to 1,000 expired-auction records per page and accepts at most 1,000 pages. It enforces a 30-second request timeout, a 10 MiB response limit, a maximum response cardinality equal to the requested page size, bounded provider strings, normalized domain syntax, nonnegative counters, safe integer money in cents, and valid timestamps. Errors crossing the boundary are fixed codes and never contain the API key or request URL.

Dynadot allows a regular account 60 requests a minute. Back-to-back page requests reached about 120 a minute, and on 2026-10-07 three runs in a row failed partway through: Dynadot answered HTTP 200 with `{"Response":{"ResponseCode":"-1","Error":"Too many requests. Please try again in 1 minute after."}}`, which failed validation as `dynadot_response_error`. The adapter now waits for the shared pacer (see Provider rate limits) before every request, so pages are requested at most once every 1.1 seconds and a 433-page sync takes about 8 minutes. With pacing, a full sync on 2026-10-07 fetched 460 pages (459,111 listings) in 8.5 minutes with no rate limit.

Dynadot reports a failed command as HTTP 200 with a `Response` object holding a `ResponseCode` and usually an `Error` message. The adapter does not rely on the exact wording:

- A message that mentions too many requests, a rate limit, throttling, or trying again is the transient `dynadot_rate_limited`, on any page, and its "try again in N seconds, minutes, or hours" becomes the retry delay.
- Any other error answer is `dynadot_api_error`. On page 1 it is permanent: an invalid key or command fails the first request. After page 1 the key and command have already worked, so it is most likely a limit worded differently, and it is retried.

Dynadot writes a missing value as `-`, and since October 2026 some renewal prices as `--`; any run of dashes, an empty string, or a negative number is stored as null. Before this, 117 listings on one page had `--` and failed the page's 10% rejection threshold.

For a synchronization:

1. Atomically mark any abandoned run of the same provider interrupted and create a new running row.
2. Fetch and validate pages sequentially.
3. Upsert normalized domains and provider listings in bounded D1 batches.
4. Persist page position and counts after every completed segment.
5. Continue until the adapter reports the last page (for Dynadot, the first page with fewer than 1,000 rows).
6. Apply the reconciliation guard (below), then in one D1 batch guarded by the same still-running run, record the inactivation count, mark older unseen listings of that provider inactive, and mark the run successful; the same batch then rebuilds `listing_facets` (see Facet read model).

A stale or completed run ID is rejected. Every listing write, progress update, failure transition, and success reconciliation is guarded by run ID, provider, running status, and start timestamp. A failed or partial synchronization leaves prior active data readable and does not reconcile omissions. Because a new run interrupts an older running one, two overlapping instances of the same provider leave only the newer run able to finish; the older one fails with `sync_stale_continuation`.

## GoDaddy synchronization

GoDaddy needs no credentials: the source is the public, daily `all_biddable_auctions.json.zip` from `https://inventory.auctions.godaddy.com/` (index at `/metadata.json`), about 37 MB zipped and 450 MB unzipped, shaped as `{ "meta": {...}, "data": [ ...listings ] }`. GoDaddy licenses this content for internal use only (`docs/references/data-licensing.md`), so it is for the owner's own use.

The registry declares it as a file feed (`url`, archive `entry`, `field: "data"`, `pageSize: 1000`). The `stage feed` step streams it into R2 with only web-platform APIs (`apps/web/src/server/ingestion/feed-stage.ts`), never holding the document in memory:

1. `fetch` the archive with a fixed `User-Agent` (GoDaddy's CDN answers 403 without one) and a 10-minute timeout. A declared or local-header compressed size above 512 MiB fails with `feed_too_large`.
2. Parse the zip local file header of the first entry, which must be named `all_biddable_auctions.json`; accept deflate or stored, and a zip64 compressed size in the local header. When the entry has a data descriptor, its local sizes are placeholders (0, or `0xFFFFFFFF` with a zip64 field of 0 from streaming writers), so hold back the archive's last 256 KiB and read the size from the central directory when the download ends, because workerd's `DecompressionStream` rejects any bytes after the deflate data. Zip64 central directory and end records are not read; an archive that needs them fails with `feed_unsupported_archive`, as do a different entry name, encryption, and other compression methods.
3. Decompress with `DecompressionStream('deflate-raw')`, failing above 4 GiB.
4. Scan the bytes for the elements of the top-level `data` array. The scanner tracks strings, escapes, and bracket depth only and copies each record's raw bytes; it never decodes or parses records.
5. Write `page-N.json` objects of 1,000 raw records as `{ page, isLastPage, records }` under `feed-pages/godaddy/<instance id>/` in `FEED_PAGES`. A full page is held back until the next record arrives, so the last page is always marked even when the record count is a multiple of 1,000. An empty feed fails with `feed_empty`. The registry's file feed carries the adapter's read limits (1,000 pages, 10 MiB per page), and staging enforces them with `feed_too_large`, so a feed the adapter would refuse fails once here instead of in every sync. A single record over 10 MiB fails before it is held whole.

Staging failures use fixed codes: `feed_download_failed` (including a connection that drops mid-archive), `feed_too_large`, `feed_extract_failed`, `feed_unsupported_archive`, `feed_parse_error`, `feed_empty`, `feed_page_write_failed` (an R2 write failure), and `feed_stage_failed` (anything unexpected, not retried).

The GoDaddy adapter (`apps/web/src/server/providers/godaddy/index.ts`) reads pages through a `FeedPageSource` (`apps/web/src/server/ingestion/feed-pages.ts` implements it on R2 for the instance's prefix). It refuses pages above 10 MiB, requires the envelope's page number to match, parses the page with `JSON.parse` (so a record the scanner copied but that is not valid JSON fails the page with `godaddy_parse_error`), and validates each record separately with the same 10% page rejection threshold as Dynadot. Read failures are `godaddy_page_read_error`, a missing page `godaddy_missing_page`. The run then uses the unchanged sync service, storage, segmenting, and reconciliation guard.

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

## Namecheap synchronization

Namecheap needs no credentials either: the source is the public market sales CSV at `https://d3ry1h4w5036x1.cloudfront.net/reports/Namecheap_Market_Sales.csv`, linked from Namecheap Market's auctions page and refreshed hourly. On 2026-10-07 it was 194 MB with 1,104,121 rows: unquoted fields, LF line endings, every sale ID and domain unique, and end times up to about 45 days out. Licensing is in `docs/references/data-licensing.md`.

The registry declares it as a `csv` file feed (`pageSize: 2000`, 1,000 pages, 10 MiB per page). The `stage feed` step (`apps/web/src/server/ingestion/feed-csv.ts`) shares the download step with the zipped feed, then decodes the body with a fatal `TextDecoder` (invalid UTF-8 fails with `feed_parse_error`) and splits RFC 4180 rows as they stream: quoted fields with `""` escapes, LF or CRLF, empty lines skipped. The header row must have unique, non-empty names, and every data row must have the same number of fields. Each row becomes a JSON object of its non-empty fields, as strings, so the page files use the same `{ page, isLastPage, records }` envelope as GoDaddy's. The download is capped at 1 GiB. A quote inside an unquoted field, text after a closing quote, an unterminated quote, or a mismatched row fails with `feed_parse_error`; a row over the page byte limit fails with `feed_too_large` before it is held whole. Staging the real file took 2.7 seconds in Node and produced 553 pages, the largest 870 KB.

The Namecheap adapter (`apps/web/src/server/providers/namecheap/index.ts`) reads pages through the same staged-page reader as GoDaddy's (`apps/web/src/server/providers/staged-feed.ts`), with `namecheap_*` error codes and the same 10% page rejection threshold. All 1,104,121 rows of the real file normalized with none rejected.

Record mapping:

| Feed field | Stored as |
| --- | --- |
| `url` path `/market/sale/<id>/` (must be `https://www.namecheap.com`) | `external_id`, and `auction_url` unchanged |
| `name` | lowercase, punycode `domain_name` |
| not published (every sale is a timed auction) | `auction_type` `AUCTION` |
| `price` (current price), `renewPrice`, `estibotValue` (`"4750.00"`) | `current_bid_cents`, `renewal_price_cents`, `appraisal_cents` |
| `bidCount` | `bid_count` |
| `startDate`, `endDate` (ISO UTC) | `starts_at`, `ends_at` |
| whole years from `registeredDate` to `startDate`, so it does not depend on when the feed is read | `age_years` (null without either date) |
| not published | `bidder_count`, `inbound_links`, `visitors` are null |
| `majesticTrustFlow`, `majesticCitation`, `majesticBacklinks`, `semrushAScore`, `semrushBacklinks` | one `domain_seo_metrics` row (referring domains null) |
| `ahrefsDomainRating`, `ahrefsBacklinks`, `goValue`, rankings, `extensionsTaken`, `keywordSearchCount`, `isPartnerSale`, last sale | not stored |

`ahrefsDomainRating` is left out because stored DR comes from the Ahrefs API under its own attribution licence (`domain_metrics`); mixing in Namecheap's copy needs its own decision.

Namecheap's anti-sniping rule extends an auction to five minutes after a late bid, so `ends_at` can lag the real end until the next sync.

## Feed-published SEO metrics

`domain_seo_metrics` has one row per domain with typed integer columns (`majestic_tf`, `majestic_cf`, `majestic_backlinks`, `majestic_ref_domains`, `semrush_as`, `semrush_ref_domains`, `semrush_backlinks`), the publishing `source` (`godaddy` or `namecheap`), and `updated_at` (the start of the run that last changed a value). TF, CF, and AS are checked to 0 to 100, counts to be nonnegative, and the four filtered columns are indexed. Each page's metrics are upserted in the same guarded D1 batch as its listings, in JSON batches of 100, so a stale run cannot write them. Unlike write-once Ahrefs DR in `domain_metrics`, every sync that carries metrics replaces them (latest wins). A listing without metrics, such as any Dynadot listing, leaves the stored row alone. Rows are not deleted when a domain leaves the feed; they keep their last values and `updated_at`.

## Facet read model

`listing_facets` holds the source, auction-type, and TLD values of the active inventory, across every provider, each with the latest `ends_at` among its active listings. The successful-finalization batch ends with the two statements from `apps/web/src/server/db/listing-facets.ts`: delete every row, then insert the grouped values. The rebuild reads the whole table rather than one provider's rows, so it is correct whichever provider finishes last, and it is idempotent; it does not need the running-run guard. A failed or still-running run does not rebuild it, so values that only its upserted listings carry are offered after the next successful run. The rebuild took 1.7 to 3.3 seconds against the 1.02-million-active-listing local inventory, once per successful run. Migration `0006_listing_tld_length_facets.sql` backfilled it once.

`auction_listings.tld` and `domain_length` are virtual generated columns, so ingestion writes neither of them.

## Local runs

`corepack pnpm sync <provider>` (alias `pnpm sync:dynadot`) applies local migrations, then `apps/web/scripts/sync-provider.ts` starts a temporary `wrangler dev` of the ingestion Worker on `127.0.0.1:8790` (inspector `9330`) with local D1, R2, and Workflows, creates a `provider-sync` instance named `<provider>-manual-<ms>` through Wrangler's local-only explorer API (`/cdn-cgi/explorer/api/workflows/...`), polls it every 2 seconds for up to 30 minutes, and prints the summary or the instance's fixed error code. It drives the same Workflow code as the Cron Trigger. `curl "http://127.0.0.1:8790/cdn-cgi/handler/scheduled"` against a running local session fires the Cron Trigger path.

The runner loads `.secrets/providers.env`, when it exists, only into the Node process; GoDaddy needs no secrets, and Dynadot fails with `dynadot_missing_credentials` without it. Credentials are never kept in `.env*` files, because OpenNext inlines those into the Worker bundle at build time. The child Wrangler process receives an explicit allowlist of ordinary process variables, not the parent's entire environment, and only that provider's registered secrets through a mode-0600 temporary env file outside the repository. Normal exit, `SIGINT`, and `SIGTERM` terminate the child process group and remove that directory.

`wrangler dev` reloads the Worker when an imported source file changes. A reload while an instance is running orphans it locally (it stays `running` and is not resumed), so do not edit `apps/web/src/` during a local sync; the runner then times out with `sync_runner_timeout`, and the next run interrupts the orphaned run. Staged pages of an orphaned instance stay in the local bucket under its prefix.

## Verified local evidence

Cloud ingestion evidence (2026-10-06, the 2026-10-05 GoDaddy feed build, owner's Mac, Wrangler 4.110.0): see `docs/plans/completed/cloud-ingestion.md` for the staging proof of concept, the real `pnpm sync godaddy` Workflow run, and the cron-triggered run. Staging the archive into R2 took about 8.5 seconds in its own step; a full first sync of 586,958 records took about 2.5 minutes, with 0 rejected, and the cleanup step deleted all 587 pages.

Earlier GoDaddy evidence (2026-10-06, before the Workflow, with the Node loopback runner): `corepack pnpm sync godaddy` succeeded in 233 seconds wall time and upserted 586,958 records with 0 rejected and 0 inactivated. A selective metric filter (`semrush_as >= 20`, 144 listings) counted in about 130 ms; a filter matching every metrics row (`majestic_cf >= 0`, 529,860 open listings) took about 2 seconds, because the subquery then returns the whole inventory.

Dynadot evidence predates the Workflow. The initial live synchronization completed in 427 pages with 426,328 fetched/upserted records and no inactivations; a second complete synchronization completed in 427 pages with 426,398 records and 2 inactivations. The Dynadot path through the Workflow is covered by provider-free tests only; no live Dynadot call was made for this change.

Implementation uncovered these runtime constraints:

- A monolithic workerd request exceeded its practical request-duration window, so ingestion is segmented and resumed from D1 state; Workflow steps now carry the segments.
- D1 rejected the initial multi-value statements above 100 bound parameters. The guarded implementation binds each bounded batch as JSON, using batches of 100 domains and 25 listings while retaining exact running-run predicates and one atomic D1 batch per fetched page.
- workerd's `fetch` sends no `User-Agent`, and its `DecompressionStream` rejects trailing bytes after deflate data (see the GoDaddy steps above).

## Listing identity and lifecycle

`domains.name` is normalized domain identity. `auction_listings` uses `(provider, external_id)` as its composite primary key and references the domain. Reprocessing the same listing writes it only when a mutable auction field differs or it was inactive; it then updates those fields, sets it active, and records the current run start as `last_seen_at`. Feed SEO metrics follow the same rule, so `updated_at` is when a value last changed.

D1 bills every row written, plus a row for each index the write touches. Rewriting every listing on every sync cost 14 rows per GoDaddy listing (8.0 million per sync), so an unchanged listing is not written at all. Instead, each fetched page stores its external IDs as one JSON row in `ingestion_run_seen_pages`, in the same guarded D1 batch as the upserts; inserting nothing there is how a stale continuation is detected. After the change, an unchanged GoDaddy sync wrote no listing rows, and a Dynadot sync two days after the last one wrote 1.6 rows per listing.

A listing becomes inactive only when a successful full reconciliation finds it active and absent from every seen page of the completed run. It is not deleted. Finishing a run, successfully or not, deletes its seen pages, and starting a run deletes any left by that provider's crashed runs. Failure, interruption, a page cap, malformed provider data, and stale continuation cannot trigger reconciliation.

The final page is the first page whose raw auction count is below the page size, counted before validation so a skipped record cannot end a run early. Individual auctions that fail validation are skipped and counted in `records_rejected`; a page where more than 10% of auctions are invalid fails as a response-format change. Internationalized domain names are stored in punycode.

Unseen listings whose auction has already ended are normal churn. Unseen listings whose auction was still scheduled to run usually mean the provider returned a short or empty page partway through the inventory, so finalization fails with `dynadot_reconciliation_guard` and leaves every listing untouched when more than `max(500, 10% of fetched records)` would be removed. An auction wrongly inactivated below that threshold returns to active on the next run that sees it.

## Ingestion run state

`ingestion_runs` records provider, status, start/completion timestamps, fetched pages, server-owned `next_page`, fetched/upserted/inactivated/rejected counts, a fixed error code, and the failing page. Failed runs keep the specific provider code (for example `dynadot_http_error` or `dynadot_response_error`) rather than a generic failure, and the sync command prints it. Migration `0001_smooth_alex_wilder.sql` adds `next_page`, and `0002_sticky_lily_hollister.sql` adds `records_rejected` and `failed_page`, both preserving existing local rows.

The run start timestamp also identifies every listing seen in that run. Final reconciliation and run completion are atomic from the application's perspective: if completion cannot update the guarded running row, its batched listing inactivation is rolled back.

## Future domain enrichment

Ahrefs Domain Rating and Majestic Topic are domain-level data but are not ingested or stored yet. When implemented, a successful metric result is permanent for that domain and provider; it has no refresh deadline and must not be selected by scheduled refresh work. Failed or unavailable attempts may be retried under a separately accepted design.

The future schema must enforce domain/metric-provider identity. A later listing for the same domain reuses successful stored enrichment. Until then, the UI shows em dashes rather than invented values.

## Future providers

Additional auction adapters implement `ProviderAdapter` (`apps/web/src/server/providers/types.ts`) and register their secret names, rate limit (see Provider rate limits) or file feed, and factory in `apps/web/src/server/providers/registry.ts`; the sync service, D1 storage, and Workflow need no changes, and the Cron Trigger picks the provider up automatically. Adapters page by number and decide `isLastPage` from raw counts. They must preserve the same boundary: runtime validation, normalized outputs, stable provider listing identity, bounded requests/writes, idempotent upserts, persisted run state, and success-only reconciliation. A provider-specific deterministic identity must be documented before ingesting any provider without a stable listing ID. Queues are justified only when fan-out, retry timing, rate limits, or execution duration require them.

## Deploying (not done; needs owner authorization)

Nothing remote exists. Per `serp` environment configuration, the top level of `apps/web/wrangler.ingestion.jsonc` stays local-only; a deploy adds a named environment (for example `env.production`) and always passes `--env`. It needs:

- D1: the production database's real `database_name` and `database_id` for binding `DB` (shared with the web application's environment), with migrations applied by `wrangler d1 migrations apply DB --remote --env <env>` before the Worker deploys.
- R2: a bucket for binding `FEED_PAGES` (for example `auction-domain-aggregator-feed-pages-<env>`), ideally with a lifecycle rule expiring objects under `feed-pages/` after a day or two, so pages left by a failed cleanup step cannot accumulate.
- Workflow: binding `PROVIDER_SYNC`, `name` `provider-sync`, `class_name` `ProviderSyncWorkflow` (created on deploy, not a separate resource).
- Cron Trigger: `triggers.crons` (`30 15 * * *`) in that environment.
- Secret: `DYNADOT_API_PRODUCTION_KEY` via `wrangler secret put --env <env>`.
- Workers Paid, for `limits.cpu_ms` above 30,000 and the Workflow step limits used here.
- A Worker `name` per environment.

## Recovery and routine verification

The sync is restartable. A later complete run repairs mutable fields and performs reconciliation, so a provider or parser failure does not require clearing D1. Every instance stages under its own R2 prefix, so retries and overlapping instances never read each other's pages. An already-applied migration is a no-op. Routine checks and browser tests apply migrations to isolated local D1 and R2 but never load provider secrets or call Dynadot. `corepack pnpm test:integration` runs the Workflow orchestration against real local D1 and R2 with an invented zipped feed.
