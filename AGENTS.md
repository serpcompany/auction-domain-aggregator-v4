# AGENTS.md

## Project

This repository is a personal auction and expired-domain discovery tool. Read `README.md` for the overview, `docs/product-specs/initial-domain-discovery.md` for the agreed first usable version, and `ARCHITECTURE.md` before making structural or data-flow changes.

## Repository map

- `apps/web/`: the website and its ingestion Worker (Next.js on Cloudflare Workers), with its own `package.json`, lockfile, configs, `src/`, `e2e/`, `scripts/`, and `drizzle/` migrations. It is the only delivery surface.
- `README.md`: human-facing project overview.
- `ARCHITECTURE.md`: stable system map, boundaries, and architectural invariants.
- `docs/product-specs/`: agreed product behavior and scope.
- `docs/technical-design/`: accepted technical choices, system design, and their rationale.
- `docs/plans/PLANS.md`: when and how to maintain durable implementation plans.
- `docs/references/`: external-product research used to inform decisions. Reference material is not automatically a product requirement.

## Working rules

- Keep product behavior in product specs and keep `AGENTS.md` as a short map.
- Keep stable system boundaries in `ARCHITECTURE.md` and implementation detail in technical-design documents.
- Do not infer first-version requirements from the complete SpamZilla reference inventory.
- Provider credentials live in `.secrets/providers.env` (template: `providers.env.example`). Treat it as secret local configuration. Never read, print, commit, or copy its values into documentation, tests, logs, or source files.
- The app worker's own secrets (currently `AHREFS_API_KEY`, an Ahrefs APIv3 key) go in `apps/web/.dev.vars` for local development. OpenNext does not bundle that file. Deployed workers use `wrangler secret put`.
- Never put credentials in `.env*` files: `opennextjs-cloudflare build` inlines their values into the Worker bundle. `preview`, `deploy`, and `upload` refuse to continue if the built bundle contains non-public env variables.
- UI follows the SERP web UI rules summarized in `docs/technical-design/technology-stack.md`: stock shadcn first, tokens only, and a check at 1440px and 390px.
- The app follows the SERP web stack (`serpcompany/serp`, `docs/engineering/standards/web-stack/`) with one recorded exception: local development runs `next dev --webpack` instead of Turbopack, because webpack is the verified bundler for the large local D1 inventory.
- Prefer small changes with an observable result. Do not add speculative infrastructure or abstractions before the product needs them.

## Local development

Run every command below from `apps/web/`. Local secrets stay at the repository root in `.secrets/`; local D1, R2, and Workflow state lives in `apps/web/.wrangler/`.

Prerequisites are Node.js 22 (22.12 or newer, below 23; `apps/web/.node-version` pins the major version) and npm. Install the known-good Corepack version before enabling the pnpm version pinned in `apps/web/package.json`.

- `npm install --global corepack@0.34.0`: install the supported Corepack release.
- `corepack enable`: enable Corepack's package-manager shims.
- `corepack pnpm --version`: verify pnpm 10.17.0 is selected from `apps/web/package.json`.
- `corepack pnpm install --frozen-lockfile`: install the locked dependency graph.
- `corepack pnpm dev`: run Next.js in Node for fast local development.
- `corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001`: run the inspectable local UI on port 30001. Webpack is the verified development bundler for the large local D1 inventory.
- `corepack pnpm db:generate`: generate a migration after an intentional Drizzle schema change.
- `corepack pnpm db:check`: validate the generated migration history.
- `corepack pnpm db:migrate:local`: apply migrations to local D1 only; it is safe to rerun.
- `corepack pnpm sync <provider>`: migrate local D1, then run that provider's `provider-sync` Workflow (the same code the daily Cron Trigger starts) in a temporary local `wrangler dev` of the ingestion Worker on ports 8790 and 9330, with local D1, R2, and Workflows. `dynadot` (alias `sync:dynadot`) reads its key from `.secrets/providers.env`. `godaddy` needs no credentials: the Workflow downloads GoDaddy's public inventory file (about 37 MB zipped, 450 MB unzipped) and stages it in local R2, about 2 to 3 minutes end to end. Do not edit `apps/web/src/` while it runs: Wrangler's reload orphans the running instance. GoDaddy content is licensed for the owner's internal use only.
- `corepack pnpm check:quick`: run Biome (format and lint, read-only), type checks, the migration-history check, and unit tests.
- `corepack pnpm format`: format with Biome. `corepack pnpm exec biome check --write` also applies safe lint fixes and sorts imports.
- `corepack pnpm test`: run the unit and component tests with coverage.
- `corepack pnpm test:integration`: run the provider-free proof against an isolated temporary local D1/workerd instance.
- `corepack pnpm test:e2e`: build OpenNext and run browser acceptance against deterministic fixtures in an isolated temporary local D1/workerd instance.
- `corepack pnpm benchmark:filters`: time whole table requests through `queryDomainListingsWithDatabase` (the page's read path) against the populated local D1 inventory, without loading credentials or printing rows.
- `corepack pnpm check`: run the quick checks, isolated D1 integration proof, and isolated browser acceptance.
- `corepack pnpm preview`: migrate local D1, build with OpenNext, and serve the Cloudflare Worker locally.
- `corepack pnpm build`: verify the standard Next.js production build.
- `corepack pnpm cf-typegen`: regenerate Cloudflare binding types from `apps/web/wrangler.jsonc`.

`dev` and `preview` exercise different runtimes: `dev` is the Next.js Node development server, while `preview` runs the OpenNext output under Cloudflare's local workerd runtime. The configured D1 binding is local-only. Integration and browser tests use temporary persistence and never mutate the owner's `apps/web/.wrangler` inventory. Both `pnpm upload` and `pnpm deploy` mutate external Cloudflare state, require explicit authorization, and are not routine verification steps. Creating remote Cloudflare resources also requires explicit authorization. The ingestion Worker (`apps/web/wrangler.ingestion.jsonc`) is not deployed; `docs/technical-design/data-ingestion.md` lists the D1, R2, Workflow, cron, and secret settings a deploy needs.

## ExecPlans

For multi-session features, significant architectural changes, migrations, or work with important unknowns, create and maintain an ExecPlan according to `docs/plans/PLANS.md` from research through verification.
