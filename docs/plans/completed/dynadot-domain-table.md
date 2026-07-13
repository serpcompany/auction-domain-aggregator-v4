# Import Dynadot auctions and browse them in the first real domain table

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must remain accurate while implementation proceeds.

Maintain this plan according to `docs/plans/PLANS.md` from the repository root.

## Purpose / Big Picture

After this plan is complete, the repository owner can run one local command to fetch the current Dynadot expired-auction inventory, normalize it, and store it in local Cloudflare D1. Opening the application then shows real auction domains in a server-rendered table instead of the harness status card. The table supports domain search, source filtering, sortable columns, and server-side pagination, and each domain links to its Dynadot auction page.

This is the first product-shaped vertical slice. It proves one provider from API boundary through persistence to UI while preserving the architectural rule that normal page requests read D1 and never call Dynadot. Ahrefs Domain Rating and Majestic Topic remain visibly unavailable rather than fabricated. This plan does not add scheduled Cron execution, another auction provider, remote D1, deployment, bidding, Ahrefs calls, or Majestic calls.

## Progress

- [x] (2026-07-13 09:55Z) Re-read the repository architecture, product spec, ingestion design, and current Drizzle, Cloudflare D1, Dynadot, DropCatch, and shadcn guidance.
- [x] (2026-07-13 09:55Z) Probed provider APIs without printing credentials: DropCatch authenticated but returned zero auctions; Dynadot returned live expired-auction records and the expected field shape.
- [x] (2026-07-13 10:08Z) Defined the three-table Drizzle schema, generated and reviewed `0000_public_rhino.sql`, and proved repeatable local-D1 generation, checking, migration, and foreign-key behavior.
- [x] (2026-07-13 11:28Z) Implemented the bounded Dynadot response boundary, normalized listing model, segmented idempotent synchronization, server-owned continuation state, guarded reconciliation, and hardened local runner.
- [x] (2026-07-13 11:28Z) Completed two live local synchronizations; the latest stored 426,400 listings with 426,398 active, 2 inactive, no duplicates, no running runs, and clean foreign keys.
- [x] (2026-07-13 11:28Z) Replaced the harness card with the server-rendered D1 discovery table, URL-backed search/source/sort/pagination controls, outbound links, truthful metric gaps, and unit coverage.
- [x] (2026-07-13 11:48Z) Extended browser acceptance and durable guidance, added the provider-free isolated D1/workerd integration proof, passed final independent review, and started the verified inspection server on port 30001.

## Surprises & Discoveries

- Observation: A configured DropCatch token is not a durable credential.
  Evidence: The saved token returned HTTP 401, while the client ID and secret successfully issued a fresh token through `/authorize`.

- Observation: DropCatch's live V2 auctions endpoint currently supplies no inventory for this account.
  Evidence: A freshly authenticated `GET https://api.dropcatch.com/v2/auctions` returned HTTP 200 with `totalRecords: 0` and an empty `items` array.

- Observation: Dynadot's production API supplies the exact auction inventory needed for the first slice.
  Evidence: A read-only `get_open_auctions` request returned HTTP 200, status `success`, and live items containing auction ID, domain, auction type, price, currency, bids, bidders, start/end timestamps, links, visitors, age, appraisal, and renewal price.

- Observation: Dynadot API3 returns JSON with a `text/plain` content type.
  Evidence: The successful live response parsed as JSON but advertised `text/plain`, so the adapter must not reject it solely on media type.

- Observation: A generic `updated_at` listing column had no meaning distinct from the accepted first-seen and last-seen semantics.
  Evidence: The schema quality review caught the redundancy before data existed. The initial migration was regenerated without it and replayed against a fresh temporary D1 with no foreign-key violations.

- Observation: Wrangler's Node-side `getPlatformProxy()` did not provide a usable local runner in the available Node 25 environment.
  Evidence: The proxy initialization hung, while a short-lived loopback Wrangler worker reached the same local-only D1 binding and could be bounded and terminated reliably.

- Observation: A complete Dynadot inventory is too large for one practical workerd request.
  Evidence: A monolithic attempt exceeded the request-duration window. Twenty-page segments with D1-owned continuation completed the 427-page import.

- Observation: D1 enforces a 100-bound-parameter ceiling per statement in this local runtime.
  Evidence: Initial large multi-value upserts failed before writing. The first live imports used 40-domain and 4-listing batches; the hardened implementation now JSON-binds bounded batches of 100 domains and 25 listings, with exact running-run guards and one atomic D1 batch per fetched page.

