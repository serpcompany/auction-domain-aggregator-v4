# NameSilo synchronization

Status: Implemented. Local syncs call NameSilo; deployed syncs replay a recording made from GitHub Actions

Last updated: 2026-10-07

NameSilo is a paged API. Its adapter plugs into the provider-neutral sync described in [Data ingestion](data-ingestion.md); this leaf holds what is specific to NameSilo. Licensing is in [NameSilo licensing](../references/data-licensing/namesilo.md).

## Source

The adapter (`apps/web/src/server/providers/namesilo/index.ts`) calls `GET https://www.namesilo.com/public/apibatch/listAuctions?version=1&type=json&key=<key>&typeId=<t>&statusId=<s>&page=<p>&pageSize=500`. The key is the Worker secret `NAMESILO_API_KEY`, sent in the query string as NameSilo requires, and never written to an error or a log. Each request sends the `User-Agent` `auction-domain-aggregator-ingestion/1`, like the GoDaddy feed download, because a Worker's fetch sends none.

Facts verified with the owner's key on 2026-10-07 (#83):

- The `/public/apibatch/` path is used because NameSilo's batch policy requires `/apibatch` for automated calls. `/apibatch/listAuctions` without `public` answers code 107, "Invalid API operation".
- The answer is `{"reply":{"code":300,"detail":"success","body":[...]}}`. Code 300 is success.
- A `pageSize` above 500 answers code 210. A page past the end answers code 300 with an empty `body`. There is no total count.
- A deep page takes about 2.5 seconds and is about 224 KB.
- Expired auctions are `typeId=3`, `statusId=2`: over 215,000, about 440 pages. Customer auctions are `typeId=1`, `statusId=9`: a few thousand. `typeId=2` is offers and counter-offers, not auctions, and is never requested.
- Some active expired auctions report an end time in the past, as far back as 2025. They are stored anyway; the table hides ended auctions.

## Deployed syncs replay a recording

NameSilo's Cloudflare zone answers 403 to every request from a Cloudflare Worker, whatever its headers: a rule on Worker subrequests (`cf.worker.upstream_zone`), so nothing in the request can clear it (#104). A GitHub-hosted runner reaches the same endpoint normally. So the `NameSilo recording` workflow (`.github/workflows/namesilo-recording.yml`, daily at 13:45 UTC and on demand) runs `apps/web/scripts/record-namesilo.ts`. The script drives this same adapter, paced as usual, with a fetch that keeps each successful `listAuctions` body. A transient error is retried up to four times. It uploads one object per request, `<typeId>-<statusId>-<page>.json`, under `feed-pages/namesilo-recording/<yyyymmddhhmmss>/` in both environments' `FEED_PAGES` buckets through the Cloudflare API, and writes `feed-pages/namesilo-recording/latest.json` (`{ prefix, recordedAt }`) last, so a sync never sees an incomplete recording. The key, request URLs, and bodies are never printed. The bucket's `feed-pages/` lifecycle rule expires recordings after 2 days.

A NameSilo instance first runs a `find recorded responses` step. When the manifest names a recording no more than 26 hours old, the adapter replays it (`apps/web/src/server/ingestion/namesilo-recording.ts`) with no pacing, and a request the recording lacks answers 404 (`namesilo_http_error`). Production's 15:30 UTC sync replays that day's recording, and Staging's 11:30 UTC sync the next day replays the same one. Without a fresh recording, as in local development or after the job stops for two days, the adapter calls NameSilo, which fails deployed with the 403 above.

## Pages

The sync service reads one numbered page at a time, so the two auction kinds share one page index:

- Page 1 is every customer auction. The adapter requests customer pages 1, 2, and so on until a page has fewer than 500 records, and returns them together, never as the last page. More than 40 full customer pages (20,000 auctions) fails with the permanent `namesilo_customer_page_limit`.
- Page n (n ≥ 2) is expired page n - 1. The first expired page with fewer than 500 raw records, an empty one included, is the last page.

Every request, including each internal customer page, first waits for the pacer: `DEFAULT_RATE_LIMIT`, one request every 2 seconds, because NameSilo publishes no limit ([Provider rate limits](provider-rate-limits.md)). A full sync is about 450 requests and takes 20 to 30 minutes.

## Record mapping

Each record is validated with zod and normalized on its own. An invalid record is skipped and counted with its field and reason. More than 10% of one API page invalid fails the sync page with `namesilo_too_many_rejected` and the reasons.

| API field | Stored as |
| --- | --- |
| `id` | `external_id` |
| `domain` | lowercase, punycode `domain_name` |
| `url` (must be `https://www.namesilo.com/auctions/...`, with no credentials) | `auction_url` |
| `typeId` 3 or 1 | `auction_type` `EXPIRED` or `AUCTION`; any other type is rejected |
| `currentBid` when `hasBids` is set or `currentBid` is above 0, otherwise `openingBid` (dollars) | `current_bid_cents`, currency `USD` |
| `bidsQuantity` | `bid_count` |
| `auctionEndsOnUtc` (`YYYY-MM-DD HH:MM:SS`, UTC; any other format is rejected) | `ends_at` |
| whole years from `domainCreatedOn` to the auction's end, so it does not depend on when the API is read | `age_years` (null when missing, the zero date, or after the end) |
| `visits` | `visitors` |
| not published | `bidder_count`, `starts_at`, `inbound_links`, `appraisal_cents`, `renewal_price_cents` are null; no SEO metrics |
| `maxBid`, `clicks`, `ctr`, `auctionEndsOn`, user and bid IDs | not stored |

`maxBid` is NameSilo's price cap for an expired auction, not a bid, so it is never the price. `domainCreatedOn` has no time zone and is read as UTC, which can shift an age by a year only on the anniversary day.

## Errors

- A network failure, a body that stops partway, a request over 30 seconds, and HTTP 429 or 5xx are transient: `namesilo_network_error` and `namesilo_http_error`. A `Retry-After` header on a 429 or 503 sets the Workflow's wait. Any other HTTP status is permanent. Every non-2xx answer is logged to Workers Logs with its status and the `server` and `cf-mitigated` headers, so a Cloudflare block in front of NameSilo shows there (#104).
- A reply code other than 300 is `namesilo_api_error`. On the run's first request (customer page 1) it is permanent, because there it most likely means an invalid key. On any later request the key has already worked, so it is most likely a limit or an outage, and is retried, like Dynadot's `dynadot_api_error`.
- A body that is not JSON (`namesilo_parse_error`), lacks a `reply` with a `body` list or holds more than 500 records (`namesilo_response_error`), or is over 10 MiB (`namesilo_response_too_large`) is permanent.

## Evidence

Unit tests with invented records cover the page mapping, the customer cap, pacing before every request, each mapping rule, and the error classification. A real local `corepack pnpm sync namesilo` on 2026-10-07 fetched 438 pages and 221,501 records. Staging's first deployed run failed on its first request with `namesilo_http_error` (#104).
