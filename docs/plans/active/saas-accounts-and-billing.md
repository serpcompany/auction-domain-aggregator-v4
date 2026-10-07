# Paid SaaS: accounts, $27/month subscription, payment-gated access

This ExecPlan follows `docs/plans/README.md`. It covers GitHub issue #27 and the website deploy that #15 deferred. Keep it current at every stopping point.

## Purpose / Big Picture

Today the discovery table runs only on the owner's machine; production runs only the daily sync (`docs/technical-design/production-sync.md`). After this plan, a visitor to the site's domain sees a public landing and pricing page, signs in with a one-time code sent by email, pays $27/month through Stripe Checkout, and then uses the Auctions, Filters, and Sync status pages against the production database. Without an active subscription, every app page and app API answers with the pricing page or 402, never data. The owner can observe it end to end on Staging with Stripe test mode before Production takes a real card.

## Progress

- [x] (2026-10-07) Read #27, its decisions comment, and SERP's `better-auth.md`, `payments.md`, `transactional-email.md`, `environment-configuration.md`, and `git-workflow.md`; drafted this plan.
- [ ] Owner decisions in "Decisions needed" answered and recorded in the Decision Log.
- [ ] Milestone 1: Staging environment and website deploy, gated.
- [ ] Milestone 2: sign-in with an emailed one-time code.
- [ ] Milestone 3: subscriptions, Stripe adapter, webhook, and the access gate.
- [ ] Milestone 4: public pages and account page.
- [ ] Milestone 5: per-user abuse and cost controls.
- [ ] Milestone 6: Production launch and `Stage: ship`.

## Surprises & Discoveries

None yet.

## Decision Log

