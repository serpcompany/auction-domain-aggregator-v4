# Bootstrap the application harness

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must remain accurate while implementation proceeds.

Maintain this plan according to `docs/plans/README.md` from the repository root.

## Purpose / Big Picture

After this plan is complete, a contributor can clone the repository, install dependencies with pnpm, run a minimal Next.js application locally, and verify that the same application builds and runs in Cloudflare's Workers runtime. The visible root page will state that the application harness is ready, and a health endpoint will prove that server-side Next.js code can query a locally simulated Cloudflare D1 database through Drizzle.

The repository will also have a fast verification loop: formatting, linting, strict TypeScript checking, unit coverage, a production-like browser smoke test, and CI will all be executable through documented package scripts. This plan establishes the environment in which later auction-provider and domain-table plans can be implemented reliably. It intentionally does not connect auction or SEO APIs, define the product database schema, build the final table, create remote Cloudflare resources, or deploy the application.

## Progress

- [x] (2026-07-13 08:20Z) Researched the current Next.js-on-Cloudflare, D1, Drizzle, shadcn/ui, and testing paths and audited the repository constraints.
- [x] (2026-07-13 08:20Z) Authored this initial ExecPlan and aligned `AGENTS.md` and `docs/plans/README.md` with the repository's ExecPlan convention.
- [x] (2026-07-13 08:37Z) Generated a temporary Cloudflare Next.js scaffold, integrated it without overwriting existing repository knowledge or user changes, and independently verified frozen install, build, Node development, and workerd preview behavior.
- [x] (2026-07-13 08:49Z) Pinned the actual pnpm/Node expectations and established passing formatting, linting, strict TypeScript, unit-test, 100-percent coverage, and package-script conventions, including a proven deliberate formatting failure.
- [x] (2026-07-13 08:58Z) Configured the local-only D1 binding and server-only Drizzle access boundary; `/api/health` executed `SELECT 1` and returned the exact success payload under both Next development and workerd preview.
- [x] (2026-07-13 09:05Z) Initialized shadcn/ui with only the owned Card primitive and replaced the starter with the server-rendered harness status page, health link, and accessible 100-percent-covered component test.
- [x] (2026-07-13 09:12Z) Added Chromium Playwright acceptance against an automatically managed OpenNext/workerd preview; the test verified the server-rendered page and exact D1 health response and left no preview process running.
- [x] (2026-07-13 09:28Z) Added least-privilege CI using pinned action commits, a fresh-safe Corepack/pnpm bootstrap, Chromium installation, and the same `pnpm check` gate used locally.
- [x] (2026-07-13 09:28Z) Updated `AGENTS.md`, `ARCHITECTURE.md`, and the technology-stack design with only verified commands, physical boundaries, and deferred external actions.
- [x] (2026-07-13 09:40Z) Passed the final whole-harness review in an isolated clean copy, completed the retrospective, and moved this plan to `docs/plans/completed/`.

## Surprises & Discoveries

- Observation: The repository contains documentation and local credentials but no application manifest, lockfile, source tree, or runnable checks.
  Evidence: The pre-plan repository inventory contains only Markdown documentation, `.gitignore`, `.env.example`, and the ignored `.env` file.

- Observation: A successful `next dev` run is insufficient evidence of Cloudflare compatibility.
  Evidence: The supported Cloudflare scaffold uses the Next.js Node development server for `dev`, while `preview` builds through OpenNext and runs through Wrangler in the `workerd` runtime used by Cloudflare Workers.

- Observation: Full-stack Next.js belongs on Cloudflare Workers rather than Cloudflare Pages in the accepted stack.
  Evidence: The current Cloudflare Next.js path uses the OpenNext adapter and creates a Worker; Pages is reserved for an intentionally static Next.js export.

- Observation: Remote deployment and remote D1 creation mutate external Cloudflare state.
  Evidence: Both operations require an authenticated Cloudflare account and create or update resources outside the repository, so they are not implicit acceptance steps for this local harness plan.

- Observation: C3 v2.70.10 rejects `--platform=workers` when `--framework=next` is supplied, even though Next.js is scaffolded for Workers automatically.
  Evidence: The command with the explicit platform exited with `Unsupported framework: next`; Cloudflare's documented command without that flag generated the OpenNext Workers template successfully.

