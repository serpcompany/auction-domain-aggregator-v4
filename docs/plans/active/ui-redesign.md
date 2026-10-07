# Rebuild the application UI from stock shadcn

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must remain accurate while implementation proceeds.

Maintain this plan according to `docs/plans/PLANS.md` from the repository root.

## Purpose / Big Picture

The data layer works: D1 holds about 857,000 active listings from Dynadot and GoDaddy, filters and sorts run in D1 from a normalized URL, and Ahrefs DR arrives on demand. The page built on top of it does not. It renders in Times, opens with a marketing-style header, puts a full filter form above the results (on a phone the first screen is nothing but form fields), and squeezes an 11-column, 1440-pixel-wide table of two-line cells into a nested scroll box.

This plan removes the current presentation layer and rebuilds it to the SERP web UI rules: stock shadcn `base-nova` components and blocks first, color only through `apps/web/src/app/globals.css` tokens, and a check at 1440 and 390 pixels. The server queries, the URL contract, the pure filter and formatting logic in `apps/web/src/domain/domain-table.ts`, the enrichment route, and ingestion stay as they are.

After this plan, the owner opens the app and sees an application shell with a sidebar, a one-row filter toolbar, and a dense one-line-per-listing table that fills the window, with the columns the owner chooses; on a phone, a list of listings. Every filter lives on a full Filters page that can grow to SpamZilla's size, while the common ones stay in the toolbar. Every state (loading, fetching DR, stale inventory, no matches, no inventory, database error) has a designed screen. A details panel shows everything a row leaves out, and a Sync status screen shows each provider's runs.

Out of scope: new providers, new filters, changes to D1 queries other than the optional sync-status read, accounts, deployment, and the SERP tooling migration (Biome, `apps/web/`), which is a separate decision recorded below.

## Progress