- Observation: The live inventory is substantially larger than the initial 100-page safety guess.
  Evidence: Two successful complete runs each required 427 pages. The verified provider/service cap is now 1,000 pages rather than 100.

## Decision Log

- Decision: Implement Dynadot as the first auction source and defer DropCatch.
  Rationale: Dynadot returned live inventory and documents a paginated read-only command with the fields needed for a useful table. DropCatch authentication works but currently offers no rows to display.
  Date/Author: 2026-07-13 / Codex.

- Decision: Import Dynadot expired auctions through `get_open_auctions`, 1,000 records per page, sequentially until the provider returns a short page.
  Rationale: The official command supports at most 1,000 records per page and uses page indexes. A bounded sequential loop avoids guessed concurrency and provides a complete reconciliation signal.
  Date/Author: 2026-07-13 / Codex.

- Decision: Use a manual local sync command backed by a short-lived, loopback-only Wrangler worker in this plan.
  Rationale: `getPlatformProxy()` hung in the available Node 25 runtime. The local worker uses the same local-only D1 ID without exposing a public deployed route or deciding the future Cron shape, and segmented requests stay inside the observed workerd duration boundary.
  Date/Author: 2026-07-13 / Codex.

- Decision: Persist `next_page` and all continuation counters in `ingestion_runs`; the HTTP caller supplies only a run ID.
  Rationale: Server-owned continuation prevents forged counters or timestamps. Every mutation is guarded by run ID, provider, running state, and start time, and final reconciliation is batched atomically with successful completion.
  Date/Author: 2026-07-13 / Codex.

- Decision: Cap response bodies at 10 MiB, provider requests at 30 seconds, runner readiness at 30 seconds, and segment requests at 120 seconds.
  Rationale: Explicit bounds prevent indefinite network waits and unbounded parsing while accommodating the demonstrated 1,000-record page.
  Date/Author: 2026-07-13 / Codex.

- Decision: Store domains and auction listings separately, with normalized domain name identity and provider-plus-external-ID listing identity.
  Rationale: This enforces the accepted architecture and makes repeated provider pages idempotent. A listing can change price, bid count, and end time without creating another domain.
  Date/Author: 2026-07-13 / Codex.

- Decision: Show Ahrefs DR and Majestic Topic columns as unavailable values in this slice, without adding placeholder metrics.
  Rationale: Those fields are part of the desired comparison workflow, but no Majestic source exists and enrichment deserves its own verified provider slice. Displaying an em dash is truthful and keeps the table shape visible.
  Date/Author: 2026-07-13 / Codex.

## Outcomes & Retrospective

All four milestones are implemented. The schema has `domains`, `auction_listings`, and `ingestion_runs`; migration `0001_smooth_alex_wilder.sql` adds server-owned next-page state while preserving imported rows. The hardened adapter and ingestion service have fixed error boundaries, network/body/cardinality limits, exact-run guards on listing writes and state transitions, bounded D1 writes, and atomic success reconciliation. The runner isolates the provider key in a mode-0600 temporary file and cleans up on normal exit or handled signals.

Two complete live runs preceded the final hardening pass. The first fetched/upserted 426,328 records over 427 pages with no inactivation. The second fetched/upserted 426,398 over 427 pages and inactivated 2. The resulting local database has 426,400 domains and listings, 426,398 active and 2 inactive, with no duplicate identities, running ingestion rows, or foreign-key violations. No provider resync has been performed after hardening, so tests and provider-free local integration are the evidence for those changes.

The home page now queries local D1 and renders the real discovery UI with a domain substring search, source filter, allowlisted sortable headers, 50-row pagination, result counts, freshness, and Dynadot links. Majestic Topic and Ahrefs DR remain honest em dashes. Local migration replay, 94 unit tests at 100-percent configured coverage, the isolated real-D1 integration proof, workerd-backed browser acceptance, the standard build, and diff checks pass. Independent ingestion, UI, and final slice reviews approved the implementation. The inspection server returns HTTP 200 with a healthy D1 connection at `http://127.0.0.1:30001`.

## Context and Orientation

Run every repository command from `/Users/devin/dev/repos/auction-domain-aggregator-v4` unless a step explicitly creates an isolated temporary copy.

The completed harness is documented in `docs/plans/completed/bootstrap-application-harness.md`. It provides Next.js 16, OpenNext for Cloudflare Workers, a local-only D1 binding named `DB`, Drizzle ORM 0.44.7, shadcn-owned source, Vitest, Playwright, and CI. `src/server/db/client.ts` is the server-only database constructor. `src/app/page.tsx` now queries and renders the domain discovery page. `pnpm check` launches `pnpm preview` under Playwright and therefore applies local migrations and exercises workerd and local D1.

