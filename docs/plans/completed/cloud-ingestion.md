# Cloud ingestion: cron, Workflow, and R2-staged pages

## Purpose / Big Picture

Auction syncs ran only from the owner's Mac: `corepack pnpm sync <provider>` started a loopback-only Wrangler worker, and for GoDaddy a Node process downloaded the 37 MB zip, extracted it with the system `unzip`, split it with `stream-json`, and served the pages on `127.0.0.1`. The owner decided on 2026-10-06 that syncs must not depend on that machine. The issue is serpcompany/auction-domain-aggregator-v4#42.

Now an ingestion Worker owns the whole sync. A daily Cron Trigger starts one Cloudflare Workflow instance per implemented provider. For a file feed such as GoDaddy, a stage step streams the public zip with `fetch`, decompresses it with `DecompressionStream('deflate-raw')`, splits the `data` array into 1,000-record page files, and writes them to R2 under a per-instance prefix. Sync steps run the existing provider-neutral `runSyncSegment`, and the GoDaddy adapter reads its pages from R2. Dynadot runs the same sync steps against its API. A final step deletes the staged pages. Workflow step durability and retries replace the loopback runner's HTTP continuation loop.

Everything is built and proved locally with Wrangler (local D1, R2, and Workflows). `corepack pnpm sync <provider>` still works for local development; it starts the same Workflow inside a temporary local `wrangler dev`. Creating remote resources and deploying need explicit owner authorization and are out of scope (#15).

## Progress

- [x] (2026-10-06 09:20 JST) Read the issue, repository docs, and SERP standards; branched `issue-42-cloud-ingestion` from `origin/main`.
- [x] (2026-10-06 09:30 JST) Wrote the web-stream stage (`src/server/ingestion/feed-stage.ts`): zip local-header reader, byte-level JSON array scanner, and page writer. Checked it in Node against the real archive.
- [x] (2026-10-06 09:45 JST) Milestone 1 (proof of concept): measured staging the real archive into local R2 under `wrangler dev`. Gate passed; see Artifacts.
- [x] (2026-10-06 09:55 JST) Milestone 2: R2 page sink, source, and cleanup; GoDaddy adapter on `FeedPageSource`; registry context; `provider-sync-workflow.ts`; thin `sync-worker.ts`; `wrangler.ingestion.jsonc` with R2, Workflow, cron, and `limits.cpu_ms`. A first local GoDaddy Workflow run succeeded.
- [x] (2026-10-06 10:00 JST) Milestone 3: `scripts/sync-provider.ts` drives the local Workflow through Wrangler's explorer API; `local-worker.ts`, `file-feed.ts`, their tests, and `stream-json` removed.
- [x] (2026-10-06 10:15 JST) Milestone 4: 100% configured unit coverage (237 tests), real local D1 and R2 integration proof (`cloudFeedProof`), browser acceptance (4 passed).
- [x] (2026-10-06 10:20 JST) Milestone 5: real `corepack pnpm sync godaddy` into this worktree's own local D1 and R2; cron-triggered run in scratch state; documentation; plan completed.

## Surprises & Discoveries

- GoDaddy's CDN (CloudFront) answers `403` to a request without a `User-Agent`. Node's `fetch` sends one, but a Worker's `fetch` does not, so the stage sends a fixed `User-Agent`. `curl -A ''` reproduces the 403.
- workerd's `DecompressionStream('deflate-raw')` rejects any bytes after the end of the deflate data (`TypeError: Trailing bytes after end of compressed data`), and for small inputs it raises that error before emitting any output. An entry whose sizes are deferred to a data descriptor therefore cannot be decompressed until the download ends. The stage holds back the archive's last 256 KiB and reads the entry's compressed size from the central directory when the download ends. The real GoDaddy archive declares its sizes in the local header (flags `0x0000`, 37,317,617 compressed bytes), so it does not take that path; the integration proof does.
- The feed is pretty-printed with CRLF line endings, so page files carry the original whitespace (447.6 MB of page bodies for 448.8 MB of JSON).
- The first scanner version lost an element's opening brace when the element began on the last byte of a decompressed chunk. Validating every staged page with `JSON.parse` against the real file found it; unit tests now feed documents one byte at a time.
- `wrangler dev` failed to start while another project's workerd held a default inspector port, so the runner passes an explicit `--inspector-port` (9330).
- A `NonRetryableError` thrown from `run` outside a step ends the instance with the generic message `The execution of the Workflow instance was terminated, as a step threw an NonRetryableError and it was not handled`. Pre-step validation therefore throws a plain `Error(code)`, which becomes the instance error unchanged.
- Inside `run`, `step.do` rejects a step that threw `NonRetryableError(code)` with an `Error` whose message is `NonRetryableError: <code>`; a step that exhausted its retries rejects with its own message. Found with a scratch probe Workflow; `fixedErrorCode` accepts both shapes, and the unit-test step runner reproduces the wrapping.
- With Wrangler 4.110 local Workflows, reading one instance through the explorer API waits until that instance finishes (79 s measured), creating an instance waited while another instance ran, and listing instances answered instantly in the sync phase but waited 100 s or more at other times. The first real `pnpm sync godaddy` failed with `sync_runner_timeout` because of the runner's 10-second request timeout. The runner now polls the list with a 60-second timeout, retries slow answers until its 30-minute deadline, fails fast if `wrangler dev` exits, and gives the create call 15 minutes.
- `wrangler dev` reloads the Worker when an imported source file changes, and a reload orphans a running local instance (it stays `running` and is not resumed). Two runs were lost this way while editing; the runner documentation warns against editing `src/` during a sync.
- Because local instance creation waited for the running instance, two overlapping instances of the same provider could not be exercised locally. The interrupt-older-run behavior is proved at the storage level by the existing integration proof (`staleRejected`).
- The macOS shell used here has `noclobber`, so `>` did not overwrite earlier logs; evidence logs were rewritten with `>|`.

## Decision Log

- 2026-10-06 (Claude): Hand-written byte-level scanner instead of a streaming JSON library. It needs no dependency, never decodes or materializes record objects (records are copied as raw bytes and parsed later, one page at a time, by the adapter), and costs about 1.6 s of CPU for the whole 450 MB document in workerd. JSON's structural characters are ASCII and never occur inside multi-byte UTF-8 sequences, so scanning bytes is safe. The scanner checks the outer document and string and bracket nesting only; a malformed record fails its page's `JSON.parse` in the adapter with `godaddy_parse_error`, which fails the run before reconciliation.
- 2026-10-06 (Claude): Gate decision: the stage step stays in a Worker Workflow step; no Container. Measured Worker CPU is about 3.2 s without R2 and at most 8.3 s with local R2 (simulated inside the same workerd process), against a configurable limit of up to 300,000 ms. The isolate's JS heap peaked at 10.3 MiB against 128 MB. `limits.cpu_ms` is set to 60,000: about seven times the worst local figure, leaving room for slower edge CPUs without allowing a runaway step five minutes of billed CPU.
- 2026-10-06 (Claude): Only the zip local file header is read when it declares the compressed size, so the stage never needs a ranged request for the central directory.
- 2026-10-06 (Claude): One `provider-sync` Workflow class with a `{ provider }` parameter, started by a Worker `scheduled()` handler (`triggers.crons`), rather than per-provider classes with Workflow `schedules`. Workflow schedules carry no parameters, and the handler can name instances from the scheduled time (`<provider>-<yyyymmdd>T<hhmm>`), so a repeated cron delivery cannot start a duplicate. The handler is also testable locally with `/cdn-cgi/handler/scheduled`.
- 2026-10-06 (Claude): The orchestration (`runProviderSync`, `scheduleProviderSyncs`) takes its step runner, bindings, and `NonRetryableError` factory as arguments and is unit-tested; `sync-worker.ts` only adapts the runtime and is proved by real local runs.
- 2026-10-06 (Claude): Sync segments stay at 20 pages per step (as in the loopback runner): GoDaddy needs 30 steps, far below the 10,000-step limit, and an interrupted step repeats at most 20 pages.
- 2026-10-06 (Claude): A sync error is non-retryable within the instance because `runSyncSegment` has already marked the run failed; retrying would only hit `sync_stale_continuation`. Platform interruptions are still retried (twice) and resume from D1's `next_page`. Feed download and extraction failures are retried twice; malformed, empty, or oversized feeds are not.
- 2026-10-06 (Claude): Staged pages are deleted after failure as well as success. A cleanup failure fails an otherwise successful instance (with its code) but never replaces the code of a failed sync. A deploy should add an R2 lifecycle rule as a backstop.
- 2026-10-06 (Claude): The ingestion Wrangler configuration keeps its existing name and stays local-only at the top level, per the SERP environment-configuration standard; no remote IDs were invented. `docs/technical-design/data-ingestion.md` lists what a deploy needs.

## Outcomes & Retrospective

Achieved:

- A cron-started Workflow per provider runs the whole sync in Cloudflare primitives (Worker, Workflow, R2, D1). Nothing depends on the owner's machine except the optional local runner.
- Real local GoDaddy runs: `corepack pnpm sync godaddy` into this worktree's own fresh local D1 and R2 succeeded in 149 s end to end (migrations, Wrangler start, download, stage, 30 sync steps, cleanup): 587 pages, 586,958 fetched and upserted, 0 rejected, 0 inactivated; local D1 then held 586,958 active GoDaddy listings, 586,958 `domain_seo_metrics` rows, and one succeeded `ingestion_runs` row; the R2 bucket held 0 objects. The cron path (`/cdn-cgi/handler/scheduled` in a scratch session) created `godaddy-20261006T0108` and `dynadot-20261006T0108`; the GoDaddy instance synced the full feed in 81 s, and the Dynadot instance ended immediately with `dynadot_missing_credentials` (no key was loaded). A run against unmigrated scratch D1 staged the feed, failed its first sync step non-retryably with `sync_failed`, and still deleted all 587 pages.
- `stream-json`, the system `unzip` requirement, the loopback page server, and the loopback worker are gone.

Remaining:

- Deployment (#15): remote D1, an R2 bucket with a lifecycle rule, the Dynadot secret, a named Wrangler environment, and Workers Paid. `limits.cpu_ms` is inferred from local measurements; the first deployed run should confirm the stage step's CPU time in Workers observability.
- The Dynadot path through the Workflow is proved with provider-free tests only; no live Dynadot call was made.
- A stage failure is recorded only on the Workflow instance, not in `ingestion_runs`, because the run row starts with the first sync step (as before).
- Local `wrangler dev` reloads orphan running instances; the runner can only warn.

## Context and Orientation

Terms. A *Workflow* is a Cloudflare durable execution: a class whose `run(event, step)` calls `step.do(name, config, callback)`; each step's result is persisted, a failed step is retried by its own policy, and a restarted instance replays completed steps from storage instead of re-running them. A *Cron Trigger* calls a Worker's `scheduled()` handler on a schedule. *R2* is Cloudflare object storage. A *file feed* is a provider inventory published as one downloadable file instead of a paged API. *Local* means Wrangler's on-disk simulation under `.wrangler/state`, never a remote resource.

Files after this work:

- `src/server/ingestion/sync-worker.ts`: Worker entry; `ProviderSyncWorkflow` and `scheduled()`.
- `src/server/ingestion/provider-sync-workflow.ts`: `runProviderSync`, `scheduleProviderSyncs`, step configurations, `fixedErrorCode`.
- `src/server/ingestion/feed-stage.ts`: zip entry, scanner, page writer, `stageZippedFeed`.
- `src/server/ingestion/feed-pages.ts`: R2 page keys, sink, source, cleanup.
- `src/server/ingestion/zip-fixture.ts`: test-only zip builder used by unit tests and the integration proof.
- `src/server/providers/godaddy/index.ts`: reads pages from a `FeedPageSource`.
- `src/server/providers/registry.ts`: `fileFeed` (`url`, `entry`, `field`, `pageSize`) and `createAdapter({ secrets, feedPages })`.
- `scripts/sync-provider.ts`: local runner for the Workflow.
- `wrangler.ingestion.jsonc`, `wrangler.integration.jsonc`: local D1 plus R2 (and, for ingestion, Workflow, cron, CPU limit).
- Unchanged: `src/server/ingestion/sync.ts`, `src/server/ingestion/d1-storage.ts`, Dynadot validation, the reconciliation guard.

## Plan of Work

Milestone 1 (proof of concept). Write `feed-stage.ts` with only web-platform APIs and measure it in local workerd with a scratch Worker that stages the real archive into a local R2 bucket. Success: the whole archive stages with Worker CPU well under 300,000 ms and memory well under 128 MB. Discard: if not, stage in a Cloudflare Container instead and keep only the sync steps in the Workflow. The scratch harness stayed outside the repository.

Milestone 2. Add the R2 page module and `FeedPageSource`, move the GoDaddy adapter onto it, add the orchestration module and thin Worker entry, and configure `wrangler.ingestion.jsonc`.

Milestone 3. Rewrite the local runner around the explorer API and delete the loopback worker, Node staging, and `stream-json`.

Milestone 4. Unit-test every new module, extend the integration proof with a real local D1 and R2 run of the orchestration against an invented zipped feed, and run the browser acceptance.

Milestone 5. Run `corepack pnpm sync godaddy` for real, record evidence, update documentation, open the PR.

## Concrete Steps

From the worktree root:

    corepack pnpm check:quick          # 237 tests, 100% configured coverage
    corepack pnpm test:integration     # {"status":"succeeded",...,"cloudFeedProof":true}
    corepack pnpm test:e2e             # 4 passed
    corepack pnpm sync godaddy         # {"provider":"godaddy","status":"succeeded","pagesFetched":587,...}

To exercise the cron path locally, start `corepack pnpm exec wrangler dev --config wrangler.ingestion.jsonc --local --ip 127.0.0.1 --port 8790 --inspector-port 9330` (after `corepack pnpm db:migrate:local`) and run `curl "http://127.0.0.1:8790/cdn-cgi/handler/scheduled"`; instances appear at `http://127.0.0.1:8790/cdn-cgi/explorer/api/workflows/provider-sync/instances`.

## Validation and Acceptance

- The real local GoDaddy Workflow run succeeds, loads 586,958 listings with 0 rejections, and leaves the R2 bucket empty: met.
- The integration proof stages an invented zipped feed (data-descriptor layout) into local R2, syncs it into local D1 through the same orchestration, deletes the pages, and contains a failing run (failed `ingestion_runs` row with `godaddy_response_error` on page 1, no reconciliation, pages deleted): met.
- A failed stage or sync step still deletes the staged pages and does not reconcile listings: met in unit tests, the integration proof, and the unmigrated-D1 run.

## Idempotence and Recovery

Each Workflow instance stages under `feed-pages/<provider>/<instance id>/`, so instances never share pages. A retried stage step rewrites the same keys. A retried sync step resumes from the server-owned `next_page` in D1. A sync error marks the run failed and is not retried within the instance; the next scheduled instance starts a fresh run, which also marks any abandoned run interrupted. If the cleanup step itself fails, pages remain under that instance's prefix; a bucket lifecycle rule (deploy-time) bounds that. Locally, deleting `.wrangler/` resets D1, R2, and Workflow state.

## Artifacts and Notes

Proof of concept, 2026-10-06, owner's Mac (Apple Silicon), Wrangler 4.110.0, workerd 1.20260708.1, the 2026-10-05 feed build (37,317,859-byte zip, 448,795,757-byte JSON, 586,958 records). A scratch Worker called the production `stageZippedFeed` with a sink that writes each page to a local R2 binding. CPU is the summed CPU time of the `wrangler dev` workerd processes, which also host the local R2 simulation; heap is V8 `Runtime.getHeapUsage` sampled every 50 ms through the inspector.

| Variant | Wall | workerd CPU |
| --- | --- | --- |
| Download only (count bytes) | 6.8 s | 0.28 s |
| Download and inflate | 7.0 s | 1.55 s |
| Download, inflate, scan, build 587 pages (no sink) | 5.0 s | 3.18 s |
| Full stage into local R2, three runs | 10.8 / 11.0 / 15.5 s | 8.13 / 8.11 / 8.33 s |
| Full stage, again | 9.6 s | 7.83 s |

Result: 587 pages, 586,958 records, 587 R2 objects, last page marked `isLastPage` with 958 records. Peak isolate JS heap during a full stage: 10.3 MiB. The same code in Node 22 used 1.5 s of CPU (2.4 s when every page was also `JSON.parse`d to validate it) and a 206 MiB process RSS. Local workerd does not enforce `limits.cpu_ms`, so the deployed limit is inferred from these numbers, not proven.

Workflow runs (local, same feed build):

| Run | State | Stage step | Total | Result |
| --- | --- | --- | --- | --- |
| First Workflow run (`godaddy-explore-1`) | scratch, empty | 8.4 s | 2 min 28 s | 586,958 upserted, 0 rejected, 587 pages deleted |
| Manual repeat (`godaddy-manual-c`) | scratch, populated | 12.4 s | 2 min 39 s | same, 0 inactivated |
| Cron (`godaddy-20261006T0108`) | scratch, populated | about 9 s | 81 s | same, 0 inactivated |
| Unmigrated D1 (`godaddy-nomigrate`) | scratch, no tables | 9 s | about 12 s | `sync_failed` on segment 1; 587 pages deleted |
| `corepack pnpm sync godaddy` | this worktree, fresh | not separately timed | 149 s including migrations and startup | 586,958 upserted, 0 rejected; D1 586,958 active, 586,958 metrics rows; R2 0 objects |

Peak summed RSS of the worktree's workerd processes during the real run: 509 MiB (process memory including local D1 and R2 simulation; the isolate heap is the 10 MiB figure above).

## Interfaces and Dependencies

No new runtime dependencies; `stream-json` is removed.

    stageZippedFeed({ url, entry, field, pageSize, maxArchiveBytes, maxDocumentBytes, timeoutMs, sink, fetchImpl? }): Promise<{ pages; records }>
    type FeedPageSink = (page: number, body: Uint8Array) => Promise<void>;
    type FeedPageSource = { readPage(page: number, maxBytes: number): Promise<string | null> };
    createGodaddyAdapter({ pages: FeedPageSource | undefined }): ProviderAdapter
    runProviderSync({ provider, runKey, env, step, nonRetryable, dependencies? }): Promise<SyncSummary>
    scheduleProviderSyncs(workflow, scheduledTime): Promise<string[]>

Bindings (`wrangler.ingestion.jsonc`): `DB` (D1), `FEED_PAGES` (R2), `PROVIDER_SYNC` (Workflow `provider-sync`, class `ProviderSyncWorkflow`), `triggers.crons` `30 15 * * *`, `limits.cpu_ms` 60,000; secret `DYNADOT_API_PRODUCTION_KEY`.

Revision note (2026-10-06, Claude): Initial plan written after the proof of concept with its measurements. Updated the same day with the implementation, the Workflows error-shape and explorer-API discoveries, the real local runs, and moved to `completed/`.
