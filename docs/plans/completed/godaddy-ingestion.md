# GoDaddy auction ingestion

Completed 2026-10-06 (Claude) for #16. This is the outcome summary; the full ExecPlan is in git history (`git show 907d382:docs/plans/completed/godaddy-ingestion.md`).

## Outcome

GoDaddy became the second provider. Its public daily file of about 587,000 biddable listings, with per-domain Majestic and SEMrush metrics, loads with no credentials through the same adapter, sync, storage, guard, and continuation path as Dynadot.

- `domain_seo_metrics` and a nullable `auction_listings.bidder_count` (migration `0005_greedy_glorian.sql`).
- A GoDaddy adapter and a registry file-feed entry; shared normalization helpers in `normalize.ts`.
- Read-model filters on Majestic TF, CF, and referring domains and SEMrush AS, plus the `buy_now` auction type.
- GoDaddy content is licensed for the owner's internal use only ([GoDaddy licensing](../../references/data-licensing/godaddy.md)).

The first version staged the file on the owner's machine with `unzip` and `stream-json` and served pages over loopback; [Cloud ingestion](cloud-ingestion.md) replaced that with a Workflow stage step and R2.

## Key decisions

- **Page files carry an explicit `isLastPage`.** The writer holds one full page back until the next record arrives, so a feed whose size is a multiple of 1,000 still ends on a marked page, and a missing page is an error, not an end of feed.
- **`Bid` is stored as `AUCTION` and `BuyNow` as `BUY_NOW`.** The feed cannot tell expired-domain auctions from other seller auctions, so `AUCTION` is the honest label.
- **`bidder_count` is nullable** rather than 0, because unknown is not zero. Bidder sorts put unknown last, and a bidder minimum excludes it.
- **Feed metrics live in typed, indexed `domain_seo_metrics` rows keyed by domain,** not in the EAV `domain_metrics` table. The latest feed wins regardless of source, the values apply to every listing of that domain, and a listing without metrics leaves stored ones alone.
- **One `domain_name in (select ...)` predicate for all metric filters,** so the worst accepted query binds 87 values, under D1's 100.
- **The external ID is the numeric suffix of the listing URL path.** The URL is kept as published after checking it is `https://www.godaddy.com/domain-auctions/...`.
- **`pageviews` maps to visitors and `valuation` to appraisal.** Inbound links stay null: Majestic backlinks are a different measure and are stored with the metrics.

## Discoveries

- `all_biddable_auctions.json` holds only `Bid` listings; `BuyNow` appears in other GoDaddy files, so the adapter supports it but this feed does not exercise it.
- Metric values are small: on 2026-10-05 the highest Majestic TF was 13 and the highest SEMrush AS 34.
- `node --env-file` fails when `.secrets/providers.env` is missing, so `sync` uses `--env-file-if-exists`; Dynadot still reports `dynadot_missing_credentials` without it.

## Evidence

- Feed profile (2026-10-05 build): 586,958 records, no invalid links, prices, or end times, no duplicate IDs or domains; `domainAge` missing on 23,729.
- The first real `pnpm sync godaddy` took 233 s and upserted 586,958 listings and metrics rows with 0 rejected.
- A selective metric filter (`semrush_as >= 20`, 144 listings) counted in about 130 ms; a filter matching every metrics row (`majestic_cf >= 0`) took about 2 s, because the subquery returns the whole inventory.
- `pnpm check`: 221 unit tests at 100 percent configured coverage, the real-D1 proof (latest-wins metrics, stale-run guard, metric filters, `buy_now`, the 87-binding worst case), and 4 browser tests.

## Follow-ups at completion

- UI for the metric filters and columns (done in the [UI redesign](ui-redesign.md)).
- Broad metric minimums are slow; revisit with a join or a stored flag if they become common.
- Freshness is the global latest successful sync, so a fresh GoDaddy sync hides a stale Dynadot inventory.
- Scheduling had to replace local staging (done in [Cloud ingestion](cloud-ingestion.md)).
