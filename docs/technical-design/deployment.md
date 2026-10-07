# Deployment

Status: Implemented (#92). Staging deploys from `staging`, Production from `main`.

Two deployed environments, Staging and Production, run the same code with their own resources. Each has two Workers: the sync (`apps/web/wrangler.ingestion.jsonc`) and the website (`apps/web/wrangler.jsonc`). The top level of both configurations stays local-only and is never deployed; `env.staging` and `env.production` declare every binding, because named environments inherit none. A test (`apps/web/scripts/deploy-config.test.ts`) resolves each environment the way Wrangler does and checks the names, IDs, hosts, and switches below.

## Resources

All are on the SERP account. Workflow names are account-wide, so each is prefixed.

| | Staging | Production |
| --- | --- | --- |
| D1 (binding `DB`, ledger `d1_migrations`) | `auction-domain-aggregator-staging` | `auction-domain-aggregator-production` |
| R2 (binding `FEED_PAGES`, sync only) | `auction-domain-aggregator-feed-pages-staging` | `auction-domain-aggregator-feed-pages-production` |
| Sync Worker | `auction-domain-aggregator-ingestion-staging` | `auction-domain-aggregator-ingestion-production` |
| Workflow (binding `PROVIDER_SYNC`) | `auction-domain-aggregator-provider-sync-staging` | `auction-domain-aggregator-provider-sync-production` |
| Sync cron (UTC) | `30 15 * * 1` (weekly, Mondays) | `30 15 * * *` (daily) |
| Website Worker | `auction-domain-aggregator-web-staging` | `auction-domain-aggregator-web-production` |
| Canonical host (Custom Domain) | `staging-auctions.serp.co` | `auctions.serp.co` |

Staging's host is one label under `serp.co` because Universal SSL covers only one level. Each R2 bucket has the `expire-staged-feed-pages` lifecycle rule (2 days), so pages a failed cleanup step leaves behind can't accumulate. The sync Workers have no HTTP routes (`workers_dev` and `preview_urls` off) and set `cpu_ms` 60,000 (Workers Paid). The website binds its environment's D1, `ASSETS`, and `WORKER_SELF_REFERENCE` (its own Worker name), but no R2: nothing user-facing reads feed pages. Both Workers have observability on. `redact_query_string` is not in Wrangler 4.110's schema; it arrives with a Wrangler upgrade before payments (#94).

Secrets, set by the owner per environment: `DYNADOT_API_PRODUCTION_KEY` and `NAMESILO_API_KEY` on each sync Worker (`wrangler secret put DYNADOT_API_PRODUCTION_KEY --config wrangler.ingestion.jsonc --env <env>`; without it, Dynadot's instance fails with `dynadot_missing_credentials` and the others run), and `AHREFS_API_KEY` on each website Worker (`wrangler secret put AHREFS_API_KEY --env <env>`; without it, DR enrichment calls nothing).

## The website gate

Until accounts and billing (#27), both websites are owner-only behind Cloudflare Access. One Access application, "auctions", covers both hosts with the policy "Allow Farley and Devin", so both environments set the same non-secret `vars`: `ACCESS_TEAM_DOMAIN` `serpcompany.cloudflareaccess.com` and `ACCESS_AUD`, the application's AUD tag. Each also sets `APP_ENV` (`staging` or `production`) and `CANONICAL_HOST`.

The application Worker (`apps/web/src/lib/app-worker.ts`) checks every request before Next.js runs:

1. Any `APP_ENV` other than `local` is a deployment. Without a valid canonical host, team domain, and AUD tag it answers **503** and logs `deployment_not_configured` (`deployment.ts`).
2. Any other host, such as `*.workers.dev`, gets a **308** to `https://<CANONICAL_HOST>` with the path and query kept, in one hop with the canonical trailing slash. Requests with the `x-auction-domain-aggregator-smoke-test` header are exempt from this redirect only (SERP `environment-configuration.md`).
3. `/robots.txt` is answered here, with the environment's policy. It holds no data.
4. Every other request needs a valid `Cf-Access-Jwt-Assertion` token, or it gets **403** (`access.ts`): RS256, signed by a key from `https://<team>/cdn-cgi/access/certs`, issuer `https://<team>`, audience the AUD tag, with `exp` and `iat` and within its `nbf`/`exp` window (30 seconds' tolerance). Keys are cached per isolate for ten minutes; a token with an unknown key refetches them at most every 30 seconds. A fetch failure is a 403.
5. Then the trailing-slash rule and OpenNext, with `noindex` everywhere except Production.

Access itself only guards the canonical hosts, so the Worker's own check is what keeps `*.workers.dev` (with the smoke-test header) from serving data. Local runs (`APP_ENV=local`: `wrangler.jsonc`'s top level and `wrangler.e2e.jsonc`) skip steps 1, 2, and 4; `next dev` never runs the Worker entry.

## CI

`.github/workflows/ci.yml` runs `check` on pull requests and on pushes to `staging` and `main`. On a push to either branch, the `deploy` job (shown as `deploy-staging` or `deploy-production`) waits for `check` and then, in order:

1. Warns and stops if `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is missing.
2. `pnpm web:access-ready <env>`: the deploy guard, using the Worker's own configuration check. When it fails, the job warns and skips the website steps; the sync still deploys.
3. Builds the sync (`wrangler deploy --dry-run`) and the website (`pnpm build:web`: the OpenNext build and the bundled-env check).
4. Skips everything below unless the commit is still the branch tip.
5. `pnpm db:migrate:<env>`. This job is the only one that migrates an environment's D1, which the sync and the website share.
6. `pnpm deploy:sync:<env>`, then `opennextjs-cloudflare deploy --env <env>`.
7. `pnpm smoke:web <env> <subdomain>` against `https://<website Worker>.<subdomain>.workers.dev`, where CI reads the account's workers.dev subdomain with a read-only API call (`GET /accounts/<id>/workers/subdomain`). With the smoke-test header, `/` and `/api/health` must answer 403 (no data without Access), with `noindex` on Staging and without it on Production, and `/robots.txt` must disallow (Staging) or allow (Production) crawling. Without the header, the host must answer 308 to the canonical host. It retries for about two minutes while the new version reaches the edge.
8. Verifies no migration is pending and prints both Workers' deployment status.

Each environment's group (`deploy-staging`, `deploy-production`) queues deploys and never cancels one. The token needs Account: Workers Scripts, D1, and R2 edit, and, for the Custom Domains, Zone: Workers Routes edit on `serp.co`. `deploy:sync:<env>` and `deploy:web:<env>` exist for a person in an emergency; agents never run `--remote` commands from their own machine.

## Promotion

`staging` is the base and default branch: pull requests merge into it, and each merge deploys Staging. Production is reached only by promotion, a fast-forward of `main` to `staging` (`git fetch origin && git push origin origin/staging:main`), which deploys Production. If `main` has diverged, open a `staging` to `main` pull request merged with a merge commit, then merge `main` back into `staging` (SERP `git-workflow.md`).

## Known gaps

- The Sync status page still says "Daily at 15:30 UTC" on Staging, whose cron is weekly.
- CI can't test the canonical hosts (Bot Fight Mode on CI runners); the owner checks that an Access sign-in reaches the table.