`ARCHITECTURE.md` requires all normal page reads to come from D1. `src/server/queries/domain-listings.ts` is the implemented read model and `src/components/domain-discovery.tsx` renders it. `docs/technical-design/data-ingestion.md` records the implemented manual-local runner, adapter, storage boundary, and reconciliation rules. `docs/product-specs/initial-domain-discovery.md` requires a table, source, Majestic Topic, Ahrefs DR, and an outbound auction link. The latter two metrics are not available in this slice and remain explicitly empty.

Dynadot's official API3 command is `GET https://api.dynadot.com/api3.json` with the API key and command parameters in the query string. The key must never appear in logs, errors, fixtures, or checked-in files. The production key is available to the local process as `DYNADOT_API_PRODUCTION_KEY`; source code accepts the key as an injected value and does not read `.env` directly. The package script may use Node's `--env-file=.env` so the process receives local configuration without printing it.

The manual runner starts `src/server/ingestion/local-worker.ts` on loopback, passes the API key in a mode-0600 temporary file, and gives the child an allowlisted environment. It processes 20 pages per request and resumes from D1-owned `ingestion_runs.next_page`. The official Dynadot auction URL for a domain is `https://www.dynadot.com/market/auction/<domain>`. The provider's ASCII `domain` field is the stored normalized identity; its `utf_name` is not used as a key.

## Plan of Work

### Milestone 1: Establish the first product schema and local migration workflow

Create `src/server/db/schema.ts` with `domains`, `auctionListings`, and `ingestionRuns`. A normalized domain name is the primary domain identity. An auction listing uses provider and external listing ID as a composite primary key and references its domain. Store only demonstrated mutable fields: type, URL, price in integer minor units, currency, bids, bidders, start/end time, age, inbound links, visitors, provider appraisal, renewal price, active status, and first/last-seen timestamps. Add indexes for active provider listings, domain lookup, end time, current price, and the demonstrated table sorts.

Create `drizzle.config.ts` for code-first SQLite generation without remote credentials. Configure the D1 binding to read migrations from `drizzle/`. Add scripts to generate migrations, check them, and apply them only to local D1 with dotenv loading disabled. Generate and inspect the initial SQL migration; do not hand-edit a generated snapshot to hide a schema mistake.

Update `getDb()` to initialize Drizzle with the schema while preserving the server-only boundary. `pnpm db:migrate:local` must be idempotent and must make the existing health route plus a direct table query succeed.

### Milestone 2: Normalize and synchronize Dynadot inventory

Add a provider adapter under `src/server/providers/dynadot/`. Runtime-validate the unknown JSON response before normalization. The network client receives `fetch` and an API key as dependencies, constructs the provider request without ever including the URL or key in thrown messages, and supports sequential page indexes. Pure normalization converts string prices to integer cents, provider timestamps to dates, hyphen/sentinel metric values to null, and constructs the authoritative auction URL.

Add an ingestion service under `src/server/ingestion/` that records a running ingestion row, fetches pages of 1,000 until the page is short, and upserts domains and listings in bounded batches. Every listing seen in the run receives the run start time as `lastSeenAt`. Only after all pages succeed may the service mark older active Dynadot listings inactive and mark the run successful. On a failed or partial request, prior rows remain readable and unseen listings remain active; the run becomes failed with a fixed, non-secret diagnostic code.

Add `scripts/sync-dynadot.ts` as the orchestrator for a short-lived, loopback-only Wrangler worker. The `sync:dynadot` package command applies local migrations, loads `.env` only into the orchestrator, passes the key through a mode-0600 temporary worker env file, executes bounded 20-page segments, and prints only counts and outcome. Persist continuation state in migration `0001_smooth_alex_wilder.sql`; accept only a run ID from the HTTP caller and guard all mutations against the matching running row. Tests use invented provider fixtures and injected fetch; they never call the live API.

At the end of this milestone, execute `pnpm sync:dynadot` once against the configured credentials. Record only fetched/upserted/inactivated counts and a D1 count query, not domain names or provider response bodies.

### Milestone 3: Render the first usable domain table

Add a server-only query module that selects only table fields from active listings, applies a normalized domain substring filter, optional source filter, an allowlisted sort key/direction, and bounded offset pagination. Return the page rows, total count, available sources, and most recent successful sync time. User-controlled query values must be Drizzle parameters or selected from allowlists, never interpolated SQL strings.