- Observation: The generated Next.js 16 scaffold's lint command and compatibility wrapper were not runnable.
  Evidence: `next lint` has been removed in Next.js 16, and the generated `FlatCompat` configuration raised a circular-structure error with `eslint-config-next@16.2.6`. Replacing both with the native flat-config exports made `pnpm lint` pass.

- Observation: Port 3000 was occupied by an unrelated Next.js process during scaffold verification.
  Evidence: The harness was verified on explicit port 3001 without terminating the user-owned process; the preview runtime was verified on its expected port 8787.

- Observation: The generated runtime and test tools require a newer Node release than Next.js itself.
  Evidence: Wrangler 4.110 requires Node 22, while Vite 8.1.4 requires Node 22.12 or later on the Node 22 line. The manifest now advertises the strictest installed requirement, `>=22.12.0`, rather than Next.js's lower standalone minimum.

- Observation: Vite 8 resolves TypeScript path aliases natively.
  Evidence: The initially configured `vite-tsconfig-paths` plugin produced a redundancy warning. Replacing it with `resolve.tsconfigPaths: true` removed the warning while preserving `@/*` resolution.

- Observation: Wrangler's type generator can load local dotenv files unless given an explicit environment-file boundary.
  Evidence: `cf-typegen` now uses `--env-file /dev/null`; the checked-in `CloudflareEnv` contains the declared bindings, including `DB: D1Database`, without copying local dotenv names or values.

- Observation: The current shadcn initializer adds a sample Button and its support dependencies even when only initialization is requested.
  Evidence: After initialization, the Button source and its unused Base UI, CVA, and icon dependencies were removed; the subsequent Card command left `src/components/ui/card.tsx` as the only owned primitive.

- Observation: A repository-wide `tmp/` ignore is broader than Playwright needs and could hide future source directories.
  Evidence: The ignore was narrowed to `/tmp/playwright/`, which still contains reports, traces, screenshots, videos, and test results without masking another directory named `tmp` elsewhere.

- Observation: Node 22.12's bundled Corepack cannot verify the signing key for pnpm 10.17.0 in a fresh environment.
  Evidence: An isolated Corepack home reproduced `Cannot find matching keyid` with the bundled Corepack 0.29.4. Installing Corepack 0.34.0 first resolved the manifest-pinned pnpm version successfully.

- Observation: Without a repository-local Prettier configuration, Prettier searches parent directories and can silently inherit a contributor's personal rules.
  Evidence: The original workspace resolved `/Users/devin/.prettierrc`, while an isolated repository copy failed formatting. Adding `prettier.config.mjs` made the isolated copy resolve its own configuration and pass `check:quick`.

- Observation: C3's generated `allowBuilds` pnpm workspace key is not honored by pnpm 10.17.0.
  Evidence: A clean install skipped four expected native/binary build scripts. Replacing it with `onlyBuiltDependencies` for `esbuild`, `sharp`, `unrs-resolver`, and `workerd` ran those scripts and made `pnpm ignored-builds` report none.

## Decision Log

- Decision: Use pnpm and commit `pnpm-lock.yaml` plus the exact `packageManager` value generated by Corepack.
  Rationale: The repository owner selected pnpm. A committed lockfile and package-manager declaration make installs reproducible locally and in CI.
  Date/Author: 2026-07-13 / repository owner and Codex.

- Decision: Use the current stable Next.js 16 release created by Cloudflare's C3 scaffold, TypeScript, the App Router, a `src/` directory, and Tailwind CSS.
  Rationale: Next.js 16 is the current active line, and Cloudflare's generator configures the supported OpenNext Workers path. The `src/` layout keeps application code separate from repository tooling and documentation.
  Date/Author: 2026-07-13 / Codex.

- Decision: Target Cloudflare Workers with `@opennextjs/cloudflare`; do not use the static Pages path or Next.js Edge Runtime.
  Rationale: OpenNext's Workers adapter supports the full-stack features this application needs and expects Next.js's Node runtime, translated to Cloudflare's `workerd` environment.
  Date/Author: 2026-07-13 / Codex.

- Decision: Require Node `>=22.12.0` and use pnpm 10.17.0 through Corepack 0.34.0.
  Rationale: Node 22.12 is the strictest minimum required by the installed Next.js, Wrangler, and Vite toolchain. Pinning a current Corepack release avoids the pnpm signing-key failure in fresh Node 22.12 environments.
  Date/Author: 2026-07-13 / Codex.

