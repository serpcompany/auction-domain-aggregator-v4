# GoDaddy auction ingestion

## Purpose / Big Picture

The discovery table only shows Dynadot auctions. GoDaddy Auctions publishes its whole biddable inventory, roughly 600,000 expired and closeout listings, as free daily files with per-domain Majestic and SEMrush metrics. This plan adds GoDaddy as the second implemented provider and stores those metrics so the owner can filter the inventory by Trust Flow, Citation Flow, referring domains, and SEMrush Authority Score. The issue is serpcompany/auction-domain-aggregator-v4#16.

When this is done, `corepack pnpm sync godaddy` downloads the public file, loads every listing and its metrics into local D1, and prints a success summary. The table then shows GoDaddy rows next to Dynadot ones, the Auction type filter can include or exclude GoDaddy's buy-now listings, and URLs such as `/?majesticTfMin=10` narrow the table to domains with those metrics. GoDaddy content is licensed for the owner's internal use only (`docs/references/data-licensing.md`), which this local tool is.

## Progress

- [x] (2026-10-06) Read the feed index and profiled `all_biddable_auctions.json.zip` (586,958 records, all `Bid`, no invalid links, prices, or end times, no duplicate IDs or domains).
- [x] (2026-10-06) Proved a Worker under `global_fetch_strictly_public` can fetch an `http://127.0.0.1` URL under local `wrangler dev`.
- [x] (2026-10-06) Schema: `domain_seo_metrics` and nullable `bidder_count`, migration `0005_greedy_glorian.sql`.
- [x] (2026-10-06) GoDaddy adapter, shared normalization helpers, registry file-feed entry, worker feed check.
- [x] (2026-10-06) Node file-feed staging (download, unzip, stream-split, loopback server) and runner wiring.
- [x] (2026-10-06) D1 storage upserts metrics; parser, query, and row shape support the four metric filters and `buy_now`.
- [x] (2026-10-06) Quick checks (100% configured coverage), real-D1 integration proof, browser acceptance (4 passed).
- [x] (2026-10-06) Real `corepack pnpm sync godaddy` run in the worktree's own local D1: succeeded, 586,958 records, 0 rejected.
- [x] (2026-10-06) Documentation updated; plan moved to `completed/`. The PR and auto-merge follow.

## Surprises & Discoveries

- `all_biddable_auctions.json` contains only `Bid` listings (586,958 on 2026-10-05). `BuyNow` records appear in other GoDaddy files, so the adapter supports them but this feed does not exercise them.
- Every record carried metrics, but values are small: on 2026-10-05 the maximum Majestic TF was 13 and the maximum SEMrush AS 34.
- `stream-json` (v3, ESM only) splits the 450 MB document into 587 page files in about 112 seconds with a 235 MiB peak RSS, measured on the owner's Mac. Parsing, not download or unzip, dominates.
- A bare `stream.on('data')` byte counter on `unzip`'s stdout switched the stream to flowing mode before the parser was attached and lost data; byte counting moved into the pipeline's byte-limit transform.
- `stream-json` reports an empty input as a parse error, so "unzip produced nothing and exited non-zero" is detected by byte count, not by an empty-feed error.
- `node --env-file` fails when `.secrets/providers.env` is missing, which GoDaddy does not need. The `sync` script now uses `--env-file-if-exists`; Dynadot still reports `dynadot_missing_credentials` without it.

## Decision Log