Replace the harness page with a server-rendered discovery page. Install only the shadcn primitives actually needed for a dense application table and filter form. Show domain, source, auction type, current bid, bid count, end time, age, Majestic Topic, and Ahrefs DR. Domain links open the provider page in a new tab. Provide a domain-search input, source selector, reset action, sortable header links, result count, sync recency, 50-row pages, previous/next navigation, responsive horizontal overflow, a useful empty state, and visible focus/labels. Do not add a dashboard shell, charts, accounts, saved searches, client-side table library, or fake metrics.

Pure query-parameter parsing, formatting, adapter parsing, and normalization remain in the 100-percent unit-coverage boundary. Component tests verify accessible controls and table semantics without depending on CSS classes.

### Milestone 4: Prove the complete slice and update durable guidance

Ensure preview and Playwright apply local migrations before the application starts. Extend the browser test to verify the discovery heading, filters, table headers, and health endpoint whether the clean test database has zero rows or existing local data. Add a focused integration check against a temporary local D1 database or workerd binding for migration/upsert/query behavior without contacting Dynadot.

Update `AGENTS.md` with the migration and sync commands. Update `ARCHITECTURE.md` with the actual schema/provider/ingestion/query paths while keeping durable boundaries concise. Update `docs/technical-design/data-ingestion.md` with the verified first-provider facts and manual-local status; do not claim Cron or remote deployment exists.

Run a frozen clean install, local migration, quick checks, full workerd-backed checks, standard build, and diff/secret/noise checks. The two completed live runs already prove repeatability; do not call the provider merely for harness validation. Restart the app on port 30001 so the owner can inspect the real table. After independent review passes, record final evidence and move this plan to `docs/plans/completed/dynadot-domain-table.md`.

## Concrete Steps

From `/Users/devin/dev/repos/auction-domain-aggregator-v4`, first preserve and inspect the current state:

    git status --short
    git diff --check
    pnpm check:quick

Generate the schema migration and apply it locally:

    pnpm db:generate
    pnpm db:check
    pnpm db:migrate:local

The local migration command must include `--local` and `--env-file /dev/null`. It must never contain `--remote`.

Run unit checks while implementing the provider boundary and ingestion service:

    pnpm check:quick

Import real inventory only after adapter fixtures and the local migration pass:

    pnpm sync:dynadot

Expected console output is a concise successful summary with pages and record counts. It must not print the key, request URL, authorization material, or raw response data.

Verify local D1 with a count-only query:

    pnpm exec wrangler d1 execute DB --local --env-file /dev/null --command "SELECT COUNT(*) AS count FROM auction_listings WHERE status = 'active'"

Run production-like acceptance:

    pnpm test:e2e
    pnpm check
    pnpm build
    git diff --check

Before completion, rebuild dependencies and prove the local state is reconstructible without reading ignored credentials during checks:

    rm -rf node_modules
    npm install --global corepack@0.34.0
    corepack enable
    pnpm install --frozen-lockfile
    pnpm db:migrate:local
    pnpm check

The live sync is intentionally separate from CI and clean-check commands because it requires a private provider key and mutates the developer's local D1 data.

## Validation and Acceptance

The plan is complete only when all of the following are observable:

1. The generated migration creates separate domain, auction-listing, and ingestion-run tables with declared primary/unique constraints, foreign key, and demonstrated indexes.
2. `pnpm db:migrate:local` applies only to local D1 and is safe to rerun.
3. Provider fixtures prove runtime rejection of malformed responses and correct normalization of money, timestamps, sentinel values, domain identity, and auction URL.
4. A failed partial synchronization records failure without marking unseen prior listings inactive.
5. Repeating the same successful fixture or live sync does not duplicate domains or provider listings.
6. A successful complete sync marks older unseen active Dynadot listings inactive only after every provider page succeeds.
7. `pnpm sync:dynadot` uses the configured production key without printing it and stores at least one real active listing in local D1.
8. Opening `/` reads D1 and displays a table with real Dynadot rows after the sync. No page request calls Dynadot.
9. Search, source filtering, allowlisted sorting, and bounded pagination operate through URL query parameters and server-side D1 queries.
10. Every displayed domain has an external Dynadot auction link. Majestic Topic and Ahrefs DR are visibly unavailable, never fabricated.
11. `pnpm check:quick`, `pnpm check`, `pnpm build`, migration checks, and `git diff --check` pass from the documented toolchain.
12. CI does not load provider secrets, call Dynadot, use remote D1, or deploy anything.
13. No tracked file or test fixture contains a real provider key, secret, raw authorization header, or copied `.env` value.
14. The app is running on `http://127.0.0.1:30001` at handoff and displays the imported table.