- Decision: Keep the generated Next.js ESLint configuration and add Prettier for deterministic formatting.
  Rationale: The framework scaffold supplies Next-specific lint rules. Prettier adds a separate mechanical formatter without replacing or weakening those framework checks.
  Date/Author: 2026-07-13 / Codex.

- Decision: Invoke ESLint directly with Next.js 16's native `core-web-vitals` and `typescript` flat configurations.
  Rationale: C3's generated `next lint`/`FlatCompat` path is incompatible with the generated Next.js and ESLint versions. The native flat configuration preserves the intended rules and is independently runnable.
  Date/Author: 2026-07-13 / Codex.

- Decision: Use Vitest, React Testing Library, and V8 coverage for synchronous components and pure modules; use Playwright against `pnpm preview` for async server components, route handlers, and D1-bound behavior.
  Rationale: Unit tests provide a fast inner loop, but a browser test against the OpenNext preview proves behavior in `workerd`, where the deployed application will run. Async server components are better validated end to end than through a simulated component renderer.
  Date/Author: 2026-07-13 / Codex.

- Decision: Use stable `drizzle-orm` 0.44.x and compatible `drizzle-kit` 0.31.x releases rather than Drizzle's current release-candidate or beta line.
  Rationale: The newer Drizzle line explicitly permits breaking changes. The harness needs a predictable base more than prerelease features.
  Date/Author: 2026-07-13 / Codex.

- Decision: Prove D1 access with a read-only `SELECT 1` health query and defer the first migration and product schema to the data-model/provider plan.
  Rationale: Adding a placeholder table would create speculative product structure. A read-only query proves the binding, OpenNext context, and Drizzle driver without freezing an unreviewed schema.
  Date/Author: 2026-07-13 / Codex.

- Decision: Keep the harness D1 binding local-only with `remote: false` and an obviously non-deployable placeholder database ID.
  Rationale: This lets both development runtimes exercise a real local D1 binding while making accidental remote use visible and avoiding creation of Cloudflare account state.
  Date/Author: 2026-07-13 / Codex.

- Decision: Configure but do not execute remote deployment or remote D1 creation in this plan.
  Rationale: The local build and `workerd` preview prove the harness without requiring new external resources or authority. A later deployment milestone can use the generated `deploy` command after explicit authorization.
  Date/Author: 2026-07-13 / Codex.

- Decision: Do not create a Cron handler, provider client, Queue, R2 bucket, authentication layer, or final table in the harness.
  Rationale: These belong to later product slices and would be speculative before the basic application environment is proven.
  Date/Author: 2026-07-13 / Codex.

- Decision: Use shadcn v4's `base-nova` CSS-variable setup and retain only its Card primitive for the harness page.
  Rationale: This proves the owned-component workflow and supplies a minimal semantic status surface without prematurely designing the domain-discovery table.
  Date/Author: 2026-07-13 / Codex.

- Decision: Run Playwright only against `pnpm preview`, with readiness determined by the D1-backed health URL and existing-server reuse disabled.
  Rationale: The browser suite must prove OpenNext/workerd behavior and own the process it validates. Reusing a dev server or unrelated listener could produce a false pass.
  Date/Author: 2026-07-13 / Codex.

- Decision: Make `pnpm check` the single CI gate and pin both the tool bootstrap and GitHub Actions workflow dependencies.
  Rationale: The same command now proves formatting, linting, strict types, unit coverage, OpenNext build, workerd startup, local D1 access, and Chromium behavior. Pinning Corepack and action commits prevents fresh-environment and mutable-tag drift.
  Date/Author: 2026-07-13 / Codex.

- Decision: Own formatting rules in `prettier.config.mjs` and narrowly allow only the four dependency build scripts required by the verified dependency graph.
  Rationale: Reproducibility requires checks to be independent of parent-directory dotfiles, while pnpm's supply-chain control should permit only the known native/binary packages the clean build exercises.
  Date/Author: 2026-07-13 / Codex.

## Outcomes & Retrospective

Milestone 1 established a runnable Next.js 16 application using Cloudflare's OpenNext Workers adapter. A frozen pnpm install and production build pass; the starter page returns HTTP 200 in both the Node development server and the local workerd preview. No remote resource or deployment was created.

