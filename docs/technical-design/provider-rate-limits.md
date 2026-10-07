# Provider rate limits

Status: Implemented

Last updated: 2026-10-07

Every provider in `apps/web/src/server/providers/registry.ts` declares its rate limit, and the type rejects a paged-API provider without one:

- A paged API declares `rateLimit: { intervalMs, source }`, the minimum time between the starts of two requests and where that number comes from. The Workflow builds a pacer from it (`createPacer` in `apps/web/src/server/providers/rate-limit.ts`), and the adapter awaits the pacer before every request. The pacer does not delay the first request, spaces later ones at least `intervalMs` apart, and makes concurrent callers take turns.
- A provider without a published limit uses `DEFAULT_RATE_LIMIT`, one request every 2 seconds, until it confirms a real number.
- A file feed declares `rateLimit: 'one download per run'`: the stage step downloads it once, and the adapter reads only the staged pages.

`parseRetryAfter` in the same module reads a `Retry-After` header in either form. How the Workflow honors a provider's requested wait is in [Data ingestion](data-ingestion.md#ingestion-worker-and-workflow).

| Provider | Access | Published limit | Enforced | Source | Verified |
| --- | --- | --- | --- | --- | --- |
| Dynadot | `get_open_auctions` API | 60 requests a minute for a regular account ("60/min (1/sec)"); bulk 600, super bulk 6,000 | 1 request every 1.1 s | [Dynadot API commands](https://www.dynadot.com/domain/api-commands) | 2026-10-07, a full paced sync with no rate limit |
| GoDaddy | public inventory file | none for the file (the Auctions API, which is not used, allows 60 requests a minute per endpoint) | one download per run | [GoDaddy inventory files](https://www.godaddy.com/help/download-inventory-files-for-godaddy-auctions-41284), [GoDaddy API Terms of Use](https://www.godaddy.com/en/legal/agreements/godaddy-api-terms-of-use) | 2026-10-06 |
| Namecheap | public market sales CSV | none; the Universal Terms of Service forbid "repetitive, high volume requests" | one download per run | [Namecheap Universal ToS](https://www.namecheap.com/legal/universal/universal-tos/) | 2026-10-07 |
| Ahrefs | `domain-rating-free`, on demand from the web app, not a sync | not recorded; Ahrefs may rate-limit or throttle without notice | one call per claimed batch of at most 50 domains, and a cool-down after a 429 honoring `Retry-After` ([Domain Rating enrichment](domain-rating-enrichment.md)); not yet on the shared pacer | [Ahrefs free DR endpoint](https://docs.ahrefs.com/en/api/reference/public/post-domain-rating-free) | not verified |
| NameSilo, DropCatch | not implemented | none published | `DEFAULT_RATE_LIMIT` when added | [Data licensing](../references/data-licensing/README.md) | 2026-10-06 |
