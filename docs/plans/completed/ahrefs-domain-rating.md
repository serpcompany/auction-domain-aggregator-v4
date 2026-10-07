# Ahrefs Domain Rating enrichment

Completed 2026-10-06 (Claude) for #18. This is the outcome summary; the full ExecPlan is in git history (`git show 907d382:docs/plans/completed/ahrefs-domain-rating.md`).

## Outcome

The empty Ahrefs DR column now shows real Domain Rating, fetched on demand for the rows a person is viewing, stored once per domain in `domain_metrics` (migration `0004`), and displayed under the "Domain Rating by Ahrefs" attribution the licence requires. Later views read DR from D1 with no Ahrefs call. The empty Majestic column and the unusable Metrics filter group were removed.

The current request path, with claims, the request log, and the 429 cool-down added later, is in [Domain discovery](../../technical-design/domain-discovery.md).

## Key decisions

- **Ahrefs' free `domain-rating-free` endpoint.** It takes up to 1,000 targets, uses no API units, and needs any APIv3 key, including a free account's. Its licence allows display with the attribution and a link to `https://ahrefs.com/` next to the values, and forbids bulk harvesting ([Ahrefs licensing](../../references/data-licensing/ahrefs.md)).
- **On demand, visible rows only; never the whole inventory.** This respects the anti-harvesting clause and matches SpamZilla. The consequence: DR cannot be filtered or sorted across the inventory.
- **Page rendering stays D1-only** (an architectural invariant). A client component posts visible domains that lack DR to one route, the only request path that calls Ahrefs. It accepts at most 50 domains, and only domains with an active listing, so it is not a free public DR proxy. After a store, the client refreshes and the server re-renders from D1.
- **Write-once DR.** "Not found" is stored too, so it is not requested again. A failed request stores nothing and is retried on a later view.
- **The key is `AHREFS_API_KEY` in the app Worker's env:** `.dev.vars` locally (OpenNext never bundles it), `wrangler secret put` when deployed. Without a key the route returns a fixed error and the column keeps showing "not collected".

## Discoveries

- A left join from listings to `domain_metrics` could make SQLite join every filtered row before sorting, so DR is read in a second query for the visible page's domains only.
- The live endpoint echoes each target with a trailing slash (`example.com/`), which the documentation example does not show; nothing matched until normalization was added. Only a real call exposed it.
- 50 rows times 5 columns exceeds D1's 100 bound parameters, so inserts are chunked at 16 rows.

## Evidence

- Without provider calls: 196 unit tests at 100 percent coverage, the integration proof (active-only, write-once, table read), and 4 e2e tests with seeded DR and the attribution.
- Authorized live check on port 30001 after a fresh Dynadot sync: all 50 visible rows gained DR within seconds, 8 of 50 non-zero on the appraisal-sorted page (highest 33), and repeat requests for stored domains made no Ahrefs call.

## Follow-ups at completion

- DR cannot be filtered or sorted across the inventory, by design.
- Ask Ahrefs whether header attribution counts as "adjacent" and what lookup volume a paid product may use (email draft in [Ahrefs licensing](../../references/data-licensing/ahrefs.md)).
