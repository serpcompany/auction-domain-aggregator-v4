# Ahrefs Domain Rating enrichment

Status: Implemented locally

Last updated: 2026-10-08

Ahrefs Domain Rating (DR) is the one value the web application fetches from a provider. This leaf records how the request path stays bounded and how stored DR differs from feed-published metrics. The licence terms are in [Ahrefs licensing](../references/data-licensing/ahrefs.md); why it is on demand is in the [completed plan](../plans/completed/ahrefs-domain-rating.md).

## Rules

- DR is fetched for the rows on screen, or on request for every listing the filters match when that is 1,000 listings or fewer, never for the whole inventory. This follows the licence's anti-harvesting clause: every fetch is one person's lookup of a set they chose. Filtering and sorting by DR therefore see only stored ratings.
- `POST /api/enrichment/domain-rating` and `POST /api/enrichment/domain-rating/matching` are the only request paths that call a provider. Page rendering stays D1-only.
- A stored DR is write-once and never refreshed by scheduled work. Feed-published Majestic and SEMrush metrics are different: every sync replaces them ([Data ingestion](data-ingestion.md#feed-published-seo-metrics)).
- `domain_metrics` is keyed by `(domain_name, metric)`; `ahrefs_dr` is the only metric. A later listing for the same domain reuses the stored value.
- Every displayed value sits under the "Domain Rating by Ahrefs" attribution linked to `https://ahrefs.com/`.
- The key is `AHREFS_API_KEY` in the app Worker's env (`apps/web/.dev.vars` locally). Without it the route answers a fixed error and cells keep showing "not collected".

## Request path

After the page renders, `apps/web/src/components/auctions/domain-ratings.tsx` posts the shown domains without a settled rating to `POST /api/enrichment/domain-rating` in requests of at most 48 (`DOMAIN_RATING_PAGE_BATCH`; the route accepts 50), two for a full 96-row page, sent together. After every request settles it calls `router.refresh()` once, and only if an answer says something was stored, because a refresh re-runs every D1 read of the page. Leaving the page aborts every request still running. The route (`apps/web/src/server/enrichment/domain-rating-request.ts`) validates the body and runs `enrichDomainRatings` (`domain-rating.ts`) on the D1 store (`domain-rating-store.ts`):

1. **Abort.** It stops if the request's `signal` is aborted, before any D1 write and again just before the Ahrefs call. In the second case it deletes the claims it just made, so the next request can claim those domains at once. This covers React StrictMode's double effect in development and fast paging, where the client aborts its earlier POST. `next dev` aborts the signal natively. On Workers, OpenNext passes the incoming request's signal to route handlers, and the `enable_request_signal` compatibility flag in `apps/web/wrangler.jsonc` makes workerd abort it when the client disconnects.
2. **Cool-down.** If any `ahrefs_requests.cool_down_until` is in the future, it answers 429 `ahrefs_cool_down` with a `Retry-After` header and calls nothing.
3. **Claim.** One `INSERT ... SELECT ... ON CONFLICT DO UPDATE ... RETURNING` statement claims the domains that have an active listing and either no `domain_metrics` row, an `omitted` row whose `retry_after` has passed, or a lapsed claim. A claim is a `pending` row with `retry_after` 60 seconds ahead, longer than the call's 15-second timeout. SQLite runs the statement atomically and RETURNING lists only the rows it wrote, so a concurrent request for the same domains gets none of them and makes no call. Isolate memory is not shared between Worker instances, so the claim lives in D1. Domain names travel as one JSON array, so the statement uses three bound parameters for any page.
4. **Call.** It asks Ahrefs once for the claimed domains.
5. **Record.** One D1 batch writes the call's `ahrefs_requests` row and its results. A rated domain becomes `ok`, an unrated one `not_found`, and a domain Ahrefs left out of its answer `omitted`, with `retry_after` a week later. Results replace only `pending` and `omitted` rows, so `ok` and `not_found` stay write-once. A failed call writes only its log row. On `ahrefs_rate_limited` that row's `cool_down_until` is the 429's `Retry-After` (seconds or an HTTP date), or 60 seconds without one, bounded to between 1 second and 1 hour. The claims of a failed call are left to lapse, so those domains wait a minute before another try.

`ahrefs_requests` holds one row per call to Ahrefs, whatever the outcome: `requested_at`, `domain_count`, `outcome` (`ok` or the `ahrefs_*` code), and `cool_down_until`. Counting its rows counts usage exactly. The cool-down read is a range on `ahrefs_requests_cool_down_until_idx`.

The table read treats `ok` and `not_found` as fetched, and also an `omitted` row until its `retry_after`. That cell shows "no rating", and the client does not ask again. A `pending` row, or an `omitted` one past its retry time, reads as not fetched, so the cell shows the spinner and the client asks again.

When a request finds every domain held by another one, it stores nothing and does not refresh. If the request holding them belonged to a page the person has left, the ratings appear on the next view.

## Fetching DR for the matching listings

Fetch DR, at the end of the active-filters row, posts the table's query string to `POST /api/enrichment/domain-rating/matching`. The route parses it with the page's own filter parser, reads the distinct domains of the matching active listings (`queryMatchingDomainNamesWithDatabase`, at most 1,001 rows), and answers 400 `too_many_listings` past 1,000. Otherwise it runs the same `enrichDomainRatings` steps with a limit of 1,000, one Ahrefs call (`AHREFS_DR_MAX_TARGETS`). The button asks for narrower filters without calling the server when the count is above the limit. Each fetched domain costs two D1 row writes: its claim and its result.

The `domainRatingMin` filter reads `domain_metrics_metric_value_domain_name_idx` in a subquery, like the feed-metric filters, so it matches only domains with an `ok` rating.

## Gaps

- The route has no access control of its own. On Staging and Production the whole website is owner-only behind Cloudflare Access ([Deployment](deployment.md)); payment-gated access arrives with accounts (#27). Each deployed website calls Ahrefs only once the owner sets its `AHREFS_API_KEY` secret.
- Ahrefs calls are not paced beyond the claim and the cool-down; they are not yet on the shared provider pacer ([Provider rate limits](provider-rate-limits.md)).
- Majestic Topic is not planned (#19).
