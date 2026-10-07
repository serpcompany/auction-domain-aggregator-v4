# Import Dynadot auctions into the first domain table

Completed 2026-07-13 (Codex). This is the outcome summary; the full ExecPlan is in git history (`git show 907d382:docs/plans/completed/dynadot-domain-table.md`).

## Outcome

The first product-shaped slice: one provider from API boundary through D1 to the UI.

- The first schema: `domains`, `auction_listings` (provider plus external ID as identity, referencing the domain), and `ingestion_runs`, with migration `0001_smooth_alex_wilder.sql` adding server-owned continuation state.
- A Dynadot adapter that runtime-validates `get_open_auctions` and normalizes money to integer cents, timestamps to dates, and sentinel values to null.
- A segmented, idempotent sync with guarded reconciliation, run by a manual local command (`sync:dynadot`).
- The harness card replaced by a server-rendered D1 table with URL-backed search, source filter, allowlisted sort, 50-row pages, freshness, and outbound Dynadot links.
- A provider-free integration proof against isolated local D1.

Ahrefs DR and Majestic Topic were shown as em dashes, not invented. Scheduling, remote D1, deployment, and other providers were out of scope.

## Key decisions

- **Dynadot first, DropCatch deferred.** Dynadot returned live inventory through a documented paged read command. DropCatch authenticated, but its V2 auctions endpoint returned `totalRecords: 0` for this account.
- **Sequential 1,000-record pages until a short page.** That is the command's maximum, and a bounded sequential loop gives a complete reconciliation signal without guessed concurrency.
- **Server-owned continuation.** `next_page` and every counter live in `ingestion_runs`; the caller supplies only a run ID, and every mutation is guarded by run ID, provider, running state, and start time, so continuation state cannot be forged.
- **Success-only reconciliation.** Unseen listings become inactive only in the same atomic batch that marks a complete run successful. A failed or partial run leaves prior rows active.
- **Explicit bounds:** 10 MiB responses, 30-second provider requests, and bounded runner and segment timeouts.
- **Separate domain and listing identity,** so a listing can change price, bids, and end time without creating another domain.
- **Truthful gaps.** Unavailable metrics stay visibly empty instead of becoming placeholder values.

## Discoveries

- Dynadot API3 returns JSON with a `text/plain` content type, so the adapter must not reject on media type.
- A stored DropCatch token expired (HTTP 401); the client ID and secret issued a fresh one.
- Wrangler's `getPlatformProxy()` hung under Node 25, so the runner used a short-lived loopback `wrangler dev`. Workflows later replaced it ([Cloud ingestion](cloud-ingestion.md)).
- One workerd request could not import the whole inventory, so syncs run in 20-page segments that resume from D1.
- D1 rejects statements above 100 bound parameters, so batches are JSON-bound: 100 domains and 25 listings, one atomic D1 batch per page.
- The live inventory needed 427 pages, so the page cap became 1,000 instead of the initial guess of 100.
- A generic `updated_at` listing column duplicated first-seen and last-seen; review removed it before data existed.

## Evidence

- Two complete live syncs of 427 pages: 426,328 records with no inactivations, then 426,398 records with 2 inactivated. The local database held 426,400 listings, 426,398 active, with no duplicates, running rows, or foreign-key violations.
- `pnpm check` passed: 94 unit tests at 100 percent configured coverage, the isolated D1 integration proof, and the workerd browser test. No provider resync followed the final hardening; tests cover those changes.

## Follow-ups at completion

Filtering and presentation ([Domain table filtering and presentation](domain-table-filtering-and-presentation.md)), metrics ([Ahrefs Domain Rating](ahrefs-domain-rating.md)), scheduling ([Cloud ingestion](cloud-ingestion.md)), and more providers ([Multi-provider ingestion](multi-provider-ingestion.md)).
