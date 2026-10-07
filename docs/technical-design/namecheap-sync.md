# Namecheap synchronization

Status: Implemented, verified locally, and part of the deployed production sync

Last updated: 2026-10-07

Namecheap is a CSV file feed. It is staged into R2 by the Workflow and then runs the provider-neutral sync described in [Data ingestion](data-ingestion.md); this leaf holds what is specific to Namecheap.

## Source and licence

Namecheap needs no credentials: the source is the public market sales CSV at `https://d3ry1h4w5036x1.cloudfront.net/reports/Namecheap_Market_Sales.csv`, linked from Namecheap Market's auctions page and refreshed hourly. On 2026-10-07 it was 194 MB with 1,104,121 rows: unquoted fields, LF line endings, every sale ID and domain unique, and end times up to about 45 days out. Licensing, including the owner's decision to show Namecheap listings to customers, is in [Namecheap licensing](../references/data-licensing/namecheap.md).

## Staging

The registry declares it as a `csv` file feed (`pageSize: 2000`, 1,000 pages, 10 MiB per page). The `stage feed` step (`apps/web/src/server/ingestion/feed-csv.ts`) shares the download step with the zipped feed, then decodes the body with a fatal `TextDecoder` (invalid UTF-8 fails with `feed_parse_error`) and splits RFC 4180 rows as they stream: quoted fields with `""` escapes, LF or CRLF, empty lines skipped. The header row must have unique, non-empty names, and every data row must have the same number of fields. Each row becomes a JSON object of its non-empty fields, as strings, so the page files use the same `{ page, isLastPage, records }` envelope as GoDaddy's. The download is capped at 1 GiB. A quote inside an unquoted field, text after a closing quote, an unterminated quote, or a mismatched row fails with `feed_parse_error`; a row over the page byte limit fails with `feed_too_large` before it is held whole.

## Adapter

The Namecheap adapter (`apps/web/src/server/providers/namecheap/index.ts`) reads pages through the same staged-page reader as GoDaddy's (`apps/web/src/server/providers/staged-feed.ts`), with `namecheap_*` error codes and the same 10% page rejection threshold.

## Record mapping

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

## Evidence

Staging the real file (2026-10-07) took 2.7 seconds in Node and produced 553 pages, the largest 870 KB. All 1,104,121 rows normalized with none rejected. A local `corepack pnpm sync namecheap` takes about 5 minutes.
