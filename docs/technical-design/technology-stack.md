# Technology stack

Status: Accepted foundation

Last updated: 2026-10-06

## Purpose

This document records the technologies chosen for the project and the constraints those choices place on future implementation. It does not prescribe an implementation sequence; implementation work belongs in an execution plan when one is needed.

## Platform strategy

Use Cloudflare for hosting and infrastructure wherever it reasonably supports the product. Prefer a Cloudflare service over introducing another infrastructure provider when the Cloudflare service meets the requirement without forcing an unsuitable design.

This is a Cloudflare-first decision, not a requirement to use every Cloudflare product. Add services only in response to a concrete product or operational need.

## Accepted technologies

### Package manager: pnpm

Use pnpm 10.17.0 through Corepack 0.34.0 for dependency installation and package scripts. Install that known-good Corepack release with npm before enabling its shims; do not rely on the Corepack version bundled with Node.js. Commit `apps/web/pnpm-lock.yaml` and keep the concrete pnpm version in `apps/web/package.json` so local development and CI resolve the same dependency graph. The supported runtime is Node.js 22.12 or a newer 22.x release; `apps/web/.node-version` pins the major version for local version managers and CI. Newer majors are excluded because Node 25 previously hung local Wrangler platform proxies.

### Application framework: Next.js

Build the website with Next.js 16 and TypeScript. OpenNext for Cloudflare builds the application as a Cloudflare Worker; Wrangler runs that output locally under workerd. `next dev` remains the fast Node.js development path, so both it and the workerd preview must stay healthy.

The local adapter and runtime path are verified. `pnpm upload` and `pnpm deploy` are external mutations, not validation commands. Remote deployment, production bindings, and Cloudflare resource creation have not been verified and remain deferred until explicitly authorized.

### Hosting and compute: Cloudflare

Host the website on Cloudflare. Use Cloudflare-native compute for server-side application behavior and domain-ingestion workloads when it fits their runtime and execution requirements. Use Cloudflare Cron Triggers to start periodic auction synchronization outside the user request path.

Ingestion is a separate Worker (`apps/web/wrangler.ingestion.jsonc`, entry `apps/web/src/server/ingestion/sync-worker.ts`) with no HTTP routes. Its daily Cron Trigger starts one Cloudflare Workflow instance per provider; Workflow steps give each stage of a sync its own CPU budget, persisted results, and retries, which replaced a loopback continuation loop on the owner's machine. Measured on 2026-10-06, staging GoDaddy's 450 MB feed inside one step used about 3 to 8 seconds of Worker CPU and about 10 MiB of JavaScript heap, so no Container is needed (`docs/plans/completed/cloud-ingestion.md`). The Worker sets `limits.cpu_ms` to 60,000 (Workers Paid). Cloudflare Queues are optional and should be added only when fan-out, rate limiting, retries, or execution duration requires them.

### Object storage: Cloudflare R2

Use R2 for transient ingestion files: a file feed's page files live under a per-Workflow-instance prefix in the `FEED_PAGES` bucket only for the duration of one run and are deleted by its last step. Nothing user-facing reads R2. The binding is local-only until deployment is authorized.

### Database: Cloudflare D1

Use Cloudflare D1 as the relational database and source of truth for normalized auction listings and collected domain metrics.

External provider responses are untrusted input. Parse them into the application's own data types at the provider boundary before storing or acting on them.

The current `DB` binding is deliberately local-only. The health route proves D1 access in both the Node development server and the workerd preview. The first product schema now stores normalized domains, auction listings, and ingestion runs; no remote D1 database exists yet.

### Database access and migrations: Drizzle ORM

Use Drizzle for the database schema, migrations, and typed application queries against D1. Schema changes must be represented by reviewable migrations rather than undocumented manual changes to a database.

Do not allow provider-specific response shapes to become the database schema directly. The application schema should represent the product's domain concepts, with provider adapters translating external data into those concepts.

Use Drizzle ORM 0.44.7 and Drizzle Kit 0.31.x. Keep database construction behind the server-only `apps/web/src/server/db/` boundary. The concrete schema lives in `apps/web/src/server/db/schema.ts`, with reviewed generated migrations under `apps/web/drizzle/` and local-only migration commands in `apps/web/package.json`.

### UI components: shadcn/ui

Follow the SERP web UI rules (serp.co `docs/agents/web.md`, "Rules for UI work"). Build from stock shadcn components first: style `base-nova` on `@base-ui/react`, added with `corepack pnpm exec shadcn add <component>` and kept stock in `apps/web/src/components/ui/`, styled through `className`. Write a custom component only when shadcn has no equivalent. Color only through the tokens in `apps/web/src/app/globals.css`, never Tailwind palette colors; add a token when a new color is needed. Check every UI change at 1440px and 390px wide. There is no client table framework (no TanStack): the results use the stock shadcn `Table`.

Do not treat the default appearance of generated components as the product's finished UI design. The first domain-discovery table establishes the current dense, server-rendered application pattern; later UI changes should preserve its accessible table and URL-backed filtering behavior unless a product decision replaces them.

Add components only as they are needed. The current set includes Alert, Badge, Button, Card, Checkbox, Combobox, Empty, Field, Input, Input Group, Pagination (container parts only, see below), Select, Sheet, and Table. Page links are Next links styled with `buttonVariants`, because the stock `PaginationLink` renders through a client `Button` that causes a hydration mismatch when used from a server component, and announces page links as buttons.

### Validation and continuous integration

Use Zod 4 for runtime validation of provider responses. File feeds are split by a small dependency-free byte scanner (`apps/web/src/server/ingestion/feed-stage.ts`) rather than a streaming JSON library, so the same code runs in workerd and Node. Use Biome for formatting and linting (`apps/web/biome.json`, the SERP standard settings), with stock `apps/web/src/components/ui/` exempt from the few rules that conflict with upstream shadcn. Use TypeScript's compiler for type checks, Vitest with Testing Library and V8 coverage for fast unit/component tests, and Playwright Chromium for browser checks against the local OpenNext workerd preview.

`pnpm check:quick` is the fast inner loop. `pnpm check` adds the provider-free isolated local-D1/workerd integration proof and browser tests against an isolated, deterministically seeded OpenNext workerd preview. It is the CI gate. CI runs for pushes to `main` and for pull requests, cancels superseded runs, caches the pnpm store and Playwright browsers, and uploads the Playwright report on failure. It installs the frozen lockfile and Chromium before running that gate; it does not deploy, load provider credentials, mutate the developer's local D1 inventory, or access remote resources.

## Decisions not yet made

The following choices require more information and are intentionally unresolved:

- The exact supported method for deploying this Next.js application to Cloudflare.
- Whether ingestion volume or provider behavior requires Cloudflare Queues.

Resolve these decisions through the smallest working proof that exercises the relevant constraint. Once accepted, update this document with the decision and its rationale.
