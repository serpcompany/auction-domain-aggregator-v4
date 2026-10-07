# Isolated verification

Status: Implemented

Last updated: 2026-10-07

Routine checks never read secrets, call a provider, use remote D1, or touch the owner's `apps/web/.wrangler` inventory. This leaf records how the D1 integration proof and the browser tests stay isolated. The commands are in `AGENTS.md`.

## D1 integration proof

`corepack pnpm test:integration` applies migrations to temporary persistence, exercises every predicate and sort against invented rows (including multi-label names and names with quotes and backslashes), proves that a successful Workflow sync rebuilds the facets and that 300 TLDs are all offered, terminates workerd, and removes its state. It also runs the Workflow orchestration against real local D1 and R2 with an invented zipped feed.

## Browser tests

Playwright's `webServer` runs `apps/web/scripts/e2e-server.ts` and waits for `/api/health`. The script builds OpenNext with `apps/web/wrangler.e2e.jsonc`, refuses a bundle that contains non-public env variables (as `preview` does), and moves the build to `apps/web/tmp/e2e/.open-next`, served through `apps/web/e2e/worker.ts`, which wraps it in the same application Worker as `apps/web/worker.ts` (`apps/web/src/lib/app-worker.ts`). The developer's own `.open-next` is set aside during the build and put back, so a test run never replaces it. The script then applies migrations to a fresh `tmp/e2e/state`, inserts 60 deterministic invented listings and rebuilds the facets as a successful sync would, and serves the build with `wrangler dev --env-file /dev/null`, which never loads `.dev.vars`. Playwright refuses to start when its port (8797, not Wrangler's commonly occupied 8787) is taken, and stops the server's process group when the run ends.

The browser build reads `.env*` files like any Next build, which is why it refuses a bundle with non-public values. Neither proof calls a provider, uses remote D1, or mutates `apps/web/.wrangler` and the owner's inventory.