## Idempotence and Recovery

Migration generation is rerunnable only when the schema has changed; inspect generated SQL before accepting it. Applying an already-applied D1 migration is a no-op. If a migration fails, Wrangler rolls it back and reports the unapplied file; fix the schema or migration before retrying rather than deleting local D1 blindly.

The Dynadot sync is idempotent by domain identity and provider/external-listing identity. It may be interrupted and rerun. A failed run updates rows it actually saw but does not reconcile omissions, so prior active inventory remains visible. A later complete run repairs mutable fields and performs reconciliation. Never clear the database merely to recover from a provider or parser failure.

The local `.wrangler/` database is generated state and ignored. It may be removed only when the owner explicitly wants to discard local imported data; it is not removed by normal checks. Remote bindings remain disabled. No command in this plan creates or modifies a remote D1 database.

## Artifacts and Notes

Official evidence used by this plan:

- Dynadot API commands: `https://www.dynadot.com/domain/api-commands`, especially `get_open_auctions`.
- Dynadot expired-auction page and direct-link pattern: `https://www.dynadot.com/market/auction` and `/market/auction/<domain>`.
- Cloudflare Wrangler local development: `https://developers.cloudflare.com/workers/wrangler/commands/#dev`.
- Cloudflare D1 migration commands: `https://developers.cloudflare.com/d1/wrangler-commands/`.
- Drizzle code-first generation: `https://orm.drizzle.team/docs/drizzle-kit-generate`.

The provider probes intentionally recorded only HTTP status, response keys, and counts. DropCatch returned zero rows. Dynadot returned five rows when asked for a five-row page, proving live inventory without preserving domain names in repository artifacts.

Generated migrations under `drizzle/` are reviewed source and remain tracked. Local database files under `.wrangler/`, coverage, build output, and Playwright artifacts remain ignored.

Acceptance evidence on 2026-07-13: rerunning `pnpm db:migrate:local` reported no migrations to apply; `pnpm check` passed formatting, lint, type checking, 94 unit tests with 100-percent configured statement/branch/function/line coverage, the isolated real-D1 integration proof, and the workerd-backed browser test; `pnpm build` completed the dynamic home page and health route; `git diff --check` was clean. The provider-free integration applies migrations to disposable local D1, executes actual guarded upserts, proves stale rejection and reconciliation behavior, and exercises production filtering, sorting, and pagination. The browser test accepts both a populated local table and an honestly empty freshly migrated database and always checks `/api/health` through the preview runtime.

## Interfaces and Dependencies

The stable schema exports are `domains`, `auctionListings`, and `ingestionRuns` from `src/server/db/schema.ts`. `getDb()` remains the only application constructor for the request path.

The Dynadot adapter exposes a page-fetch interface accepting an API key, page index, page size, and injectable `fetch`, and returns normalized listings rather than provider JSON. Provider response types do not escape `src/server/providers/dynadot/`.

The ingestion service accepts a storage interface, a page-fetch function, an optional clock, and bounded page/segment options. The D1 adapter implements storage and the local worker reloads continuation state by run ID. A completed sync returns counts suitable for the local command without returning secrets or raw responses.

The table query accepts a validated object equivalent to:

    {
      query?: string;
      source?: 'dynadot';
      sort: 'domain' | 'source' | 'price' | 'bids' | 'endsAt' | 'age';
      direction: 'asc' | 'desc';
      page: number;
      pageSize: 50;
    }

Add only the runtime validation and TypeScript execution dependencies actually needed. Continue using Drizzle ORM 0.44.7 and Drizzle Kit 0.31.10. Add shadcn primitives through its CLI so their source remains owned under `src/components/ui/`.

Revision note (2026-07-13 / Codex): Created the plan after live read-only provider proofs. Updated it after Milestone 1 with the verified schema, generated migration, and removal of a redundant timestamp caught during review. Updated it after Milestones 2 and 3 with the two 427-page live-run counts, the D1 100-bind ceiling, workerd request-duration evidence, the Node 25 `getPlatformProxy()` hang, the segmented loopback runner, migration `0001` continuation state, security hardening, and the implemented D1 table UI. Completed it after exact-run listing guards, the isolated real-D1 integration proof, browser acceptance, durable-document updates, final independent approval, and the port-30001 handoff. It selects Dynadot for the first end-to-end data slice and explicitly defers metrics, scheduling, remote state, and additional providers.
