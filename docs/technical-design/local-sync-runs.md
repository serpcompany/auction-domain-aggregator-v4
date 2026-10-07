# Local sync runs

Status: Implemented

Last updated: 2026-10-07

How `corepack pnpm sync <provider>` runs the production Workflow code on the owner's machine, and how it keeps credentials out of the Worker bundle and the repository. The Workflow itself is in [Data ingestion](data-ingestion.md).

## The runner

`corepack pnpm sync <provider>` (alias `pnpm sync:dynadot`) applies local migrations, then `apps/web/scripts/sync-provider.ts` starts a temporary `wrangler dev` of the ingestion Worker on `127.0.0.1:8790` (inspector `9330`) with local D1, R2, and Workflows, creates a `provider-sync` instance named `<provider>-manual-<ms>` through Wrangler's local-only explorer API (`/cdn-cgi/explorer/api/workflows/...`), polls it every 2 seconds for up to 30 minutes, and prints the summary or the instance's fixed error code. It drives the same Workflow code as the Cron Trigger. `curl "http://127.0.0.1:8790/cdn-cgi/handler/scheduled"` against a running local session fires the Cron Trigger path.

## Credentials

The runner loads `.secrets/providers.env`, when it exists, only into the Node process; GoDaddy and Namecheap need no secrets, and Dynadot fails with `dynadot_missing_credentials` without it. Credentials are never kept in `.env*` files, because OpenNext inlines those into the Worker bundle at build time. The child Wrangler process receives an explicit allowlist of ordinary process variables, not the parent's entire environment, and only that provider's registered secrets through a mode-0600 temporary env file outside the repository. Normal exit, `SIGINT`, and `SIGTERM` terminate the child process group and remove that directory.

## Do not edit source during a run

`wrangler dev` reloads the Worker when an imported source file changes. A reload while an instance is running orphans it locally (it stays `running` and is not resumed), so do not edit `apps/web/src/` during a local sync; the runner then times out with `sync_runner_timeout`, and the next run interrupts the orphaned run. Staged pages of an orphaned instance stay in the local bucket under its prefix.