Milestone 2 added the fast verification loop. `pnpm check:quick` now verifies repository-wide non-document formatting, Next.js lint rules, strict types, and Vitest coverage. The preliminary status component has an accessible React Testing Library test and reaches 100 percent statements, branches, functions, and lines. A temporary malformed source file proved that `format:check` fails when it should, then was removed before the passing run.

Milestone 3 added the local D1/Drizzle proof without defining a product schema. The server-only `getDb()` boundary owns access to `env.DB`, and the dynamic health route successfully executed `SELECT 1` under both development runtimes. The exact response was `{"status":"ok","database":"ok"}` with HTTP 200. No remote D1 database was created.

Milestone 4 replaced the generated starter with a minimal server-rendered page built from the owned shadcn Card source. The page exposes the exact harness heading and status plus a health link, and its accessible component test remains inside the 100-percent coverage boundary. No dashboard or domain-table design was introduced.

Milestone 5 added a single Chromium acceptance test whose managed web server builds and launches the OpenNext preview. It verifies the accessible root-page contract and requests the D1-backed health endpoint for exact HTTP and JSON assertions. Both local and CI-mode runs passed, and preview shut down cleanly after each run.

Milestone 6 made that gate reproducible in CI and documented the verified repository. From a dependency tree rebuilt with `pnpm install --frozen-lockfile`, `pnpm check` passed formatting, linting, type checking, 100-percent unit coverage, OpenNext workerd startup, local D1 access, and the Chromium acceptance test. The standard Next.js build and Cloudflare type generation also passed. A second isolated repository copy proved that formatting resolves the checked-in configuration rather than a parent dotfile. A final clean install ran the four narrowly approved dependency build scripts without ignored-build warnings and again passed the full gate and build. The intended-file secret scan was clear, generated outputs remained ignored, and no harness listener remained. The supported `turbopack.root` setting removed the machine-specific parent-lockfile warning without touching files outside the repository.

The final whole-harness review approved the implementation after an isolated frozen install, repository-local formatting proof, warning-free dependency build-script execution, full unit and workerd-backed browser gate, scope/security audit, and process cleanup. The harness purpose is achieved. Remote Cloudflare creation, upload, deployment, provider integration, and product schema remain deliberately unexecuted for later plans.

## Context and Orientation

The working directory for every repository command in this plan is `/Users/devin/dev/repos/auction-domain-aggregator-v4` unless a step explicitly uses a temporary scaffold directory.

This repository now contains the application harness described by this plan. `README.md` describes a personal replacement for the domain-discovery portion of SpamZilla. `docs/product-specs/initial-domain-discovery.md` defines the eventual user workflow. `ARCHITECTURE.md` establishes that the Next.js application reads normalized data from Cloudflare D1 and that external provider APIs remain outside the page-request path. `docs/technical-design/technology-stack.md` records the verified Cloudflare, Next.js, D1, Drizzle, shadcn/ui, and test choices. `docs/technical-design/data-ingestion.md` describes later background ingestion behavior. None of that ingestion design is implemented by this plan.

`AGENTS.md` is the short repository map and contains the proven setup and verification commands. `.gitignore` protects local environment files and generated output. `.env.example` lists credential names with empty values. Do not read, print, migrate, or test real `.env` values during this plan; no provider credential is needed by the harness.

Cloudflare's C3 command is its project generator. It invokes the Next.js generator and adds the OpenNext and Wrangler configuration needed to run the Next.js application as a Cloudflare Worker. Generate into a temporary directory because this repository is non-empty and contains user-owned documentation and staged changes. The temporary output is an input to integrate, not authority to replace existing files.

OpenNext is the adapter that converts a Next.js production build into a Cloudflare Worker. `next dev` runs under Node.js for fast reloads. The `preview` script builds with OpenNext and launches Wrangler's local `workerd` runtime, which is a closer representation of production and is therefore the target for end-to-end acceptance.

A Cloudflare binding is a named resource exposed to Worker code through its environment. This plan names the local D1 binding `DB`. D1 is Cloudflare's SQLite-compatible relational database. Drizzle is the typed query layer. Application code accesses `DB` only in server code by calling OpenNext's `getCloudflareContext()` and passing `env.DB` to `drizzle()`.

The initial source boundaries are intentionally small. `src/app/` contains Next.js routes and layouts. `src/components/ui/` contains shadcn-generated component source. `src/components/harness-status.tsx` contains the small handwritten status presentation used by the root page. `src/server/db/client.ts` is the server-only D1/Drizzle boundary. Do not create generic `helpers.ts` or `utils.ts` dumping grounds.

