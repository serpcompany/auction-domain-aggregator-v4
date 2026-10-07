# Dynadot synchronization

Status: Implemented, verified locally, and part of the deployed production sync

Last updated: 2026-10-07

Dynadot is the paged-API provider. Its adapter plugs into the provider-neutral sync described in [Data ingestion](data-ingestion.md); this leaf holds what is specific to Dynadot. Licensing is in [Dynadot licensing](../references/data-licensing/dynadot.md).

## Adapter boundary

The Dynadot adapter (`apps/web/src/server/providers/dynadot/index.ts`) requests `get_open_auctions`, validates unknown provider JSON at runtime, normalizes it, and passes only application listings to the sync service. It requests up to 1,000 expired-auction records per page and accepts at most 1,000 pages. It enforces a 30-second request timeout, a 10 MiB response limit, a maximum response cardinality equal to the requested page size, bounded provider strings, normalized domain syntax, nonnegative counters, safe integer money in cents, and valid timestamps. Errors crossing the boundary are fixed codes and never contain the API key or request URL. The key is the Worker secret `DYNADOT_API_PRODUCTION_KEY`.

The last page is the first page with fewer than 1,000 raw records.

## Rate limit

Dynadot allows a regular account 60 requests a minute. Back-to-back page requests reached about 120 a minute, and on 2026-10-07 three runs in a row failed partway through: Dynadot answered HTTP 200 with `{"Response":{"ResponseCode":"-1","Error":"Too many requests. Please try again in 1 minute after."}}`, which failed validation as `dynadot_response_error`. The adapter now waits for the shared pacer ([Provider rate limits](provider-rate-limits.md)) before every request, so pages are requested at most once every 1.1 seconds and a 433-page sync takes about 8 minutes.

## Error answers

Dynadot reports a failed command as HTTP 200 with a `Response` object holding a `ResponseCode` and usually an `Error` message. The adapter does not rely on the exact wording:

- A message that mentions too many requests, a rate limit, throttling, or trying again is the transient `dynadot_rate_limited`, on any page, and its "try again in N seconds, minutes, or hours" becomes the retry delay.
- Any other error answer is `dynadot_api_error`. On page 1 it is permanent: an invalid key or command fails the first request. After page 1 the key and command have already worked, so it is most likely a limit worded differently, and it is retried.

A body that stops partway, from an abort or a dropped connection, is the transient `dynadot_network_error`. `dynadot_parse_error` means a complete body that is not JSON.

## Missing values

Dynadot writes a missing value as `-`, and since October 2026 some renewal prices as `--`; any run of dashes, an empty string, or a negative number is stored as null. Before this, 117 listings on one page had `--` and failed the page's 10% rejection threshold.

## Evidence

- With pacing, `corepack pnpm sync dynadot` through the Workflow on 2026-10-07 succeeded: 460 pages, 459,111 listings, 0 rejected, 47,877 ended listings inactivated, in 8.5 minutes with no rate limit.
- Before the Workflow, the initial live synchronization completed in 427 pages with 426,328 fetched and upserted records and no inactivations; a second complete synchronization completed in 427 pages with 426,398 records and 2 inactivations.
- After writes became change-only, a Dynadot sync two days after the last one wrote 1.6 rows per listing.