- 2026-10-06 (Claude): The Node runner stages the file feed and the worker pulls pages over loopback, instead of the runner pushing records in request bodies. The adapter, sync service, storage, reconciliation guard, and continuation state stay identical to Dynadot's.
- 2026-10-06 (Claude): Page files carry an explicit `isLastPage`. The writer holds one full page back until the next record arrives, so a feed whose size is an exact multiple of 1,000 still ends on a marked page, and a missing page is an error rather than an end of feed.
- 2026-10-06 (Claude): Use the system `unzip -p` plus `stream-json` rather than a zip library. macOS and Linux ship `unzip`; `stream-json` has one dependency (`stream-chain`) and is the established streaming JSON parser. Archive (512 MiB) and unzipped (4 GiB) byte limits bound both stages.
- 2026-10-06 (Claude): GoDaddy `Bid` is stored as auction type `AUCTION` (an existing filter value) and `BuyNow` as `BUY_NOW` (new `buy_now` value, labelled "Buy Now"). The feed cannot tell expired-domain auctions from other seller auctions, so `AUCTION` is the honest label.
- 2026-10-06 (Claude): `bidder_count` becomes nullable (a table rebuild in SQLite) rather than storing 0, because unknown is not zero. Bidder sorting puts unknown last; a bidder minimum excludes unknown.
- 2026-10-06 (Claude): Feed metrics live in `domain_seo_metrics`, one typed row per domain with indexes on the four filtered columns, not in the EAV `domain_metrics` table. They are keyed by domain alone, so the latest feed wins regardless of source, and apply to every listing of that domain. A listing without metrics leaves stored metrics untouched.
- 2026-10-06 (Claude): Metric filters use `domain_name in (select ... from domain_seo_metrics where ...)`, one predicate for all four, so the worst accepted query binds 87 values (was 83).
- 2026-10-06 (Claude): The external ID is the numeric suffix of the listing URL path; the URL is kept as published (including GoDaddy's `isc` source parameter) after checking it is `https://www.godaddy.com/domain-auctions/...`.
- 2026-10-06 (Claude): `pageviews` maps to visitors and `valuation` to appraisal, as the multi-provider plan intended. Inbound links stay null: Majestic backlinks are a different measure and are stored with the metrics.
- 2026-10-06 (Claude): Sorting by metrics and UI columns or inputs are left to the UI work. `DomainListingRow.seoMetrics` carries the values; `domain-table.ts` already builds hrefs and summaries for the filters.

## Outcomes & Retrospective

Achieved:

- `corepack pnpm sync godaddy` loads the full biddable inventory with no credentials. The first real run took 233 seconds, upserted 586,958 listings and 586,958 metrics rows, rejected none, and peaked at about 294 MiB (runner) and 376 MiB (workerd).
- GoDaddy uses the same adapter, sync, storage, guard, and continuation path as Dynadot; only the runner gained a file-feed staging step.
- The table read model filters by Majestic TF, CF, referring domains, and SEMrush AS, and returns `seoMetrics` and nullable `bidderCount` for each row. The real-D1 proof covers latest-wins metrics, the stale-run guard, metric filters, `buy_now`, and the 87-binding worst case.

Remaining:

- UI: form inputs for the four metric filters, metric columns, and a "Buy Now" option appear only when such listings exist (the auction-type facet is data-driven).
- A metric minimum that matches nearly every domain (for example CF 0+) counts in about 2 seconds on the full inventory; selective minimums take about 130 ms. Revisit with a join or a stored flag if broad metric filters become common.
- Freshness is still the global latest successful sync, so a fresh GoDaddy sync hides a stale Dynadot inventory warning.
- Scheduling (#15) must replace the local file staging, since a Worker cannot hold the 450 MB file; R2 or a Queue-fed split is the likely shape.

## Context and Orientation

- `src/server/providers/types.ts`: `NormalizedListing` (now with nullable `bidderCount` and optional `seoMetrics`) and `ProviderAdapter`.
- `src/server/providers/registry.ts`: each provider's secret names, optional `fileFeed` (`url`, archive `entry`, `pageSize`, `pagesUrlName`), and adapter factory.
- `src/server/providers/godaddy/index.ts`: page envelope and per-record validation, normalization, loopback URL check.
- `src/server/providers/normalize.ts`: domain (punycode), money, integer, and bounded-body helpers shared with Dynadot.
- `src/server/ingestion/file-feed.ts`: Node-only download, extraction, paging, and loopback page server.
- `scripts/sync-provider.ts`: stages a file feed before starting the worker and passes `GODADDY_FEED_PAGES_URL` through the mode-0600 env file.
- `src/server/ingestion/d1-storage.ts`: adds a guarded `domain_seo_metrics` upsert to each page batch.
- `src/domain/domain-table.ts` and `src/server/queries/domain-listings-query.ts`: `majesticTfMin`, `majesticCfMin`, `majesticRefDomainsMin`, `semrushAsMin`, and `buy_now`.
- `src/server/ingestion/integration-worker.ts`: `proveGodaddyFeedStorage` runs the metrics, guard, filter, and 87-binding assertions on real local D1.

Terms: a "file feed" is a provider inventory published as one downloadable file instead of a paged API. "Loopback" means `127.0.0.1`, reachable only from the same machine.

## Plan of Work

Milestone 1 (schema and adapter): add the table and nullable column, generate the migration, and write the adapter with unit tests from invented records shaped like the feed. Milestone 2 (staging): write `file-feed.ts` with tests, wire the runner, and check the worker's feed configuration. Milestone 3 (read path): parser, query, row shape, and real-D1 proof. Milestone 4: one real sync, then documentation and PR.

## Concrete Steps

From the worktree root:

    corepack pnpm check:quick          # 221 tests, 100% configured coverage
    corepack pnpm test:integration     # {"status":"succeeded",...,"godaddyFeedProof":true}
    corepack pnpm test:e2e             # 4 passed
    corepack pnpm sync godaddy         # {"provider":"godaddy","status":"succeeded",...}

## Validation and Acceptance

- The real sync succeeds with zero or few rejected records and loads one listing and one metrics row per feed record.
- `/?source=godaddy&majesticTfMin=10` returns only GoDaddy listings whose domain has TF 10 or more.
- `/?type=buy_now` and `/?type=auction` include or exclude GoDaddy listing types.
- A second sync updates metrics and reconciles vanished listings under the existing guard.

## Idempotence and Recovery

The sync is restartable: a failed or interrupted run leaves previous rows, reconciles nothing, and the next run starts from page 1 with a fresh download. Staged files live in a `provider-sync-*` temporary directory that the runner removes on exit, `SIGINT`, and `SIGTERM`. Migration `0005` rebuilds `auction_listings` inside Wrangler's migration transaction and is applied once; reverting means a new migration, not editing `0005`.

## Artifacts and Notes

Feed profile (2026-10-05 build): 586,958 records; `domainAge` missing on 23,729; `monthlyParkingRevenue` missing on 359,381; no record failed adapter validation in an offline pass over all 587 staged pages.

## Interfaces and Dependencies

New dependency: `stream-json` ^3.7.0 (runner only, never bundled into a Worker). System requirement: `unzip` on `PATH` for `pnpm sync godaddy`.

    type FileFeed = { url; entry; pageSize; pagesUrlName: 'GODADDY_FEED_PAGES_URL' };
    createGodaddyAdapter({ pagesUrl, fetchImpl? }): ProviderAdapter
    // DomainListingRow additions
    bidderCount: number | null;
    seoMetrics: {
      source; majesticTf; majesticCf; majesticBacklinks; majesticRefDomains;
      semrushAs; semrushRefDomains; semrushBacklinks; updatedAt: Date;
    } | null;

Revision note (2026-10-06, Claude): Initial plan, written after implementation of milestones 1 to 3 in one session, with evidence recorded as it was gathered. Updated the same day with the real sync results and moved to `completed/`.