The existing working tree already contains staged and unstaged documentation changes. Preserve them. Do not reset, clean, amend, or broadly overwrite the working tree while integrating the generated scaffold.

## Plan of Work

### Milestone 1: Integrate the supported Cloudflare Next.js scaffold

Generate a fresh Cloudflare Next.js project in a temporary directory with C3, selecting TypeScript, App Router, Tailwind CSS, a `src/` directory, and no immediate deployment. Inspect the generated manifest and configuration before integrating it. Bring the framework files into the repository without replacing `README.md`, `.gitignore`, `AGENTS.md`, `ARCHITECTURE.md`, `.env.example`, or `docs/`.

Set the package name to `auction-domain-aggregator-v4`. Use Corepack to pin pnpm 10 in the manifest and commit `pnpm-lock.yaml`. Preserve the C3-generated OpenNext, Wrangler, Next.js, TypeScript, Tailwind, and PostCSS configuration unless a later milestone records a concrete reason to alter it. Confirm that the Wrangler configuration includes `nodejs_compat` and an OpenNext-compatible compatibility date.

At the end of this milestone, `pnpm dev` must start the generated application and a request to the root page must return HTTP 200. `pnpm build` and `pnpm preview` must also start successfully before proceeding, even though the visible page is still the generated starter.

### Milestone 2: Establish the fast quality loop

Keep the generated ESLint setup and add Prettier, Vitest, React Testing Library, jsdom, V8 coverage, and the path-resolution plugin needed for the `@/*` alias. Configure strict TypeScript without weakening any scaffolded strictness. Add explicit package scripts named `format`, `format:check`, `lint`, `typecheck`, `test:unit`, `test:unit:watch`, `test:e2e`, `check:quick`, and `check`.

`check:quick` runs formatting verification, linting, type checking, and unit tests with coverage. It is the frequent inner loop. `check` runs `check:quick` and the production-like Playwright suite. Generated shadcn code, route entry files, generated Cloudflare types, and configuration files may be excluded from unit coverage because they are validated through generation, compilation, or end-to-end behavior. Handwritten pure domain and provider modules added by later plans must be included and held to 100 percent statement, branch, function, and line coverage. Record these inclusions and exclusions explicitly in `vitest.config.ts`; do not disable coverage globally to make the harness pass.

At the end of this milestone, a simple synchronous handwritten component test must pass, `pnpm check:quick` must exit zero, and a deliberate formatting or type error must make the corresponding check fail before that deliberate error is reverted.

### Milestone 3: Prove the D1 and Drizzle server boundary

Add a D1 binding named `DB` to `wrangler.jsonc` using a local-only placeholder database identifier. Do not create a remote database. Ensure `initOpenNextCloudflareForDev()` remains enabled in `next.config.ts` so the binding is available under `next dev`, and generate a checked-in `cloudflare-env.d.ts` using Wrangler's type generator.

Install `drizzle-orm` 0.44.x as an application dependency and compatible stable `drizzle-kit` 0.31.x as a development dependency. Add `src/server/db/client.ts` as a server-only module exporting `getDb()`. `getDb()` obtains `CloudflareEnv` through `getCloudflareContext()`, reads `env.DB`, and returns `drizzle(env.DB)`. Do not export the raw binding and do not initialize it in module-level client-visible state.

Add `src/app/api/health/route.ts`. This dynamic route calls `getDb()`, executes a read-only `SELECT 1`, and returns JSON with exactly `status: "ok"` and `database: "ok"` when the query succeeds. On an unexpected database failure, return HTTP 503 with a generic unhealthy response and log no credentials, binding contents, or authorization headers.

Do not create `src/server/db/schema.ts`, `drizzle.config.ts`, or a migration merely to satisfy the harness. Those files become meaningful when the next plan defines the first real domain schema. Document the stable Drizzle version choice now, but let the schema plan define the migration workflow against real tables.

At the end of this milestone, both `pnpm dev` and `pnpm preview` must serve `/api/health` with HTTP 200 and the expected JSON. This proves that the application can access a local D1 binding through Drizzle in both the fast development environment and the production-like Workers runtime.

### Milestone 4: Initialize shadcn/ui and create the visible harness page