- [x] (2026-10-07 02:20Z) Audited the current UI at 1440 and 390 pixels against the SERP standards (`~/dev/repos/serp/docs/engineering/standards/web-stack/`) and serp.co's "Rules for UI work".
- [x] (2026-10-07 02:40Z) Published clickable mockups of every Auctions state and the proposed Sync status screen, desktop and phone, light and dark: https://claude.ai/artifact/1i9ibPDzwU5QmibwhD6UNm
- [x] (2026-10-07) Owner reviewed v1: "looks good", plus two requests: show and hide columns, and a whole page for filters instead of a panel, because SpamZilla needs a full page for its options.
- [x] (2026-10-07) Published mockups v2 at the same URL with a Columns menu, a Custom columns state, and a full-page Filters screen on desktop and phone.
- [x] (2026-10-07) Owner settled the open decisions (Sync status in, dark mode in, tooling first) and filed the work: tracking #52; #51 tooling; #59 Milestone 0; #53 Milestone 1; #54 Milestone 2; #55 Milestone 2b; #56 Milestone 3; #57 Milestone 4; #58 Milestone 5.
- [ ] #51: Biome and `apps/web/` (prerequisite).
- [x] (2026-10-07) Milestone 0 (#59): committed the plan and mockups (`docs/plans/active/ui-redesign-mockups.html`), updated the product spec, and recorded the trailing-slash decision. PR open for owner approval.
- [ ] Milestone 0 (#59): owner approves the spec PR.
- [ ] Milestone 1 (#53): foundation reset (tokens, fonts, refreshed `ui/`, guard test, app shell).
- [ ] Milestone 2 (#54): Auctions page on desktop (toolbar, quick filters, column registry and Columns menu, table, pagination).
- [ ] Milestone 2b (#55): Filters page at `/filters/`.
- [ ] Milestone 3 (#56): details panel and the phone layout.
- [ ] Milestone 4 (#57): loading, error, empty, stale, and DR-pending states.
- [ ] Milestone 5 (#58): Sync status screen.
- [ ] Milestone 6 (in #52): documentation, final verification at both widths, plan moved to `completed/`.

## Surprises & Discoveries

- Observation: The whole app renders in the browser's default serif font.
  Evidence: `getComputedStyle(document.body).fontFamily` is `"Times"` on `http://127.0.0.1:30001/`. `apps/web/src/app/layout.tsx` puts the Geist variables on `<body>`, but `globals.css` applies `font-sans` (which reads `--font-geist-sans`) on `<html>`, where the variable is undefined.

- Observation: `apps/web/src/components/ui/` is no longer fully stock.
  Evidence: `apps/web/src/components/ui/sheet.tsx` sizes its close button `size-11`, a local edit. The components were installed in #38 and have not been refreshed since.

- Observation: Majestic metrics are almost empty in the local inventory, so two dedicated Majestic columns mostly show zeros.
  Evidence: on 2026-10-07, 10 rows of `domain_seo_metrics` have `majestic_tf > 0` (highest TF 13, `rrss.org`); most GoDaddy domains carry TF 0, CF 0, and Semrush AS 2.

- Observation: Dynadot reports age 0 for listings such as `gxld.com`, displayed today as "0 years".
  Evidence: rows sorted by price with `bidsMin=5`. Presentation only; the value is stored as received.

- Observation: The shadcn `sidebar-07` block also installs a demo route.
  Evidence: shadcn blocks ship a `page.tsx` alongside their components. Delete it after `shadcn add` (Milestone 1).

## Decision Log

- Decision: Rebuild the presentation layer; keep the data and URL layers.
  Rationale: `apps/web/src/server/**`, `apps/web/src/domain/domain-table.ts`, `apps/web/src/app/api/**`, and the URL parameters are tested and correct. Only `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`'s render, `apps/web/src/app/globals.css`, and `apps/web/src/components/**` change.
  Date/Author: 2026-10-07, Claude with the owner.

- Decision: The app is a dashboard, so it uses the stock `sidebar-07` block (collapses to icons, becomes a Sheet on phones) with `SidebarInset`, not a marketing header.
  Rationale: SERP's shadcn-first standard: "Account and admin areas are dashboards, built on the sidebar and dashboard blocks." Only built screens appear in the nav.
  Date/Author: 2026-10-07, Claude.

- Decision: Results stay in the stock `Table`, server-rendered and server-paginated. Faceted filters follow the shadcn tasks example (Popover + Command) without TanStack.
  Rationale: Sorting, filtering, and paging happen in D1, which the standard's "stock Table for server-paginated results" covers. The owner does not use TanStack.
  Date/Author: 2026-10-07, Claude.

- Decision: Under the `md` breakpoint the server renders the listings as an `Item` list instead of the table; both are in the HTML and CSS shows one.
  Rationale: Eleven columns cannot fit 390 pixels. Rendering both avoids client-side layout code; 50 rows is a small DOM cost.
  Date/Author: 2026-10-07, Claude.

- Decision: The details panel is client state, not a URL parameter.
  Rationale: Opening it must not re-run the count and page queries. It uses only the row the page already loaded. Revisit if the owner wants shareable detail links.
  Date/Author: 2026-10-07, Claude.

- Decision: Columns are user-selectable from a Columns menu (DropdownMenu checkbox items, the shadcn data table "View" pattern). Domain is always shown. Renewal, Visitors, Length, and Majestic referring domains are optional columns, off by default. The choice is stored in a cookie that `page.tsx` reads, so the server renders only the chosen columns.
  Rationale: Owner request (2026-10-07). A cookie avoids a flash of hidden columns and survives reloads; it is a personal view setting, so it stays out of the shareable URL. One column registry drives the table, the menu, the skeleton, and the phone badges. If the list outgrows a menu, the same registry can feed a Dialog.
  Date/Author: 2026-10-07, owner request, Claude design.

- Decision: Every filter lives on a full page at `/filters/`, which replaces the More filters sheet on desktop and the filter drawer on phones. It carries the current query string; Show results navigates to `/?...` on page 1 and Cancel returns unchanged. Sections (General, Auction, Name, Activity and value, SEO metrics) are Cards with a sticky section nav that counts active filters per section. Source, TLD, Max bid, and Ends stay in the toolbar as quick filters.
  Rationale: Owner request (2026-10-07): a panel will be too small once the filter set grows toward SpamZilla's. This does not add any SpamZilla filter now; `docs/references/spamzilla/` stays reference material only.
  Date/Author: 2026-10-07, owner request, Claude design.

- Decision: New pages follow the SERP trailing-slash standard: `/filters/` and `/syncs/` are canonical, the slashless form redirects with a 308, and `/api/*` is served exactly as requested, never redirected. Next's `trailingSlash: true` alone would also redirect API routes, so #53 enables it with `skipTrailingSlashRedirect: true` and a `apps/web/src/proxy.ts` that adds the slash only for page paths outside `/api`. All internal links use the slashed form. The homepage stays `/`.
  Rationale: The standard (`serp/docs/engineering/standards/url-trailing-slash.md`) exempts `/api` because redirects break callers; the DR enrichment POST must not hop. This also settles the trailing-slash item in #36 for this app.
  Date/Author: 2026-10-07, Claude, recorded in #59 for owner approval.

- Decision: Implement only after the owner approves the mockups; a visible deviation needs re-approval before merge.
  Rationale: SERP shadcn-first standard, "Designing a new screen".
  Date/Author: 2026-10-07, Claude.

- Decision: The owner approved the direction of mockups v1 ("looks good") and requested v2's columns and Filters page. #59 records the behavior changes in the product spec for final approval before implementation.
  Date/Author: 2026-10-07, owner.

- Decision: Include the Sync status screen (Milestone 5, #58). It reads `ingestion_runs` and per-provider active counts from D1 only.
  Date/Author: 2026-10-07, owner.

- Decision: Add dark mode with a header toggle through `next-themes` (Milestone 1, #53).
  Date/Author: 2026-10-07, owner.

- Decision: Move to Biome and the `apps/web/` layout in a separate issue, #51, done before Milestone 1. After it lands, every path in this plan gains the `apps/web/` prefix and `prettier` commands become Biome's.
  Date/Author: 2026-10-07, owner.

## Outcomes & Retrospective

Not started. Update at each milestone.

## Context and Orientation

The repository root is `/Users/devin/dev/repos/auction-domain-aggregator-v4`, a single Next.js 16 app on Cloudflare Workers through OpenNext, with D1 through Drizzle. Read `AGENTS.md`, `ARCHITECTURE.md`, and `docs/technical-design/technology-stack.md` first.

Terms used here:

- shadcn `base-nova`: the shadcn component style built on `@base-ui/react`. `apps/web/components.json` already selects it with base color `neutral`, CSS variables, and lucide icons. "Stock" means a component file in `apps/web/src/components/ui/` exactly as `shadcn add` wrote it.
- Block: a shadcn registry item that installs a whole region (for example `sidebar-07`) as editable site components.
- Facets: the Source, Auction type, and TLD values offered by filters, read from the `listing_facets` table that each successful sync rebuilds.
- Token: a CSS custom property in `apps/web/src/app/globals.css` (`--background`, `--warning-foreground`, and so on). Components use Tailwind classes that map to tokens (`bg-background`), never palette classes (`bg-gray-100`) or literal colors.

What exists now and what happens to it:

| Path | Today | In this plan |
| --- | --- | --- |
| `apps/web/src/app/page.tsx` | Parses the URL, queries D1, renders `DomainDiscovery` | Same data flow; also reads the columns cookie; renders the new Auctions page |
| `apps/web/src/app/filters/page.tsx` | Does not exist | New: the full Filters page |
| `apps/web/src/app/layout.tsx` | Fonts on `<body>`, skip link | Fonts on `<html>`, theme provider, sidebar shell, Sonner `Toaster` |
| `apps/web/src/app/globals.css` | base-nova neutral plus `--link`, `--warning`, `--warning-foreground` | Reset to stock base-nova neutral plus `--warning` and `--warning-foreground`; `--link` removed |
| `apps/web/src/components/domain-discovery.tsx` (276 lines) | Page composition | Deleted |
| `apps/web/src/components/domain-filters.tsx` (827 lines) | One client form with an Apply button | Deleted; replaced by toolbar quick filters and the Filters page |
| `apps/web/src/components/domain-results-table.tsx` (470 lines) | Two-line cells, 1440 px minimum width | Deleted; replaced by results table and results list |
| `apps/web/src/components/domain-discovery.test.tsx` (1142 lines) | Component tests | Replaced by tests next to each new component |
| `apps/web/src/components/enrich-visible-domain-ratings.tsx` | Posts visible domains without DR, refreshes | Kept; moved under `apps/web/src/components/auctions/` |
| `apps/web/src/components/ui/*` | Installed in #38; `sheet.tsx` edited | Refreshed from the registry, kept stock |
| `apps/web/src/domain/domain-table.ts` and tests | Parsing, hrefs, chips, formatting | Kept; compact formatters added only as needed |
| `apps/web/src/server/**`, `apps/web/src/app/api/**` | D1 reads, DR enrichment | Unchanged, except `apps/web/src/server/queries/sync-status.ts` in Milestone 5 |
| `apps/web/e2e/domain-discovery.spec.ts` (3 tests) | Browser acceptance on workerd | Same three journeys, rewritten for the new markup |

## Plan of Work

### Milestone 0: approval

Nothing is built until the owner approves the mockups at https://claude.ai/artifact/1i9ibPDzwU5QmibwhD6UNm and settles the pending decisions above. Revise and republish the same artifact for each round of feedback. Then update `docs/product-specs/initial-domain-discovery.md` for every approved behavior change in one docs-only pull request, so later pull requests implement an agreed spec.

### Milestone 1: foundation reset

Make the app shell and design base correct before any page work, so later milestones only compose stock parts.

Refresh every installed component with `shadcn add --overwrite` and review the diff; `sheet.tsx` returns to stock and any call site that relied on its edit gets a `className`. Reset `globals.css` to the stock base-nova neutral tokens plus the warning pair. Move the Geist font variables to `<html>`, which fixes the Times fallback. Add the components later milestones need (list under Interfaces). Apply the trailing-slash decision (`trailingSlash: true`, `skipTrailingSlashRedirect: true`, and `apps/web/src/proxy.ts` exempting `/api`). Install the `sidebar-07` block, delete its demo route and placeholder content (team switcher, projects, user menu), and keep its structure: `SidebarProvider`, `AppSidebar` with the brand and one "Discover" group, `SidebarInset` with a header holding `SidebarTrigger`, a `Breadcrumb`, the freshness `Badge`, and the theme toggle. The existing page renders inside the inset unchanged for now.

Add a Vitest guard, `apps/web/src/design-tokens.test.ts`, that fails when any file under `apps/web/src/` other than `apps/web/src/app/globals.css` contains a hex, `rgb(`, `hsl(`, or `oklch(` color, or a Tailwind palette class such as `text-gray-500` or `bg-white`. The SERP standard asks for this check to be encoded rather than left to review.

Observable result: the current page, in Geist, inside the new shell; the sidebar collapses to icons on desktop and opens as a Sheet at 390 pixels.

### Milestone 2: Auctions page on desktop

Replace the page body with the approved desktop design. Components live in `apps/web/src/components/auctions/`.

- Toolbar: an Input Group search with a `/` Kbd hint that applies on Enter; faceted Source and TLD filters (Popover + Command with checkboxes; TLD lists every facet value and filters as you type); a Max bid popover; an Ends popover with the five windows; an All filters link to the Filters page showing the count of filters set there; Reset when anything is applied; the listing count; and the Columns menu at the right end. Every change navigates with `router.push(buildDomainTableHref(...))` inside `useTransition` and returns to page 1.
- Active filters: one removable outline Badge per constraint from `getDomainTableFilterChips`, then Clear all. These are server-rendered links, as today.
- Columns: `apps/web/src/components/auctions/columns.ts` is the one registry of column definitions (key, label, group, sort key, default visibility, cell renderer). The Columns menu writes the `columns` cookie and calls `router.refresh()`; `page.tsx` parses the cookie against the registry, ignoring unknown keys and falling back to the defaults. The Columns button shows a Custom badge when the set differs from the default.
- Table: renders only the chosen columns. A header group row for Majestic (TF, CF, referring domains), Semrush (AS), and "Domain Rating by Ahrefs" (DR, linked to `https://ahrefs.com/`, as the licence requires) shrinks or disappears with its columns; single-line 40-pixel rows; sortable headers as Next links with `aria-sort`; sticky header and Domain column; the table frame is the scroll region and the page itself does not scroll at desktop sizes. Ends shows the relative time colored by urgency and the absolute UTC time beside it.
- Pagination: "Showing 1–50 of N", "Page X of Y", and first, previous, next, last as Next links styled with `buttonVariants` (the stock `PaginationLink` hydration issue is recorded in the technology-stack document).

Delete `domain-discovery.tsx` and `domain-results-table.tsx` in this milestone. `domain-filters.tsx` goes in Milestone 2b. Delete their test file, and replace them with tests per component. Rewrite the three Playwright journeys for the new markup without weakening what they assert.

### Milestone 2b: Filters page

Add `apps/web/src/app/filters/page.tsx`. It parses the same search parameters with `parseDomainTableFilters` and reads the facets it needs for Source, Auction type, and TLD. It renders `FiltersForm`, a client component in `apps/web/src/components/filters/`, that holds draft state and navigates to `buildDomainTableHref(draft, { page: 1 })` on Show results. Layout as mocked: a sticky section nav with per-section counts; one Card per section of Fields (ranges as one Field with Min and Max inputs; TLD as the stock Combobox with chips; Ends within as a Toggle Group); a sticky bottom bar with the filter count or the validation message, Reset all, Cancel (back to the unchanged results URL), and Show results. Keep today's minimum-greater-than-maximum validation and its message, disabling Show results until it is fixed. The page uses the same layout at 390 pixels in one column, with section chips at the top. Then delete `domain-filters.tsx`. Confirm the trailing-slash rule for `/filters/` the same way as for `/syncs/` (Milestone 5).

### Milestone 3: details panel and phone layout

Add `ListingDetails`: a client provider that receives the page's rows and opens a Sheet at `md` and wider or a Drawer below it (the docs' responsive dialog pattern with the `useIsMobile` hook the sidebar installs). Content matches the mockup: Open auction (new tab), Copy domain with a Sonner toast, then Auction, Domain, and SEO metrics sections, with DR next to its attribution link.

Below `md`, render `ResultsList` (Item rows: domain link, price, source, type and bids, ends, and metric badges; tapping the row opens details), a Filters button linking to the Filters page, a Sort select, a Columns button opening a Drawer that chooses which metric badges each item shows (same cookie and registry), and compact pagination. A line above the list carries the "Domain Rating by Ahrefs" attribution.

### Milestone 4: states

Add `apps/web/src/app/loading.tsx` (shell, toolbar, and Skeleton rows at the real row height), `apps/web/src/app/error.tsx` (Empty in the table frame with the migration command and Try again calling `reset()`), the no-match and no-inventory Empty states, the stale-inventory Alert and warning badge, and a Spinner in DR cells while enrichment is pending. Show a pending state during `useTransition` navigations so filter changes feel immediate.

### Milestone 5: Sync status

Add `apps/web/src/server/queries/sync-status.ts` reading the latest runs per provider and recent `ingestion_runs`, plus active listing counts per provider, sequentially as the other reads are. Add `apps/web/src/app/syncs/page.tsx` with a Card per provider (status Badge in CardAction, active listings, last success, duration, records, next cron run at 15:30 UTC, the local sync command), an Alert when the latest run failed, and the recent-runs Table (Item list on phones). Add the nav item. Confirm how the SERP trailing-slash rule (`/syncs/`) applies here without redirecting `/api/*`, and record the result.

### Milestone 6: close-out

Update `ARCHITECTURE.md` (physical code map), `docs/technical-design/technology-stack.md` (component list, theming), and the product spec if anything changed during implementation. Run the full verification below, record evidence in this plan, and move it to `docs/plans/completed/`.

## Concrete Steps

Work from the repository root. Each milestone is one GitHub issue, one `issue-<n>-<slug>` branch from `main`, and one squash-merged pull request whose body starts with `Closes #<n>` and reports build, automated test, UI test, and owner-acceptance evidence separately.

Milestone 1 commands:

    corepack pnpm exec shadcn add --overwrite alert badge button card checkbox combobox empty field input input-group label pagination select separator sheet table textarea
    git diff --stat src/components/ui        # expect upstream-only changes; sheet.tsx loses size-11
    corepack pnpm exec shadcn add sidebar-07
    git status                                # delete the block's demo page.tsx
    corepack pnpm exec shadcn add breadcrumb popover command dropdown-menu toggle-group tooltip skeleton spinner kbd item drawer sonner progress
    corepack pnpm add next-themes
    corepack pnpm check:quick

Inspect every milestone in the running app:

    corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001

Then open `http://127.0.0.1:30001/` at 1440 and 390 pixels and compare each state with the matching mockup state. Before opening each pull request:

    corepack pnpm check

Expect formatting, lint, types, unit tests, the D1 integration proof, and Playwright on workerd to pass.

## Validation and Acceptance

The redesign is accepted when the owner, comparing the running app with the approved mockups, sees each of these at 1440 and 390 pixels with no sideways page scroll, visible focus, and WCAG AA contrast:

- The default page shows the shell, toolbar, and at least 16 listing rows above the fold at 1440 by 900 (about 6 today); at 390 pixels the first screen shows listings, not filter fields.
- Every filter and sort from the product spec still works, survives reload and Back, and produces the same URL parameters as before; existing links keep working.
- The domain opens the provider's auction in a new tab; the details control opens the panel; DR values sit next to "Domain Rating by Ahrefs" linked to `https://ahrefs.com/`.
- Hiding and showing columns from the Columns menu changes the table immediately, survives reload, and renders without a flash of the old column set; Reset to default restores it.
- The Filters page holds every filter, preserves the current filters when opened, and Show results and Cancel behave as mocked at both widths.
- Loading, DR pending, stale, no matches, no inventory, and database error each render as mocked.
- `apps/web/src/design-tokens.test.ts` passes, `git diff` against a fresh `shadcn add --overwrite` shows no edits under `apps/web/src/components/ui/`, and `corepack pnpm check` passes.
- `corepack pnpm benchmark:filters` shows no regression, since queries are unchanged.

## Idempotence and Recovery

Every milestone is a separate squash commit on `main`, so any one can be reverted alone. `shadcn add --overwrite` is safe to rerun; review its diff before committing. Milestones 1 to 4 do not touch the database or migrations. Milestone 5 adds a read-only query and no migration. Integration and browser tests use temporary D1 and never touch the owner's `apps/web/.wrangler` inventory. If a milestone stalls mid-way, the previous milestone's UI is still on `main` and working.

## Artifacts and Notes

- Mockups: https://claude.ai/artifact/1i9ibPDzwU5QmibwhD6UNm (v2, 2026-10-07). States: Results, Filtered, TLD filter open, Columns menu, Custom columns, Filters page, Filters: invalid range, Domain details, Loading, Fetching DR, Stale inventory, No matches, No inventory yet, Database error; Sync status Healthy, Sync running, Sync failed. Each at Desktop 1440 and Phone 390, light and dark.
- Mockup data: domains, prices, bids, end times, ages, appraisals, and Majestic and Semrush values come from local D1 (Oct 6 syncs: 472,855 GoDaddy and 384,557 Dynadot active listings). DR values and some low-value prices are illustrative.

## Interfaces and Dependencies

New shadcn components (stock, via `shadcn add`): `sidebar` (block `sidebar-07`, which brings `tooltip`, `skeleton`, `separator`, and the `use-mobile` hook), `breadcrumb`, `popover`, `command`, `dropdown-menu`, `toggle-group`, `drawer`, `spinner`, `kbd`, `item`, `sonner`, and `progress` for Milestone 5. Remove any installed component nothing imports at the end of Milestone 3.

New dependency: `next-themes` (`ThemeProvider` with `attribute="class"`, `suppressHydrationWarning` on `<html>`).

Unchanged interfaces the UI must keep using:

- `parseDomainTableFilters`, `buildDomainTableHref`, `getDomainTableFilterChips`, `hasActiveDomainTableFilters`, and the formatters in `apps/web/src/domain/domain-table.ts`.
- `queryDomainListings(filters): Promise<DomainListingsResult>` and `DomainListingRow` in `apps/web/src/server/queries/`.
- `POST /api/enrichment/domain-rating` and its 50-domain limit.

New site components, grouped by area as the SERP repository layout asks:

    src/components/app-shell/   app-sidebar.tsx, site-header.tsx, freshness-badge.tsx, theme-toggle.tsx
    src/components/auctions/    auctions-page.tsx, auctions-toolbar.tsx, faceted-filter.tsx, columns.ts, columns-menu.tsx,
                                active-filters.tsx, results-table.tsx, results-list.tsx, listing-details.tsx,
                                results-pagination.tsx, enrich-visible-domain-ratings.tsx
    src/components/filters/     filters-form.tsx, filter-section.tsx, range-field.tsx    (Milestone 2b)
    src/components/sync/        provider-card.tsx, runs-table.tsx            (Milestone 5)

Column registry and cookie:

    export type ColumnKey = 'source' | 'price' | 'bids' | 'ends' | 'age' | 'links' | 'appraisal'
      | 'renewal' | 'visitors' | 'length' | 'tf' | 'cf' | 'refDomains' | 'semrushAs' | 'domainRating';
    export interface ColumnDefinition {
      key: ColumnKey;
      label: string;
      group?: 'Majestic' | 'Semrush' | 'Ahrefs';
      sort?: DomainTableSort;          // from src/domain/domain-table.ts
      defaultVisible: boolean;
    }
    export const COLUMNS_COOKIE = 'columns';   // comma-separated ColumnKey values
    export function parseVisibleColumns(cookie: string | undefined): ColumnKey[];

Milestone 5 query shape:

    export interface ProviderSyncSummary {
      provider: string;
      activeListings: number;
      latestRun: IngestionRunRow | null;
      latestSuccess: IngestionRunRow | null;
    }
    export function querySyncStatus(): Promise<{ providers: ProviderSyncSummary[]; recentRuns: IngestionRunRow[] }>;

Browser components must not import `apps/web/src/server/`; pass data from the server page as props, as today.

Revision note (2026-10-07): created from the UI audit and mockups v1.

Revision note (2026-10-07): resolved the pending decisions and linked the GitHub issues.

Revision note (2026-10-07): after the owner's v1 review, added user-selectable columns (cookie-backed, one registry) and replaced the More filters sheet and phone filter drawer with a full Filters page at `/filters/` (Milestone 2b); mockups v2.
