# Production sync

Production is the ingestion Worker only; the website has no deployed environment until #27. The top level of `apps/web/wrangler.ingestion.jsonc` stays local-only, and `env.production` declares every binding, because named environments inherit none:

- Worker `auction-domain-aggregator-ingestion-production` on the SERP account, with no workers.dev or preview URL, `cpu_ms` 60,000 (Workers Paid), observability on, and the `30 15 * * *` Cron Trigger.
- D1 `auction-domain-aggregator-production` (created 2026-10-07, APAC), binding `DB`, ledger `d1_migrations`.
- R2 `auction-domain-aggregator-feed-pages-production`, binding `FEED_PAGES`. A lifecycle rule (`expire-staged-feed-pages`) expires `feed-pages/` objects after 2 days, so pages a failed cleanup step leaves behind can't accumulate.
- Workflow `auction-domain-aggregator-provider-sync-production` (workflow names are account-wide), binding `PROVIDER_SYNC`, class `ProviderSyncWorkflow`.
- Secret `DYNADOT_API_PRODUCTION_KEY`, which the owner sets with `wrangler secret put DYNADOT_API_PRODUCTION_KEY --config wrangler.ingestion.jsonc --env production`. Without it, Dynadot's instance fails with `dynadot_missing_credentials` and the others run.

CI deploys it (`deploy-sync-production` in `.github/workflows/ci.yml`) on each push to `main` after `check` passes: build with `--dry-run`, skip unless the commit is still `main`'s tip, `pnpm db:migrate:production`, `pnpm deploy:sync:production`, then verify no migration is pending. It needs the `CLOUDFLARE_API_TOKEN` secret (D1, Workers Scripts and R2 edit) and the `CLOUDFLARE_ACCOUNT_ID` variable, and warns without deploying when either is missing. Agents never run `--remote` commands locally.

Schema and runtime behavior are in [Data ingestion and persistence](data-ingestion.md).