Initialize shadcn/ui against the existing Next.js application, retaining the `@/*` alias into `src/`, CSS variables, and the scaffold's Tailwind setup. Add only the `card` component. Do not install a dashboard block, a data-table block, or unused primitives.

Create `src/components/harness-status.tsx` using the owned Card component source. Replace the starter `src/app/page.tsx` with a minimal server-rendered page that displays the exact heading `Auction Domain Aggregator` and visible status text `Application harness ready`. Include a link to `/api/health` for manual inspection. Remove unused starter assets and styles, but do not establish final visual design or domain-table layout.

Add a React Testing Library test for `HarnessStatus` that verifies the accessible heading and status text. At the end of this milestone, the page must be readable without client-side JavaScript and `pnpm check:quick` must pass.

### Milestone 5: Validate the production-like runtime in a browser

Add Playwright configured with Chromium and base URL `http://127.0.0.1:8787`. Its `webServer` command starts `pnpm preview`, not `pnpm dev`, and waits for the preview server rather than using arbitrary sleeps. Keep local bindings local; do not enable remote D1 bindings.

Add one browser test that opens `/`, verifies the heading and harness-ready text, follows or requests `/api/health`, and verifies the health JSON. The test must demonstrate both the rendered application and its D1-backed server route under `workerd`.

At the end of this milestone, `pnpm test:e2e` and the aggregate `pnpm check` command must pass from a clean local install. The Playwright configuration must collect a trace on the first retry and retain failure artifacts only when useful; generated reports and results remain ignored by Git.

### Milestone 6: Make the harness reproducible in CI and repository guidance

Add `.github/workflows/ci.yml` for pull requests and pushes. It checks out the repository, installs a Node version satisfying the manifest, installs Corepack 0.34.0 before enabling it, verifies the manifest-pinned pnpm version, installs from `pnpm-lock.yaml` with `--frozen-lockfile`, installs Playwright Chromium and its operating-system dependencies, and runs `pnpm check`. Do not add deployment, Cloudflare credentials, remote D1 access, or provider secrets to CI.

Update `AGENTS.md` with the proven install, development, quick-check, full-check, preview, Cloudflare type-generation, and deployment-preparation commands. Clearly mark both `pnpm upload` and `pnpm deploy` as external actions that require Cloudflare authorization and are not part of routine validation. Update `ARCHITECTURE.md` with a short physical code map naming `src/app`, `src/components`, and `src/server/db`; do not copy implementation detail from this plan into the architecture map. Update `docs/technical-design/technology-stack.md` with the verified OpenNext Workers path, pnpm, test tools, formatter/linter choices, and the fact that remote deployment remains unverified.

Run the complete validation from a clean dependency install, inspect the tracked diff for secrets and generated noise, and record the concise evidence in this plan. When every acceptance criterion is met, update the outcome and revision note, then move this file to `docs/plans/completed/bootstrap-application-harness.md`.

## Concrete Steps

Run all repository commands from `/Users/devin/dev/repos/auction-domain-aggregator-v4`. First record the existing state without changing it:

    git status --short
    git diff --check
    node --version
    corepack --version

Create the Cloudflare scaffold outside the repository. The generator is interactive; choose TypeScript, App Router, Tailwind CSS, a `src/` directory, and no deployment if asked. Do not initialize another Git repository as part of the scaffold if the generator offers that choice.

    SCAFFOLD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/auction-domain-aggregator-v4-scaffold.XXXXXX")"
    pnpm create cloudflare@latest "$SCAFFOLD_DIR" --framework=next --no-deploy --no-git --no-agents -- --ts --tailwind --eslint --app --src-dir --use-pnpm --import-alias '@/*'

Inspect the generated files and package scripts. Then integrate the generated framework artifacts while preserving the existing repository-owned files named in Milestone 1. Use patch-based edits for overlaps. Remove the temporary directory only after the integrated application has built successfully:

    find "$SCAFFOLD_DIR" -maxdepth 2 -type f | sort
    git status --short

Install the known-good Corepack release, pin pnpm 10 through it, install from the resulting manifest, and verify the starter before adding more tools:

    npm install --global corepack@0.34.0
    corepack enable
    corepack use pnpm@latest-10
    pnpm install
    pnpm dev

In another terminal, expect an HTTP 200 response:

    curl --fail --silent --show-error http://127.0.0.1:3000/ >/dev/null

