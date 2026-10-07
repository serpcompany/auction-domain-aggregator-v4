# Ahrefs Domain Rating enrichment

Status: Implemented locally

Last updated: 2026-10-08

Ahrefs Domain Rating (DR) is the one value the web application fetches from a provider. It reaches D1 two ways: on demand for the rows on screen, and from a daily backfill that rates every listed domain. This leaf records how both stay bounded and how stored DR differs from feed-published metrics. The licence terms are in [Ahrefs licensing](../references/data-licensing/ahrefs.md); why it started on demand is in the [completed plan](../plans/completed/ahrefs-domain-rating.md).

## Rules

- DR is fetched for the rows on screen and, since 2026-10-08, for the whole inventory by a daily backfill, so it can be filtered and sorted like the feed metrics. The owner chose the backfill knowing the licence forbids harvesting DR "in bulk or systematically" to build a competing dataset; the question to Ahrefs is still open ([Ahrefs licensing](../references/data-licensing/ahrefs.md)).
- `POST /api/enrichment/domain-rating` is the only request path that calls a provider. Page rendering stays D1-only. The backfill runs in the ingestion Worker.
- A stored DR is write-once and never refreshed, by either path. Feed-published Majestic and SEMrush metrics are different: every sync replaces them ([Data ingestion](data-ingestion.md#feed-published-seo-metrics)).
- `domain_metrics` is keyed by `(domain_name, metric)`; `ahrefs_dr` is the only metric. A later listing for the same domain reuses the stored value.
- Every displayed value sits under the "Domain Rating by Ahrefs" attribution linked to `https://ahrefs.com/`.
- The key is `AHREFS_API_KEY` in the app Worker's env and the ingestion Worker's (`apps/web/.dev.vars` locally for both). Without it the route answers a fixed error and cells keep showing "not collected", and the backfill instance fails with `ahrefs_missing_credentials`.

## Request path

After the page renders, `apps/web/src/components/auctions/domain-ratings.tsx` posts up to 50 shown domains without a settled rating to `POST /api/enrichment/domain-rating`, and calls `router.refresh()` when the answer says something was stored. The route (`apps/web/src/server/enrichment/domain-rating-request.ts`) validates the body and runs `enrichDomainRatings` (`domain-rating.ts`) on the D1 store (`domain-rating-store.ts`):

1. **Abort.** It stops if the request's `signal` is aborted, before any D1 write and again just before the Ahrefs call. In the second case it deletes the claims it just made, so the next request can claim those domains at once. This covers React StrictMode's double effect in development and fast paging, where the client aborts its earlier POST. `next dev` aborts the signal natively. On Workers, OpenNext passes the incoming request's signal to route handlers, and the `enable_request_signal` compatibility flag in `apps/web/wrangler.jsonc` makes workerd abort it when the client disconnects.
2. **Cool-down.** If any `ahrefs_requests.cool_down_until` is in the future, it answers 429 `ahrefs_cool_down` with a `Retry-After` header and calls nothing.
3. **Claim.** One `INSERT ... SELECT ... ON CONFLICT DO UPDATE ... RETURNING` statement claims the domains that have an active listing and either no `domain_metrics` row, an `omitted` row whose `retry_after` has passed, or a lapsed claim. A claim is a `pending` row with `retry_after` 60 seconds ahead, longer than the call's 15-second timeout. SQLite runs the statement atomically and RETURNING lists only the rows it wrote, so a concurrent request for the same domains gets none of them and makes no call. Isolate memory is not shared between Worker instances, so the claim lives in D1. Domain names travel as one JSON array, so the statement uses three bound parameters for any page.
4. **Call.** It asks Ahrefs once for the claimed domains.
5. **Record.** One D1 batch writes the call's `ahrefs_requests` row and its results. A rated domain becomes `ok`, an unrated one `not_found`, and a domain Ahrefs left out of its answer `omitted`, with `retry_after` a week later. Results replace only `pending` and `omitted` rows, so `ok` and `not_found` stay write-once. A failed call writes only its log row. On `ahrefs_rate_limited` that row's `cool_down_until` is the 429's `Retry-After` (seconds or an HTTP date), or 60 seconds without one, bounded to between 1 second and 1 hour. The claims of a failed call are left to lapse, so those domains wait a minute before another try.

`ahrefs_requests` holds one row per call to Ahrefs, whatever the outcome: `requested_at`, `domain_count`, `outcome` (`ok` or the `ahrefs_*` code), and `cool_down_until`. Counting its rows counts usage exactly. The cool-down read is a range on `ahrefs_requests_cool_down_until_idx`.

The table read treats `ok` and `not_found` as fetched, and also an `omitted` row until its `retry_after`. That cell shows "no rating", and the client does not ask again. A `pending` row, or an `omitted` one past its retry time, reads as not fetched, so the cell shows the spinner and the client asks again.

When a request finds every domain held by another one, it stores nothing and does not refresh. If the request holding them belonged to a page the person has left, the ratings appear on the next view.

## Daily backfill

The ingestion Worker's daily Cron Trigger also starts one `domain-rating` Workflow instance (`apps/web/src/server/enrichment/domain-rating-backfill.ts`, entry in `sync-worker.ts`). It first sleeps an hour, so the provider syncs it starts with have stored the day's new listings. Then each step:

1. Waits out any cool-down in `ahrefs_requests`, sleeping as long as it has left.
2. Selects up to 1,000 domains (the endpoint's maximum) in name order after the last one it rated, that have a listing open now and no `ok` or `not_found` row, nor an `omitted` or `pending` row still waiting. The query walks `auction_listings_domain_name_idx` from that cursor, so a run reads the inventory once however much is already rated; `+status` and `+ends_at` keep SQLite on that index.
3. Passes over names the route's validation would reject, then calls Ahrefs once and records the call and its results exactly as step 5 above. It makes no claims, which halves its D1 writes: it skips domains the route has claimed, and stored results are write-once, so an overlap costs at most one extra lookup.
4. Sleeps 2 seconds before the next call. A 429 sets the shared cool-down, which the next step waits out; a rejected key ends the instance with `ahrefs_unauthorized`; any other failure is retried after 1, 2, then 4 minutes, and then ends the instance.

A run stops after 1,000 calls (1,000,000 domains, about two hours), and a rate-limited call counts toward that, so a run Ahrefs keeps refusing still ends. It logs `domain_rating_backfill` with its call, request, and write counts, and returns them. The first runs rate the existing inventory (about 2 million domains locally, so two daily runs); after that a run rates the day's new domains, about 165 calls. Each rated domain costs about two D1 row writes (the row and its key index).

`corepack pnpm sync ahrefs-dr` runs the same Workflow locally; it reads `AHREFS_API_KEY` from `apps/web/.dev.vars`. A name Ahrefs answers with an HTTP error for a whole batch would fail each day's run at the same place; the fix then is to bisect the batch, which is not built yet.

## Gaps

- The route has no access control of its own. On Staging and Production the whole website is owner-only behind Cloudflare Access ([Deployment](deployment.md)); payment-gated access arrives with accounts (#27). Each deployed website calls Ahrefs only once the owner sets its `AHREFS_API_KEY` secret.
- On-demand calls are not paced beyond the claim and the cool-down. The backfill paces its own calls 2 seconds apart; Ahrefs publishes no limit for this endpoint ([Provider rate limits](provider-rate-limits.md)).
- A stored DR is never refreshed. DR changes slowly, but a refresh (re-rating the oldest ratings each day) is the next step if the values go stale.
- Majestic Topic is not planned (#19).
