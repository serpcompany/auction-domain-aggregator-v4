# Isolated verification

Status: Implemented

Last updated: 2026-10-07

Routine checks never read secrets, call a provider, use remote D1, or touch the owner's `apps/web/.wrangler` inventory. This leaf records how the workerd D1 tests and the browser tests stay isolated. The commands are in `AGENTS.md`.

## Workerd D1 tests

`*.workers.test.ts` run in workerd through `@cloudflare/vitest-plugin`, as the `workers` project of `apps/web/vitest.config.mts`, inside `corepack pnpm test`. They use the bindings and compatibility settings of `apps/web/wrangler.ingestion.jsonc`, held in memory: nothing is written to `.wrangler`. Before every test, `apps/web/vitest.workers-setup.ts` empties D1 and R2 (`reset()`) and applies the migrations from `apps/web/drizzle/`. The tests exercise every predicate and sort against invented rows (including multi-label names and names with quotes and backslashes), D1 storage and reconciliation, DR claims, and Sync status. They prove that a successful Workflow sync rebuilds the facets and that 300 TLDs are all offered. They run the Workflow orchestration on D1 and R2 with invented zipped and CSV feeds, and the Workflow class through its binding with every download step mocked. The request wiring (`getDb`, the health and DR routes) runs against the same D1, with Ahrefs replaced by a stubbed `fetch`.

Coverage is Istanbul, because workerd has no V8 coverage, and both projects count toward one 100% threshold over `apps/web/src/`. Stock shadcn source, test helpers, and the Next.js page and layout components are excluded, and the browser tests cover the last group.

## Browser tests

Playwright's `webServer` runs `apps/web/scripts/e2e-server.ts` and waits for `/api/health`. The script builds OpenNext with `apps/web/wrangler.e2e.jsonc`, refuses a bundle that contains non-public env variables (as `preview` does), and moves the build to `apps/web/tmp/e2e/.open-next`, served through `apps/web/e2e/worker.ts`, which wraps it in the same application Worker as `apps/web/worker.ts` (`apps/web/src/lib/app-worker.ts`). The developer's own `.open-next` is set aside during the build and put back, so a test run never replaces it. The script then applies migrations to a fresh `tmp/e2e/state`, inserts 60 deterministic invented listings and rebuilds the facets as a successful sync would, and serves the build with `wrangler dev --env-file /dev/null`, which never loads `.dev.vars`. Playwright refuses to start when its port (8797, not Wrangler's commonly occupied 8787) is taken, and stops the server's process group when the run ends.

The browser build reads `.env*` files like any Next build, which is why it refuses a bundle with non-public values. Neither calls a provider, uses remote D1, or touches `apps/web/.wrangler` and the owner's inventory.
