# AGENTS.md

## Project

This repository is a personal auction and expired-domain discovery tool. Read `README.md` for the overview, `docs/product-specs/initial-domain-discovery.md` for the agreed first usable version, and `ARCHITECTURE.md` before making structural or data-flow changes.

## Repository map

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
- Treat `.env` as secret local configuration. Never read, print, commit, or copy its values into documentation, tests, logs, or source files.
- Prefer small changes with an observable result. Do not add speculative infrastructure or abstractions before the product needs them.

## Local development

Prerequisites are Node.js 22.12 or newer and npm. Install the known-good Corepack version before enabling the pnpm version pinned in `package.json`.

- `npm install --global corepack@0.34.0`: install the supported Corepack release.
- `corepack enable`: enable Corepack's package-manager shims.
- `corepack pnpm --version`: verify pnpm 10.17.0 is selected from `package.json`.
- `corepack pnpm install --frozen-lockfile`: install the locked dependency graph.
- `corepack pnpm dev`: run Next.js in Node for fast local development.
- `corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001`: run the inspectable local UI on port 30001. Webpack is the verified development bundler for the large local D1 inventory.
- `corepack pnpm db:generate`: generate a migration after an intentional Drizzle schema change.
- `corepack pnpm db:check`: validate the generated migration history.
- `corepack pnpm db:migrate:local`: apply migrations to local D1 only; it is safe to rerun.
- `corepack pnpm sync:dynadot`: migrate and manually synchronize Dynadot into local D1 using local `.env` configuration.
- `corepack pnpm check:quick`: run formatting, linting, type checks, and unit tests.
- `corepack pnpm test:integration`: run the provider-free proof against an isolated temporary local D1/workerd instance.
- `corepack pnpm check`: run the quick checks, isolated D1 integration proof, and browser tests against the workerd preview.
- `corepack pnpm preview`: migrate local D1, build with OpenNext, and serve the Cloudflare Worker locally.
- `corepack pnpm build`: verify the standard Next.js production build.
- `corepack pnpm cf-typegen`: regenerate Cloudflare binding types from `wrangler.jsonc`.

`dev` and `preview` exercise different runtimes: `dev` is the Next.js Node development server, while `preview` runs the OpenNext output under Cloudflare's local workerd runtime. The configured D1 binding is local-only. Both `pnpm upload` and `pnpm deploy` mutate external Cloudflare state, require explicit authorization, and are not routine verification steps. Creating remote Cloudflare resources also requires explicit authorization.

## ExecPlans

For multi-session features, significant architectural changes, migrations, or work with important unknowns, create and maintain an ExecPlan according to `docs/plans/PLANS.md` from research through verification.
