# Rebuild the application UI from stock shadcn

Completed 2026-10-07 (Claude, with the owner) across #51, #59, #53, #55, #54, #65, #56, #57, and #58, tracked in #52. This is the outcome summary; the full ExecPlan, with milestones, commands, and the before-and-after file table, is in git history (`git show 907d382:docs/plans/completed/ui-redesign.md`). The approved mockups are [`ui-redesign-mockups.html`](ui-redesign-mockups.html).

## Outcome

The data layer (D1 queries, the URL contract, `apps/web/src/domain/domain-table.ts`, enrichment, ingestion) stayed; the presentation layer was rebuilt to the SERP web UI rules.

- Stock shadcn `base-nova` components in a `sidebar-07` shell, light and dark themes through `next-themes`, and the app moved to `apps/web/` with Biome (#51).
- Auctions: a one-row toolbar with faceted filters, user-selectable columns saved per browser, every column sortable (metric sorts added at the owner's request, #65), a details panel, a list layout on phones, and designed loading, DR-pending, empty, stale, and error states.
- A full Filters page at `/filters/` and a Sync status page at `/syncs/`.
- Guard rails: `apps/web/src/design-tokens.test.ts` fails on literal colors and palette classes, and the Playwright journeys on the workerd preview fail on any uncaught page error.

## Key decisions

- **Rebuild the presentation, keep the data and URL layers,** which were tested and correct.
- **The app is a dashboard,** so it uses the `sidebar-07` block, not a marketing header (SERP shadcn-first standard). Only built screens appear in the nav.
- **Stock `Table`, server-rendered and server-paginated,** with faceted filters from the shadcn tasks example (Popover and Command) and no TanStack, because D1 does the sorting, filtering, and paging.
- **Below `md`, an `Item` list instead of the table,** both in the HTML with CSS showing one: eleven columns cannot fit 390 px, and 50 rows is a small DOM cost.
- **The details panel is client state, not a URL parameter,** so opening it re-runs no query; it uses the row already loaded.
- **Columns are a per-browser cookie read by the server,** so there is no flash of hidden columns and the shareable URL stays about results. One registry (`apps/web/src/domain/table-columns.ts`) drives the table, the menu, the skeleton, and the phone badges.
- **Every filter lives on a full `/filters/` page** (owner request): a panel would be too small once the filter set grows toward SpamZilla's. Source, TLD, Max bid, and Ends stay in the toolbar.
- **SERP trailing-slash rule:** pages are canonical with a slash and the slashless form redirects with a 308; `/api/*`, `/_next`, and `/.well-known` are never redirected, because a redirect would break the DR enrichment POST. A Worker entry (`apps/web/worker.ts`) applies it, with `trailingSlash: true` and `skipTrailingSlashRedirect: true`.
- **Loading is a `Suspense` boundary keyed by the table URL,** not `app/loading.tsx`, which shows only on the first navigation to a route, not on search-parameter changes.
- **Implement only after the owner approves the mockups;** a visible deviation needs re-approval.

## Discoveries

- Wrangler bundles with esbuild `keep_names`, which injects `__name()` into the function `next-themes` serializes into its inline script, and the script then throws in the browser. `"keep_names": false` in `wrangler.jsonc` and `wrangler.e2e.jsonc` fixes it.
- Next 16's `proxy.ts` runs only on Node, and OpenNext refuses to build it. A `next.config.ts` redirect loops, because Next matches each source with or without its trailing slash. Hence the Worker entry.
- A few Biome recommended rules conflict with stock shadcn files; `apps/web/biome.json` turns them off for `src/components/ui/**` only, so those files stay byte-for-byte what `shadcn add` writes.
- The old app rendered in Times, because the Geist variables were on `<body>` while `font-sans` was applied on `<html>`.
- shadcn blocks ship a demo `page.tsx`; delete it after `shadcn add`.

## Follow-ups at completion

- Majestic and Semrush sorts take about 1.2 s on the full local inventory; copying the metrics onto `auction_listings` at sync time would make them index-backed ([Domain discovery](../../technical-design/domain-discovery.md)).
- The Filters page's section nav does not highlight the section in view.
- The details panel blurs the table behind it (stock Sheet backdrop), where the mockup kept it visible.
- Biome `noNonNullAssertion` warnings remained (62 at the time).

## Lessons

- Check OpenNext compatibility early: both the `proxy.ts` and the `keep_names` problems surfaced only in the workerd e2e run.
- `loading.tsx` does not cover search-parameter navigations; a `Suspense` boundary keyed by the URL does.