Stop the development server, then run:

    pnpm build
    pnpm preview

In another terminal, expect an HTTP 200 response from the Workers preview:

    curl --fail --silent --show-error http://127.0.0.1:8787/ >/dev/null

Install and configure the quality-loop dependencies using current stable versions compatible with the scaffolded Next.js release. Keep the lockfile as the exact version record:

    pnpm add -D prettier vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @playwright/test

Initialize shadcn/ui only after the app and alias are working, then add the single required primitive:

    pnpm dlx shadcn@latest init
    pnpm dlx shadcn@latest add card

Install the stable Drizzle line:

    pnpm add drizzle-orm@0.44.7
    pnpm add -D drizzle-kit@0.31

After adding the `DB` binding, generate environment types and ensure the output is tracked:

    pnpm cf-typegen
    test -f cloudflare-env.d.ts

Run fast validation repeatedly while editing:

    pnpm check:quick

Run the local Node development server and verify D1 through Drizzle:

    pnpm dev
    curl --fail --silent --show-error http://127.0.0.1:3000/api/health

The expected body is equivalent to:

    {"status":"ok","database":"ok"}

Run the production-like acceptance:

    pnpm test:e2e
    pnpm check

Before completion, prove reproducible installation and inspect the final repository state. Preserve `.env` without reading it:

    rm -rf node_modules
    pnpm install --frozen-lockfile
    pnpm check
    git diff --check
    git status --short
    git ls-files | xargs rg -n --hidden --glob '!pnpm-lock.yaml' '(API_KEY|API_SECRET|CLIENT_SECRET|TOKEN)=' || true

The final secret scan may match empty assignments in `.env.example`; it must not reveal any non-empty credential values. Never broaden the scan to ignored `.env`.

## Validation and Acceptance

The plan is complete only when all of the following are observable from a fresh checkout plus the documented local prerequisites:

1. `corepack enable` followed by `pnpm install --frozen-lockfile` succeeds using the committed manifest and lockfile.
2. `pnpm dev` serves `/` on port 3000 with the heading `Auction Domain Aggregator` and status `Application harness ready`.
3. Under `pnpm dev`, `/api/health` returns HTTP 200 with `{"status":"ok","database":"ok"}` after querying local D1 through Drizzle.
4. `pnpm check:quick` runs Prettier verification, Next.js ESLint rules, strict TypeScript, and Vitest coverage and exits zero.
5. Unit coverage enforces 100 percent statements, branches, functions, and lines for handwritten pure modules within its declared inclusion scope; exclusions are narrow and documented.
6. `pnpm preview` builds through OpenNext, starts under local `workerd` on port 8787, and serves both `/` and the D1-backed health endpoint.
7. `pnpm test:e2e` launches the preview through Playwright without arbitrary sleeps and verifies the root page plus health response in Chromium.
8. `pnpm check` performs the full required validation and exits zero; CI invokes this same command after a frozen install.
9. No tracked file contains a non-empty provider credential, token, raw authorization header, or copied `.env` value.
10. No remote D1 database, Worker deployment, Queue, R2 bucket, auction API call, or SEO API call is created or executed.
11. `AGENTS.md` contains the real commands, `ARCHITECTURE.md` contains a concise physical code map, and `docs/technical-design/technology-stack.md` distinguishes verified from deferred decisions.
12. `git diff --check` passes, generated runtime output remains ignored, and `git status --short` contains only intended repository changes.

## Idempotence and Recovery

Generate the initial framework in a new temporary directory so rerunning C3 cannot overwrite repository knowledge. If the generator fails, delete only that temporary directory and rerun it. Never run a destructive cleanup command against the repository root.

Package installation, formatting checks, builds, local preview, type generation, and tests are safe to repeat. If dependency integration becomes inconsistent, preserve `package.json` and `pnpm-lock.yaml`, remove only `node_modules`, and reinstall with `pnpm install --frozen-lockfile`. Do not delete the lockfile merely to make resolution succeed; investigate and record the dependency conflict.

Local Wrangler and D1 state lives in ignored generated directories. If local state alone becomes corrupt, stop all development and preview processes, record the failure in `Surprises & Discoveries`, and remove only the documented ignored local state directory before retrying. This plan does not contain product data, but later plans must not treat deleting D1 state as a general recovery strategy.

