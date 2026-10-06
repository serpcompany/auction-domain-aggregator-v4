# Cloud ingestion: cron, Workflow, and R2-staged pages

## Purpose / Big Picture

Auction syncs currently run only from the owner's Mac: `corepack pnpm sync <provider>` starts a loopback-only Wrangler worker, and for GoDaddy a Node process downloads the 37 MB zip, extracts it with the system `unzip`, splits it with `stream-json`, and serves the pages on `127.0.0.1`. The owner decided on 2026-10-06 that syncs must not depend on that machine. The issue is serpcompany/auction-domain-aggregator-v4#42.

When this is done, an ingestion Worker owns the whole sync. A daily Cron Trigger starts one Cloudflare Workflow instance per implemented provider. For a file feed such as GoDaddy, a stage step streams the public zip with `fetch`, decompresses it with `DecompressionStream('deflate-raw')`, splits the `data` array into 1,000-record page files, and writes them to R2 under a per-instance prefix. Sync steps then run the existing provider-neutral `runSyncSegment`, and the GoDaddy adapter reads its pages from R2. Dynadot runs the same sync steps against its API. A final step deletes the staged pages. Workflow step durability and retries replace the loopback runner's HTTP continuation loop.

Everything is built and proved locally with Wrangler (local D1, R2, and Workflows). `corepack pnpm sync <provider>` still works for local development, but it now starts the same Workflow inside local `wrangler dev` instead of a loopback page server. Creating remote resources and deploying need explicit owner authorization and are out of scope (#15).

## Progress

- [x] (2026-10-06 09:20 JST) Read the issue, repository docs, and SERP standards; branched `issue-42-cloud-ingestion` from `origin/main`.
- [x] (2026-10-06 09:30 JST) Wrote the web-stream stage (`src/server/ingestion/feed-stage.ts`): zip local-header reader, byte-level JSON array scanner, and page writer. Checked it in Node against the real archive.
- [x] (2026-10-06 09:45 JST) Milestone 1 (proof of concept): measured staging the real archive into local R2 under `wrangler dev`. Gate passed; see Artifacts.
- [ ] Milestone 2: R2 page source and sink, GoDaddy adapter on a page-source abstraction, provider-sync Workflow, cron handler, Wrangler config.
- [ ] Milestone 3: `pnpm sync <provider>` drives the local Workflow; loopback worker, Node file-feed staging, and `stream-json` removed.
- [ ] Milestone 4: unit tests at 100% configured coverage, real-D1/R2 integration proof, browser acceptance.
- [ ] Milestone 5: one real local GoDaddy Workflow run into the worktree's own local D1/R2; documentation; PR.

## Surprises & Discoveries

- GoDaddy's CDN (CloudFront) answers `403` to a request without a `User-Agent`. Node's `fetch` sends one, but a Worker's `fetch` does not, so the stage sends a fixed `User-Agent`. `curl -A ''` reproduces the 403.
- workerd's `DecompressionStream('deflate-raw')` rejects any bytes after the end of the deflate data (`TypeError: Trailing bytes after end of compressed data`), and for small inputs it raises that error before emitting any output. An entry whose sizes are deferred to a data descriptor therefore cannot simply be decompressed until the download ends. The stage holds back the archive's last 256 KiB and reads the entry's compressed size from the central directory once the download ends. The real GoDaddy archive declares its sizes in the local header (flags `0x0000`, 37,317,617 compressed bytes), so it does not take that path.
- The feed is pretty-printed with CRLF line endings, so page files carry the original whitespace (447.6 MB of page bodies for 448.8 MB of JSON).
- The first scanner version lost an element's opening brace when the element began on the last byte of a decompressed chunk. Validating every staged page with `JSON.parse` against the real file found it; unit tests now feed documents one byte at a time.
- `wrangler dev` failed to start while another project's workerd held a default inspector port, so the runner passes an explicit `--inspector-port`.

## Decision Log

- 2026-10-06 (Claude): Hand-written byte-level scanner instead of a streaming JSON library. It needs no dependency, never decodes or materializes record objects (records are copied as raw bytes and parsed later, one page at a time, by the adapter), and costs about 1.6 s of CPU for the whole 450 MB document in workerd. Structural JSON characters are ASCII and never occur inside multi-byte UTF-8 sequences, so scanning bytes is safe. The scanner checks the outer document and string/bracket nesting only; a malformed record fails its page's `JSON.parse` in the adapter with `godaddy_parse_error`, which fails the run before reconciliation.
- 2026-10-06 (Claude): Gate decision: the stage step stays in a Worker Workflow step; no Container. Measured Worker CPU is about 3.2 s without R2 and at most 8.3 s with local R2 (simulated inside the same workerd process), against a configurable limit of up to 300,000 ms. The isolate's JS heap peaked at 10.3 MiB against 128 MB.
- 2026-10-06 (Claude): Only the zip local file header is read when it declares the compressed size, so the stage never needs a ranged request for the central directory.

## Outcomes & Retrospective

Milestone 1: the stage fits a Worker comfortably (Artifacts). Later milestones pending.

## Context and Orientation

Terms. A *Workflow* is a Cloudflare durable execution: a class whose `run(event, step)` calls `step.do(name, config, callback)`; each step's result is persisted, a failed step is retried by its own policy, and a restarted instance replays completed steps from storage instead of re-running them. A *Cron Trigger* calls a Worker's `scheduled()` handler on a schedule. *R2* is Cloudflare object storage. A *file feed* is a provider inventory published as one downloadable file instead of a paged API. *Local* means Wrangler's on-disk simulation under `.wrangler/state`, never a remote resource.

Relevant files before this work:

- `src/server/ingestion/sync.ts`: provider-neutral `runSyncSegment(adapter, storage, options)`; unchanged by this plan.
- `src/server/ingestion/d1-storage.ts`: provider-bound D1 writes, reconciliation guard; unchanged.
- `src/server/providers/registry.ts`: provider secrets, optional `fileFeed`, adapter factory.
- `src/server/providers/godaddy/index.ts`: page envelope and record validation; read pages over loopback HTTP.
- `src/server/ingestion/local-worker.ts` (`POST /sync/<provider>`), `src/server/ingestion/file-feed.ts` (Node staging), `scripts/sync-provider.ts` (runner), `wrangler.ingestion.jsonc`.
- `src/server/ingestion/integration-worker.ts` and `scripts/test-d1-integration.ts`: the real local D1 proof.

## Plan of Work

Milestone 1 (proof of concept, done). Write `feed-stage.ts` with only web-platform APIs and measure it in local workerd with a scratch Worker that stages the real archive into a local R2 bucket. Success: the whole archive stages with Worker CPU well under 300,000 ms and memory well under 128 MB. Discard: if not, stage in a Cloudflare Container instead and keep only the sync steps in the Workflow. The scratch harness stays outside the repository.

Milestone 2. Add `src/server/ingestion/feed-pages.ts` (R2 page sink, page source, and prefix cleanup) and a `FeedPageSource` type in `src/server/providers/types.ts`. Change `createGodaddyAdapter` to read pages from a `FeedPageSource`. Change the registry factory to receive `{ secrets, feedPages }`. Add `src/server/ingestion/provider-sync-workflow.ts`, which holds the testable orchestration (`runProviderSync` and `scheduleProviderSyncs`), and `src/server/ingestion/sync-worker.ts`, a thin entry exporting the `ProviderSyncWorkflow` class and a `scheduled()` handler. Point `wrangler.ingestion.jsonc` at it with R2, Workflow, cron, and CPU-limit settings.

Milestone 3. Rewrite `scripts/sync-provider.ts` to start `wrangler dev` for the ingestion config, create a Workflow instance through Wrangler's local explorer API, and poll it to completion. Delete `local-worker.ts`, `file-feed.ts`, their tests, and the `stream-json` dependency.

Milestone 4. Unit-test every new module, extend the integration proof with a real local D1 and R2 run of the Workflow orchestration against an invented zipped feed, and run the browser acceptance.

Milestone 5. Run `corepack pnpm sync godaddy` for real in this worktree, record counts and timings, update `ARCHITECTURE.md`, `docs/technical-design/data-ingestion.md`, `docs/technical-design/technology-stack.md`, and `AGENTS.md`, then open the PR.

## Concrete Steps

From the worktree root:

    corepack pnpm check:quick
    corepack pnpm test:integration
    corepack pnpm test:e2e
    corepack pnpm sync godaddy

## Validation and Acceptance

- The real local GoDaddy Workflow run succeeds and loads about 587,000 listings with few or no rejections, and the R2 prefix is empty afterwards.
- The integration proof stages an invented zipped feed into local R2, syncs it into local D1 through the same orchestration, and leaves no staged pages.
- A failed stage or sync step still deletes the staged pages and does not reconcile listings.

## Idempotence and Recovery

Each Workflow instance stages under `feed-pages/<provider>/<instance id>/`, so concurrent or retried instances never share pages. A retried stage step rewrites the same keys. A retried sync step resumes from the server-owned `next_page` in D1. A sync error marks the run failed and is not retried within the instance; the next scheduled instance starts a fresh run. If the cleanup step itself fails, pages remain under that instance's prefix; a bucket lifecycle rule (deploy-time) bounds that.

## Artifacts and Notes

Proof of concept, 2026-10-06, owner's Mac (Apple Silicon), Wrangler 4.110.0, workerd 1.20260708.1, the 2026-10-05 feed build (37,317,859-byte zip, 448,795,757-byte JSON, 586,958 records). The scratch Worker called the production `stageZippedFeed` with a sink that writes each page to a local R2 binding. CPU is the summed CPU time of the `wrangler dev` workerd processes, which also host the local R2 simulation; heap is V8 `Runtime.getHeapUsage` sampled every 50 ms through the inspector.

| Variant | Wall | workerd CPU |
| --- | --- | --- |
| Download only (count bytes) | 6.8 s | 0.28 s |
| Download and inflate | 7.0 s | 1.55 s |
| Download, inflate, scan, build 587 pages (no sink) | 5.0 s | 3.18 s |
| Full stage into local R2, three runs | 10.8 / 11.0 / 15.5 s | 8.13 / 8.11 / 8.33 s |
| Full stage, again | 9.6 s | 7.83 s |

Result: 587 pages, 586,958 records, 587 R2 objects, last page marked `isLastPage` with 958 records. Peak isolate JS heap during a full stage: 10.3 MiB. The same code in Node 22 used 1.5 s of CPU (2.4 s when every page was also `JSON.parse`d to validate it) and a 206 MiB process RSS. Local workerd does not enforce `limits.cpu_ms`, so the deployed limit is inferred from these numbers, not proven.

## Interfaces and Dependencies

No new runtime dependencies; `stream-json` is removed.

    stageZippedFeed({ url, entry, field, pageSize, maxArchiveBytes, maxDocumentBytes, timeoutMs, sink, fetchImpl? }): Promise<{ pages; records }>
    type FeedPageSink = (page: number, body: Uint8Array) => Promise<void>;

Revision note (2026-10-06, Claude): Initial plan, written after the proof of concept with its measurements.
