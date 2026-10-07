# Bootstrap the application harness

Completed 2026-07-13 (Codex, with the repository owner). This is the outcome summary; the full ExecPlan, with its progress log, milestones, and concrete steps, is in git history (`git show 907d382:docs/plans/completed/bootstrap-application-harness.md`).

## Outcome

The repository went from documentation only to a runnable application harness. A contributor could install with pnpm, run a minimal Next.js 16 application in Node (`next dev`) and in Cloudflare's local workerd runtime (OpenNext `preview`), and run one verification gate locally and in CI.

- A server-rendered status page built from the owned shadcn Card primitive.
- `GET /api/health`, which runs `SELECT 1` through Drizzle against a local-only D1 binding `DB` and returns `{"status":"ok","database":"ok"}` (HTTP 503 with a generic body on failure).
- `pnpm check:quick` (formatting, lint, strict types, Vitest with 100 percent coverage of handwritten modules) and `pnpm check` (adds a Chromium Playwright test against the OpenNext workerd preview).
- CI with pinned action commits that runs the same `pnpm check` after a frozen install.

It deliberately created no product schema, provider client, Cron handler, Queue, R2 bucket, remote D1 database, or deployment.

## Key decisions

- **pnpm 10.17.0 through Corepack 0.34.0, Node `>=22.12.0`.** Node 22.12 is the strictest floor of the Next.js, Wrangler, and Vite toolchain. Node 22.12's bundled Corepack 0.29.4 fails pnpm's signing-key check in a fresh environment (`Cannot find matching keyid`), so Corepack 0.34.0 is installed first.
- **Cloudflare Workers through `@opennextjs/cloudflare`**, not Pages or the Next.js Edge Runtime: OpenNext supports the full-stack features and runs Next.js's Node runtime on workerd.
- **workerd is authoritative.** A passing `next dev` is not evidence of Cloudflare compatibility, so browser acceptance runs only against the OpenNext preview, with readiness from the D1-backed health URL and no reuse of an existing server.
- **Stable Drizzle** (`drizzle-orm` 0.44.7, `drizzle-kit` 0.31.x), not the prerelease line, which permits breaking changes.
- **No placeholder schema.** A read-only `SELECT 1` proves the binding, OpenNext context, and driver without freezing an unreviewed schema.
- **Local-only D1** with `remote: false` and an obviously non-deployable placeholder ID, so accidental remote use is visible.
- **One gate.** `pnpm check` is the same command locally and in CI.
- Formatting and lint at the time were Prettier and ESLint; the repository later moved to Biome (SERP web stack).

## Discoveries

- C3 v2.70.10 rejects `--platform=workers` with `--framework=next`; omitting the flag still scaffolds Workers.
- `next lint` was removed in Next.js 16, and the generated `FlatCompat` config raised a circular-structure error; native flat configs fixed lint.
- Wrangler's type generator reads local dotenv files unless given `--env-file /dev/null`, which `cf-typegen` now passes.
- Without a repository-local formatter config, Prettier inherited a contributor's personal dotfile from a parent directory.
- C3's generated `allowBuilds` pnpm key is ignored by pnpm 10.17.0; `onlyBuiltDependencies` (`esbuild`, `sharp`, `unrs-resolver`, `workerd`) runs the required build scripts.
- Vite 8 resolves TypeScript path aliases natively (`resolve.tsconfigPaths: true`), replacing `vite-tsconfig-paths`.

## Evidence

From a frozen install in an isolated clean copy: `pnpm check` passed formatting, lint, types, 100 percent unit coverage, the OpenNext workerd startup, local D1 access, and the Chromium test; the standard Next.js build and `cf-typegen` passed; the secret scan of tracked files was clear and no preview process remained. A final independent review approved the harness.

## Follow-ups at completion

Provider integration, the product schema, remote Cloudflare resources, upload, and deployment were left to later plans: [Dynadot domain table](dynadot-domain-table.md) added the first schema and provider, and [Production sync](../../technical-design/production-sync.md) records what is deployed today.