If `next dev` passes but `preview` fails, treat the preview failure as authoritative for Cloudflare compatibility. Fix or replace the incompatible API; do not weaken or remove preview acceptance. If a package works in Node but fails under `workerd`, capture the error and choose a Workers-compatible path in the Decision Log.

The placeholder local D1 identifier must never be used for remote commands. `pnpm upload`, `pnpm deploy`, and any command containing `wrangler d1 ... --remote` are outside this plan. Do not run them without explicit authorization and a real Cloudflare resource identifier.

The existing staged and unstaged documentation changes are user-owned. Never use `git reset --hard`, `git checkout --`, `git clean`, or another broad destructive command. Work around existing changes and inspect overlapping diffs before editing.

## Artifacts and Notes

Expected durable artifacts include `package.json`, `pnpm-lock.yaml`, the Node/package-manager declaration, Next.js and TypeScript configuration, OpenNext and Wrangler configuration, Tailwind and PostCSS configuration, ESLint and Prettier configuration, `components.json`, the minimal `src/` tree, generated Cloudflare environment types, Vitest and Playwright configuration, tests, and `.github/workflows/ci.yml`.

Expected generated artifacts such as `node_modules/`, `.next/`, `.open-next/`, `.wrangler/`, `coverage/`, and `/tmp/playwright/` remain ignored and untracked.

At implementation completion, preserve short evidence here for the frozen install, `pnpm check:quick`, the `/api/health` response under both development and preview, Playwright results, `pnpm check`, and the final secret scan. Do not paste full dependency logs, generated bundles, or credential-bearing output.

## Interfaces and Dependencies

The application must provide these stable package scripts:

    dev             Start the fast Next.js development server on port 3000.
    build           Produce the standard Next.js production build.
    preview         Build through OpenNext and run locally through Wrangler/workerd.
    upload          Build and upload through OpenNext; external mutation not executed by this plan.
    deploy          Build and deploy through OpenNext; defined but not executed by this plan.
    cf-typegen      Generate CloudflareEnv declarations from wrangler.jsonc.
    format          Apply Prettier formatting.
    format:check    Verify formatting without changing files.
    lint            Run the scaffolded Next.js ESLint configuration.
    typecheck       Run TypeScript with no emit under strict settings.
    test:unit       Run Vitest once with V8 coverage.
    test:unit:watch Run Vitest in watch mode.
    test:e2e        Run Playwright against the OpenNext preview.
    check:quick     Run format:check, lint, typecheck, and test:unit.
    check           Run check:quick and test:e2e.

`src/server/db/client.ts` must expose one server-only entry point:

    getDb(): DrizzleD1Database

The exact generic schema parameter may remain empty until the real schema exists. Callers must not import `getCloudflareContext()` or `env.DB` directly when they only need database access.

`GET /api/health` must return HTTP 200 and this public success shape after a successful D1 query:

    { "status": "ok", "database": "ok" }

On a D1 failure it must return HTTP 503 with a generic status shape that does not disclose internal exception details.

The required runtime dependencies are the stable Next.js/React versions produced by the current C3 scaffold, `@opennextjs/cloudflare`, `wrangler` 4.x, and `drizzle-orm` 0.44.7. Development dependencies include TypeScript, the scaffolded ESLint packages, Prettier, `drizzle-kit` 0.31.x, Vitest, V8 coverage, React Testing Library, jsdom, and Playwright. Vite 8 supplies native TypeScript path-alias resolution.

Cloudflare configuration must bind a local D1 database as `DB`, retain `nodejs_compat`, generate a `CloudflareEnv` type, and keep remote bindings disabled. Application routes use the Next.js Node runtime supported by OpenNext, not Next.js Edge Runtime. Avoid D1-backed static generation; the live discovery application will read D1 dynamically.

Revision note (2026-07-13 / Codex): Created the initial plan after repository audit and current official-stack research. Updated it through Milestone 6 and final-review fixes with the successful C3 invocation, Next.js 16 ESLint correction, actual Node 22.12 toolchain floor, fresh-safe Corepack bootstrap, repository-owned formatting rules, correct pnpm build-script allowlist, native Vite path resolution, verified local checks, local-only D1/Drizzle health proof, minimal owned shadcn status surface, workerd-backed Chromium acceptance, pinned CI, and isolated clean-install evidence. Closed and moved the plan after final independent approval. The plan deliberately defers external provider integration, product schema, remote resources, upload, and deployment.