- 2026-10-06, owner: one plan at $27/month, no free trial; Better Auth on the existing D1; Stripe first, moving later to SERP's Lago fork with Easy Pay Direct, so billing stays behind a swappable module and the app gates on its own D1 subscription record (#27 comment).
- 2026-10-07, owner: production is the sync only until this plan ships the website; the domain is still to be chosen (#15).
- 2026-10-07, Claude: follow SERP `payments.md` (orders ledger, `billing_events`, `BillingProvider` interface) adapted to a subscription: the entitlement is a `subscriptions` row, and each paid invoice is an `orders` row. Rationale: the standard's shape is what the Lago move expects.

## Decisions needed (owner)

1. **Domain.** Better Auth needs a canonical origin (`BETTER_AUTH_URL`), Stripe needs a webhook URL, and email sends from `support@{domain}`. Must be a zone on the SERP Cloudflare account.
2. **Staging.** SERP standards require a Stripe test-mode purchase and refund on Staging before Production. Adding Staging makes `staging` the base branch and `main` Production by promotion (`git-workflow.md`). Recommended: yes.
3. **Licensing (#28).** Dynadot's terms forbid showing its API data to third parties; GoDaddy licenses its feed for internal use; Namecheap is approved by the owner; DropCatch and NameSilo are unaddressed. Launch options: (a) show only approved providers to subscribers, (b) get written permission first, (c) accept the risk. The gate in Milestone 3 can filter providers per audience either way.
4. **Stripe account.** The owner creates the product and the $27/month price in test and live mode and sets the keys as Worker secrets; agents never create Stripe objects or handle keys.
5. **Stage.** Move `AGENTS.md` to `Stage: ship` before the first real user, payment, or public release (`verification-cadence.md`); only the owner edits that line.

## Outcomes & Retrospective

Not started.

## Context and Orientation

The app is `apps/web`: Next.js 16 on Cloudflare Workers through OpenNext, D1 through Drizzle (`apps/web/src/server/db/schema.ts`), stock shadcn UI. Pages: `/` (Auctions), `/filters/`, `/syncs/`. The only API that calls a paid third party is `POST /api/enrichment/domain-rating` (Ahrefs). `apps/web/worker.ts` is the Worker entry: trailing-slash rule, then OpenNext, with noindex outside production (`src/lib/indexing.ts`). `apps/web/wrangler.jsonc` has only a local top level today. The production D1 `auction-domain-aggregator-production` already exists and is shared with the sync Worker (`apps/web/wrangler.ingestion.jsonc`). CI deploys from `.github/workflows/ci.yml`.

Terms: an *entitlement* is the app's own record that a user may use the app now. A *one-time code* is the 6-digit code Better Auth's `emailOTP` plugin emails. The *orders ledger* is the D1 record of every charge and refund.

## Plan of Work

**Milestone 1: Staging and a gated website deploy.** Add `env.staging` to both Wrangler configs with its own D1, R2, Workflow, Worker names, and `APP_ENV`; add `env.production` to `wrangler.jsonc` for the website. Add `db:migrate:staging` and deploy scripts, and CI jobs per `ci-workflows.md` (staging deploys from `staging`, production from `main`). Until Milestone 3, Staging and Production websites sit behind Cloudflare Access (owner-created, owner-only) so no data is public. Proof: CI deploys Staging; the site answers 302 to Access without a session.

**Milestone 2: sign-in.** Add Better Auth with `drizzleAdapter` and the `emailOTP` plugin; generate its tables into the Drizzle schema; one route handler at `/api/auth/*` that serves only the endpoints used (send code, verify code, get session, sign out) and 404s the rest, tested by walking Better Auth's router; D1-backed rate limits; no response reveals whether an email has an account. Email through Cloudflare Email Service with a `send_email` binding and a local dev mailbox, from `support@{domain}`. Staging limits sign-up to an allowlist var. Proof: sign in on Staging with a code; `GET /api/auth/get-session` 200; bad input 4xx.

**Milestone 3: billing and the gate.** Add `subscriptions` (user, status, current period end, provider, provider customer and subscription IDs), `orders`, and `billing_events` (unique provider event ID). Define `BillingProvider` with `createCheckout`, `verifyWebhook`, and `refund`, and a Stripe adapter using `Stripe.createFetchHttpClient()` and `constructEventAsync`. Webhook at `/api/webhooks/stripe`: verify, insert the event idempotently, update `subscriptions` and `orders`, return 2xx fast. Gate: a server guard on every app page and app API reads the user's `subscriptions` row from D1 per request; no Stripe call at request time. Proof: Stripe test-mode checkout on Staging activates access; cancel and failed-payment events remove it; duplicate events are no-ops.

**Milestone 4: public pages.** Landing and pricing at `/`, with the app moving under `/app/` (decide during implementation; keep URLs canonical with trailing slashes). Terms and privacy pages, an account page with plan status and a manage-billing link through the provider module (Stripe customer portal). Provider tokens in return URLs are stripped before render, and Workers Logs set `redact_query_string`. UI is stock shadcn, checked at 1440px and 390px.

**Milestone 5: abuse and cost controls.** Per-user D1 rate limits on the table queries and on DR enrichment; enrichment requires an active subscription; no CSV or bulk export; page size capped. Proof: tests for each limit.

**Milestone 6: launch.** Owner sets `Stage: ship`, live Stripe keys, and the production domain; promote `staging` to `main`; smoke tests on Production (sign-in 2xx/4xx, gate 402 without subscription, webhook reachable, noindex off only for public pages). Record the Stripe-to-Lago migration path: export active `subscriptions`, import them through the Lago fork's imported-subscription recovery (`serpcompany/lago` `docs/evidence/epd-imported-recovery-readiness-2026-09-22.md`), then swap the adapter.

## Concrete Steps

Commands run from `apps/web` with `corepack pnpm`. Each milestone ends with `corepack pnpm check` and, for UI, a check at 1440px and 390px. Remote changes happen only in CI, except owner-approved resource creation. Exact commands are added to this section as each milestone starts.

## Validation and Acceptance

Accepted when, on Production: an anonymous visitor sees landing and pricing and gets no listing data from any page or API; a new email signs in with a code, pays $27 in Stripe Checkout, and immediately sees the Auctions table; cancelling ends access at the period end; a refund is recorded in `orders`; Stripe webhook retries are no-ops.

## Idempotence and Recovery

Migrations are additive and generated by Drizzle. Webhook handling is idempotent by event ID, so replaying events from the Stripe dashboard is safe. If the webhook was down, replaying missed events restores `subscriptions`. Rolling back the website deploy leaves the sync untouched; the gate fails closed (503) when auth or billing configuration is missing.

## Artifacts and Notes

None yet.

## Interfaces and Dependencies

New packages: `better-auth`, `stripe`. New Worker secrets per environment (owner sets): `BETTER_AUTH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AHREFS_API_KEY`. New vars: `BETTER_AUTH_URL`, `EMAIL_FROM`, `APP_ENV`, `STRIPE_PRICE_ID`, staging `SIGNUP_ALLOWLIST`. New bindings: `send_email` `EMAIL`. Stable interface: `BillingProvider { createCheckout, verifyWebhook, refund }`; pages and the gate read only D1.

Revision note, 2026-10-07: first draft from #27 and the SERP standards, before the owner's answers to "Decisions needed".
