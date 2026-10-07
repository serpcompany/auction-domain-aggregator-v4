# Cloud ingestion: cron, Workflow, and R2-staged pages

Completed 2026-10-06 (Claude) for #42. This is the outcome summary; the full ExecPlan, with its proof-of-concept tables and step-by-step log, is in git history (`git show 907d382:docs/plans/completed/cloud-ingestion.md`).

## Outcome

Syncs had run only from the owner's Mac: a loopback Wrangler worker, and for GoDaddy a Node process using the system `unzip` and `stream-json`. The owner decided that syncs must not depend on that machine. Now an ingestion Worker owns the whole sync:

- A daily Cron Trigger starts one `provider-sync` Workflow instance per provider.
- For a file feed, a stage step streams the zip with `fetch`, inflates it with `DecompressionStream('deflate-raw')`, splits the `data` array into 1,000-record page files, and writes them to R2 under a per-instance prefix.
- Sync steps run the unchanged provider-neutral `runSyncSegment`, 20 pages per step, and a final step deletes the staged pages.
- `corepack pnpm sync <provider>` runs the same Workflow inside a temporary local `wrangler dev`.

`stream-json`, the `unzip` requirement, the loopback page server, and the loopback worker were removed. Deployment was out of scope; it came later ([Deployment](../../technical-design/deployment.md)).

## Key decisions

- **A hand-written byte-level scanner,** not a streaming JSON library. It needs no dependency, copies records as raw bytes (the adapter parses each page later), and cost about 1.6 s of CPU for the 450 MB document in workerd. JSON's structural characters are ASCII and never occur inside multi-byte UTF-8, so scanning bytes is safe. A malformed record fails its page's `JSON.parse` with `godaddy_parse_error`, before reconciliation.
- **A Workflow step, no Container.** Staging measured about 3.2 s of Worker CPU without R2 and at most 8.3 s with local R2, with a 10.3 MiB peak JS heap. `limits.cpu_ms` is 60,000, about seven times the worst local figure, without allowing a runaway step five minutes of billed CPU.
- **Read only the zip local header** when it declares the compressed size, so no ranged request for the central directory is needed.
- **One Workflow class with a `{ provider }` parameter,** started by a `scheduled()` handler rather than Workflow `schedules`, which carry no parameters. Instance IDs come from the scheduled time (`<provider>-<yyyymmdd>T<hhmm>`), so a repeated cron delivery cannot start a duplicate.
- **Orchestration takes its step runner, bindings, and `NonRetryableError` as arguments,** so it is unit-tested; `sync-worker.ts` only adapts the runtime.
- **20 pages per step:** GoDaddy needs about 30 steps, far below the 10,000-step limit, and an interrupted step repeats at most 20 pages.
- **Staged pages are deleted after failure as well as success.** A cleanup failure fails an otherwise successful instance, but never replaces a failed sync's code. An R2 lifecycle rule is the backstop.
- **The ingestion Wrangler configuration stays local-only at its top level** (SERP environment-configuration standard), with no invented remote IDs.

The retry policy has since been refined (transient provider and storage errors are retried); [Data ingestion](../../technical-design/data-ingestion.md) has the current rules.

## Discoveries

- GoDaddy's CDN answers 403 without a `User-Agent`, and a Worker's `fetch` sends none, so the stage sends a fixed one.
- workerd's `DecompressionStream('deflate-raw')` rejects any bytes after the deflate data, so an entry whose sizes are in a data descriptor waits for the download to end. The stage holds back the last 256 KiB and reads the size from the central directory. The real archive declares its sizes in the local header.
- The first scanner lost an element's opening brace when it began on a chunk's last byte. Validating every staged page against the real file found it; unit tests now feed documents one byte at a time.
- A `NonRetryableError` thrown outside a step ends the instance with a generic message, so pre-step validation throws a plain `Error(code)`. `step.do` rejects a non-retryable step as `NonRetryableError: <code>`; `fixedErrorCode` accepts both shapes.
- With Wrangler 4.110 local Workflows, reading one instance through the explorer API waits until it finishes, so the runner polls the instance list instead, with long timeouts.
- `wrangler dev` reloads on source edits and orphans a running local instance. `--inspector-port 9330` avoids clashing with another project's workerd.

## Evidence

The 2026-10-05 GoDaddy feed build (37 MB zip, 449 MB JSON, 586,958 records), Wrangler 4.110.0, local D1 and R2:

- Full stage into local R2: 9.6 to 15.5 s wall time, 7.8 to 8.3 s CPU, 587 pages; Node 22 took 1.5 s of CPU for the same code.
- First Workflow run: stage step 8.4 s, total about 2.5 minutes, 586,958 upserted, 0 rejected, all 587 pages deleted. The cron-started instance synced the full feed in 81 s.
- `corepack pnpm sync godaddy` into a fresh local D1: 149 s end to end, 586,958 active listings and metrics rows, R2 empty afterwards.
- A run against unmigrated D1 failed its first sync step with `sync_failed` and still deleted all 587 pages.
- `pnpm check`: 237 unit tests at 100 percent configured coverage, the integration proof with a staged invented zip, and 4 browser tests.

## Follow-ups at completion

- Deployment (#15): done since; see [Deployment](../../technical-design/deployment.md). Local workerd does not enforce `limits.cpu_ms`, so the deployed stage step's CPU time should be confirmed in Workers observability.
- A stage failure is recorded only on the Workflow instance, not in `ingestion_runs`, because the run row starts with the first sync step.
- Local `wrangler dev` reloads orphan running instances; the runner can only warn.
