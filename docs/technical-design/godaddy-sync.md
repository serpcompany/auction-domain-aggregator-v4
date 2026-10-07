# GoDaddy synchronization

Status: Implemented, verified locally, and part of the deployed production sync

Last updated: 2026-10-07

GoDaddy is a zipped-JSON file feed. It is staged into R2 by the Workflow and then runs the provider-neutral sync described in [Data ingestion](data-ingestion.md); this leaf holds what is specific to GoDaddy.

## Source and licence

GoDaddy needs no credentials: the source is the public, daily `all_biddable_auctions.json.zip` from `https://inventory.auctions.godaddy.com/` (index at `/metadata.json`), about 37 MB zipped and 450 MB unzipped, shaped as `{ "meta": {...}, "data": [ ...listings ] }`. GoDaddy publishes it around 14:30 UTC, which is why the Cron Trigger runs at 15:30. GoDaddy licenses this content for internal use only ([GoDaddy licensing](../references/data-licensing/godaddy.md)), so it is for the owner's own use.

## Staging

The registry declares it as a file feed (`url`, archive `entry`, `field: "data"`, `pageSize: 1000`). The `stage feed` step streams it into R2 with only web-platform APIs (`apps/web/src/server/ingestion/feed-stage.ts`), never holding the document in memory:

1. `fetch` the archive with a fixed `User-Agent` (GoDaddy's CDN answers 403 without one) and a 10-minute timeout. A declared or local-header compressed size above 512 MiB fails with `feed_too_large`.
2. Parse the zip local file header of the first entry, which must be named `all_biddable_auctions.json`; accept deflate or stored, and a zip64 compressed size in the local header. When the entry has a data descriptor, its local sizes are placeholders (0, or `0xFFFFFFFF` with a zip64 field of 0 from streaming writers), so hold back the archive's last 256 KiB and read the size from the central directory when the download ends, because workerd's `DecompressionStream` rejects any bytes after the deflate data. Zip64 central directory and end records are not read; an archive that needs them fails with `feed_unsupported_archive`, as do a different entry name, encryption, and other compression methods.
3. Decompress with `DecompressionStream('deflate-raw')`, failing above 4 GiB.
4. Scan the bytes for the elements of the top-level `data` array. The scanner tracks strings, escapes, and bracket depth only and copies each record's raw bytes; it never decodes or parses records.
5. Write `page-N.json` objects of 1,000 raw records as `{ page, isLastPage, records }` under `feed-pages/godaddy/<instance id>/` in `FEED_PAGES`. A full page is held back until the next record arrives, so the last page is always marked even when the record count is a multiple of 1,000. An empty feed fails with `feed_empty`. The registry's file feed carries the adapter's read limits (1,000 pages, 10 MiB per page), and staging enforces them with `feed_too_large`, so a feed the adapter would refuse fails once here instead of in every sync. A single record over 10 MiB fails before it is held whole.

Staging failures use fixed codes: `feed_download_failed` (including a connection that drops mid-archive), `feed_too_large`, `feed_extract_failed`, `feed_unsupported_archive`, `feed_parse_error`, `feed_empty`, `feed_page_write_failed` (an R2 write failure), and `feed_stage_failed` (anything unexpected, not retried).

## Adapter

The GoDaddy adapter (`apps/web/src/server/providers/godaddy/index.ts`) reads pages through a `FeedPageSource` (`apps/web/src/server/ingestion/feed-pages.ts` implements it on R2 for the instance's prefix). It refuses pages above 10 MiB, requires the envelope's page number to match, parses the page with `JSON.parse` (so a record the scanner copied but that is not valid JSON fails the page with `godaddy_parse_error`), and validates each record separately with the same 10% page rejection threshold as Dynadot. Read failures are `godaddy_page_read_error`, a missing page `godaddy_missing_page`. The run then uses the unchanged sync service, storage, segmenting, and reconciliation guard.

## Record mapping

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

## Evidence

- Cloud ingestion (2026-10-06, the 2026-10-05 feed build, owner's Mac, Wrangler 4.110.0): staging the archive into R2 took about 8.5 seconds in its own step, about 3 to 8 seconds of Worker CPU and 10 MiB of heap, inside the 60-second step limit. A full first sync of 586,958 records took about 2.5 minutes, with 0 rejected, and the cleanup step deleted all 587 pages. The proof of concept is summarized in [Cloud ingestion](../plans/completed/cloud-ingestion.md).
- Earlier, before the Workflow, with the Node loopback runner: `corepack pnpm sync godaddy` succeeded in 233 seconds wall time and upserted 586,958 records with 0 rejected and 0 inactivated. A selective metric filter (`semrush_as >= 20`, 144 listings) counted in about 130 ms; a filter matching every metrics row (`majestic_cf >= 0`, 529,860 open listings) took about 2 seconds, because the subquery then returns the whole inventory.
- Rewriting every listing on every sync cost 14 D1 rows written per GoDaddy listing (8.0 million per sync); with change-only writes, an unchanged GoDaddy sync writes no listing rows ([Data ingestion](data-ingestion.md#listing-identity-and-lifecycle)).
