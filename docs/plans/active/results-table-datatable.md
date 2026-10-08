# Rebuild the results table on datatable-example-01's interaction model

Issues: #123 (goal), #125 (approved prototype and full UI spec). Related: #13, #106, #113, #122.

## Purpose / Big Picture

The owner wants the results table to behave like shadcn studio's "DataTable 1" (`datatable-example-01`)
as refined by the approved prototype in #125: one header row with a menu on every column (sort, pin,
move, hide), a wrapping rule bar (field, operator, value) with Filters, Clear all, and Save, row
selection, a row action menu, richer cells, and named saved views. After this work a person sorts,
pins, moves, and hides columns from the headers and edits filter rules on the table page without
opening `/filters/`. Every rule, search, and sort is still a URL parameter that D1 answers for the
1.5M listings; the browser never filters or sorts rows. Layout survives a reload in the same browser
and never appears in a shared URL.

## Progress

- [x] (2026-10-08) Tried to install the block; read its behavior from the public preview instead.
- [x] (2026-10-08) Wrote this plan; the owner decided its open questions.
- [x] (2026-10-08) The owner approved the prototype; #125 records it, and this plan follows it.
- [ ] M1 Page size 96 and at most two DR requests per page, with rows read measured.
- [x] (2026-10-08) M2 One-row headers, tooltips, header menus (sort, hide), Columns menu, footer.
- [x] (2026-10-08) M3 Pin and move, row selection column and bar, row action menu.
- [x] (2026-10-08) M4 Rule bar, Filters menu, Clear all; the worst statements bind 89 (tested).
- [ ] M5 Cells (source pills and tokens, countdown pill, DR ring) and the phone list.
- [ ] M6 Save and Views (named saved views, #106), built last.
- [ ] M7 (deferred) Maximum filters, only after the bind-budget decision below.
- [ ] Move this plan to `docs/plans/completed/` with an outcome summary.

## Surprises & Discoveries

- The block is not free: "Basic Blocks" fall under the paid Basic License (US$99 one-time on
  2026-10-08), and the registry (`/r/blocks/base-nova/datatable-example-01.json`) answers HTTP 401,
  "License key and email are required". The licence forbids "publicly sharing a repository of
  Resources or derivatives", and this repository is public. Nothing was installed.
- The preview's JavaScript (read, not copied) uses `@tanstack/react-table` row models and stock
  shadcn parts. Its rules are a plain array checked by its own predicate, not TanStack filters, and
  it filters as the user types; here every rule change is a D1 request. Nothing persists.
- The page's DR and SEO lookups bind every domain on the page (`inArray(..., pageDomains)` in
  `domain-listings-query.ts`; the DR one also binds `ahrefs_dr`), so a page may hold at most 98 rows.
- `DomainRatingsProvider` (`domain-ratings.tsx`) calls `router.refresh()` when a DR request stores
  ratings, and a refresh re-runs every D1 read of the page.

## Decision Log

All 2026-10-08. "Owner" decisions come from the owner directly or through #125.

- Owner: no licence. Build a look-alike from the preview's behavior and rendered DOM with stock
  shadcn parts; never commit the block's source.
- Agent: no TanStack; keep `technology-stack.md`'s "no client table framework" rule. Sorting,
  filtering, and paging stay on the server. Widths live in CSS variables so a drag re-lays out the
  table without re-rendering rows, and pinned offsets are CSS `calc()` over the same variables, which
  stays correct mid-drag. The column model is about a hundred lines of pure functions the server
  renders from cookies. If virtualization or multi-sort arrive, record an exception limited to column
  state with `manualSorting`, `manualFiltering`, and `manualPagination`.
- Owner: a fixed page size of 96, no picker, for the fewest D1 reads. A load reads every matching row
  for the count and, for most sorts, again for the page, plus about 500 facet rows and two lookups of
  one row per page row: browsing K listings reads about (K / 96) × (2N + 500 + 192) rows, where N is
  about 960,000 on the default page. That is about half the reads per listing seen of 50 rows, and a
  person who reads only page 1 pays the same. The ceiling is the page lookups' bind count (rows + 1
  ≤ 100); 96 splits into two DR requests of 48 under the route's 50-domain limit.
- Owner: one header row, no vendor group row. TF, CF, AS, and DR keep short labels, with Majestic
  Trust Flow, Majestic Citation Flow, Semrush Authority Score, and Domain Rating by Ahrefs in
  tooltips. References: AG Grid splits groups when columns are pinned ("Pinned columns break
  groups") and offers `marryChildren` to keep children together
  ([AG Grid](https://www.ag-grid.com/react-data-grid/column-groups/)); MUI X keeps grouped columns
  inside their group unless it sets `freeReordering`
  ([MUI X](https://mui.com/x/react-data-grid/column-groups/)); TanStack builds header rows per pinned
  section (`get{Start,Center,End}HeaderGroups`, `getLeft`/`getRight` in v8;
  [header groups guide](https://github.com/TanStack/table/blob/main/docs/guide/header-groups.md));
  Airtable has no column groups ([hiding fields](https://support.airtable.com/docs/hiding-fields-and-field-visibility-overview)).
  Groups of one to three columns are not worth those rules.
- Owner: DR attribution moves into the DR header tooltip, and a visible, linked "DR = Domain Rating
  by Ahrefs" line stays in the table footer and at the top of the phone list. Licence caveat: the
  Ahrefs DR licence asks for attribution that is visible, linked, adjacent to the values, and not
  hidden. Whether a footer line counts as adjacent is the open question in
  `docs/references/data-licensing/ahrefs.md` (the email to Ahrefs). If the answer is no, add a short
  visible "by Ahrefs" link in the DR header.
- Owner: Source is a pill with a colored dot per provider (Namecheap, GoDaddy, Dynadot, NameSilo),
  from new color tokens with light and dark values in `globals.css`.
- Owner: Ends is a countdown pill only (`1d 5h`), no date; amber under 48 hours, neutral otherwise;
  the exact end time in a tooltip. Today's red under one hour and amber under 24 hours give way.
- Owner: DR shows the number inside a ring that fills to the value, in a column about 72px wide; no
  bar.
- Owner: a row-selection checkbox column, pinned left of Domain. The header checkbox selects or clears
  every listed row and is indeterminate when some are selected; selected rows get a tint. While rows
  are selected, a bar shows "N selected", Save to list, and Clear selection. Save to list is a
  placeholder that says it comes in a later feature; lists need their own issue.
- Owner: a row action menu (⋮, pinned right) with Details, Open auction, and Copy domain replaces the
  Details button.
- Owner: Save and Views store named views (domain search, rules, sort, and layout: order, hidden
  columns, pins), folding in #106, built last. In the product, views belong to the signed-in account
  (#106, after #27); localStorage only if the owner wants them sooner. The layout cookie stays the
  default when no view is open.
- Owner: Semrush AS is hidden by default.
- Owner: keep the shared category cap at 64; the owner expects to leave D1 eventually, not now. The
  worst listing query binds 89 of 100 values after #122. Maximum filters would reach 98, so any filter
  after them forces a choice: lower the cap, bind the constants `active`, `%-%`, and `ahrefs_dr` as
  SQL literals, or leave D1. Maximum filters wait in M7.
- Agent: rules use the existing per-field parameters, so old links, the Filters page, and saved
  views keep working.
- Agent: layout (order, pins, hidden columns, widths) lives in browser cookies the server renders
  from; the client writes them without `router.refresh()`, so layout changes cost no D1 read.

## Outcomes & Retrospective

M2: hiding and Reset layout send no page request; the current sort is marked, not a link (no D1
re-read). Ref. dom. got a tooltip too, since its Majestic group row is gone.

M3 (2026-10-08): pins keep their place in `order`, so Unpin restores it; an empty widthless column
before the right pins keeps the 40px row actions exact; the header checkbox draws its dash through
className (the stock Checkbox shows a check). Details in `domain-discovery.md`.

M4: a rule sends no request until Enter, leaving it, or choosing an option; a list rule applies
when its list closes, so three TLDs cost one D1 read. Save waits for M6, and the desktop "All
filters" link is gone. The bind test seeds a full page of worst-case matches, since Drizzle binds no
offset on page 1.

## Context and Orientation

Run commands from `apps/web/`. The page (`src/app/page.tsx`) reads the `columns` and `column-widths`
cookies and renders `src/components/auctions/auctions-page.tsx`: the toolbar (`auctions-toolbar.tsx`:
search, faceted filters, ending window, phone sort select, Columns menu), chips
(`active-filters.tsx`), the table (`results-table.tsx`, a server component with a two-row header),
the phone list below `md` (`results-list.tsx`), and pagination (`results-pagination.tsx`, Next links).
`column-resize.tsx` is the client resize island; widths are CSS variables named by
`columnWidthVariable` in `src/domain/table-columns.ts`, the column registry (`TABLE_COLUMNS`). The
Columns menu writes the `columns` cookie and calls `router.refresh()`, which re-runs the D1 reads.

`src/domain/domain-table.ts` parses search parameters into `DomainTableFilters` and builds links
(`buildDomainTableHref`); `DOMAIN_TABLE_PAGE_SIZE` is 50. `src/server/queries/domain-listings-query.ts`
turns filters into SQL in `activeListingWhere`. "Bound values" are the `?` parameters of one
statement; D1 rejects more than 100. This plan assumes #122 (`domainRatingMin` and Fetch DR) merged.
Indexes on `auction_listings`: `(status, provider)`, `(domain_name)`, `(tld, status, ends_at)`,
`(domain_length, status, ends_at)`; metric filters use `(value, domain_name)` indexes in
`domain_seo_metrics` and `(metric, value, domain_name)` in `domain_metrics`.
`DOMAIN_RATING_REQUEST_LIMIT` (`src/server/enrichment/domain-rating.ts`) caps a DR request at 50
domains. UI rules: stock shadcn `base-nova` on `@base-ui/react`, tokens only
(`src/design-tokens.test.ts`), checks at 1440px and 390px. Coverage is 100% over `src/`.

## Plan of Work

### M1 Page size 96

Set `DOMAIN_TABLE_PAGE_SIZE` to 96 and update pagination, skeleton rows, fixtures, and e2e
expectations. `DomainRatingsProvider` sends pending domains in at most two requests of 48 and
refreshes once, after both settle, if either stored a rating. Extend
`scripts/benchmark-domain-filters.ts` to sum D1's `meta.rows_read` per request, and record rows read
per load and per listing shown at 50 and 96 rows (default page, `.com`, a DR sort). Update
`docs/technical-design/domain-discovery.md` ("page size is always 50").

### M2 Headers, menus, Columns, footer

Make `results-table.tsx` a client component that receives rows, filters, and layout from the server,
which still renders it first. One header row; TF, CF, AS, and DR get Tooltips with their full names.
Each header holds a Dropdown Menu trigger (label, sort indicator, later a pin icon) and
`ColumnResizeHandle`, whose pointer and key handlers stop propagation so a drag never opens the menu.
Menu: Sort ascending and Sort descending as Next `Link` items (`render` prop) to
`buildDomainTableHref`, so sorting stays a server navigation, and Hide column; Domain's menu has
sorting only; `aria-sort` stays on the `th`. Hiding writes the `columns` cookie without
`router.refresh()`, so `DomainRatingsProvider` takes the DR-visible flag from client state. The
toolbar's Columns menu keeps a checkbox per column and gains Reset layout. Semrush AS becomes hidden
by default. Add the footer: "Showing 1–96 of N · 96 per page", the visible linked "DR = Domain Rating
by Ahrefs" line, and pagination; put the same line at the top of the phone list.

### M3 Pin, move, selection, row menu

Add `COLUMN_LAYOUT_COOKIE`, `parseColumnLayout`, `serializeColumnLayout` (`order:a,b|left:a|right:b`;
a `;` ends a cookie), `orderedColumns`, and `stickyOffsets` (`calc()` over the width variables) to
`table-columns.ts`. Checkbox and Domain stick left, left pins after them, right pins before the ⋮
row menu (Details, Open auction, Copy domain); shadow edges and pin icons; Pin, Unpin, Move left and
right (disabled at the ends and when pinned); Reset layout clears the cookie. Client-only selection
with an indeterminate header checkbox, tinted rows, and a bar (Save to list toast, Clear). Not on phones.

### M4 Rule bar

A pure module `src/domain/filter-rules.ts` exports `rulesFromFilters(filters): Rule[]` and
`applyRule(filters, rule): DomainTableFilters`. Operators are those today's parameters express:

| Field | Operators | Parameters |
| --- | --- | --- |
| Domain | contains; has no hyphens; has no digits | `q`, `noHyphens`, `noDigits` |
| Source, Type, TLD | is any of | repeated `source`, `type`, `tld` |
| Length, Price, Age | ≥, ≤, = (equal ends), between | `<field>Min`, `<field>Max` |
| Bids, Links, Visitors, Appraisal, TF, CF, Ref. domains, AS, DR | ≥ | `<field>Min` |
| Renewal | ≤ | `renewalMax` |
| Ends | within 1h to 7d | `endingWithin` |

Done (2026-10-08): the rule bar replaced the faceted toolbar and chip row on md and wider; phones
keep their toolbar, chips, and `/filters/`. Behavior and the bind budget are in
`docs/technical-design/domain-discovery.md`.

### M5 Cells and phone

Source pills with a provider dot from new tokens (light and dark values); Type pills; the Ends
countdown pill (amber under 48 hours, exact time in a Tooltip); the DR ring (an SVG circle whose
stroke fills to the value, with the number inside, about 72px column); `—` in muted text for missing
values. Update `formatEndTime` urgency states and their tests. The phone list keeps domain, price, a
source, type, and bids line, the countdown, and TF, CF, and DR pills with DR emphasized.

### M6 Saved views

Save opens a Popover with a name field (suggested from the rules, for example "Majestic TF ≥ 25")
and Save view; Enter saves, and an existing name is replaced. A view stores the URL's search, rules,
and sort plus the layout (order, hidden columns, pins). Views lists them; choosing one navigates to
its URL and applies its layout; × deletes. Storage belongs to the signed-in account (#106, after
#27). If the owner wants views sooner, keep them in localStorage behind the same interface.

### M7 Maximum filters (deferred)

`Max` parameters for bids, links, visitors, appraisal, and the five metrics, and `renewalMin`, which
bring the worst query to 98 of 100 values. Start only after the bind-budget choice above.

## Concrete Steps

From `apps/web/`, per milestone: `corepack pnpm exec vitest related --run <files>`,
`corepack pnpm exec tsc --noEmit -p .`, `corepack pnpm exec biome check <files>`, then
`corepack pnpm check` (Biome, types, migrations, both Vitest projects at 100% coverage, and
Playwright). For M1 and M4 also `corepack pnpm exec vitest run --project workers` and
`corepack pnpm benchmark:filters`. For UI milestones run
`corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001` and check 1440px and 390px in light
and dark. From the repository root: `node .github/scripts/check-docs.mjs`.

## Validation and Acceptance

- M1: a page shows 96 rows; the benchmark records fewer rows read per listing shown than at 50; a
  page with unfetched DRs sends at most two requests and refreshes at most once.
- M2: one header row; hovering TF shows "Majestic Trust Flow" and DR shows "Domain Rating by Ahrefs";
  Sort descending on Price navigates to `sort=price&direction=desc&page=1`; Hide column and Reset
  layout send no page request; a resize drag never opens a menu; Domain's menu has sorting only; the
  footer shows "Showing 1–96 of N · 96 per page" and a visible link to ahrefs.com; Semrush AS is
  hidden by default.
- M3: pin Price left and move Bids right, then reload: the layout is unchanged, the URL has no layout
  parameter, and another browser profile shows the default; pinned columns stay sticky with a shadow
  edge; Move is disabled at the ends and on pinned columns; selecting two rows shows "2 selected",
  the header checkbox is indeterminate, and Clear selection empties it; Save to list shows the
  placeholder; the ⋮ menu opens Details, opens the auction in a new tab, and copies the domain.
- M4: Filters › Price adds a rule with its value focused; "Price ≤ 500" navigates to
  `priceMax=500&page=1`; typing sends no request until Enter or blur; × removes one rule; Clear all
  removes every rule and keeps the sort; old URLs parse to the same filters; the bind test passes.
- M5: each provider's pill dot uses its token in light and dark; an auction ending in 30 hours shows
  an amber countdown with no date and the exact time in its tooltip; DR 63 shows a ring about
  two-thirds full; the phone list shows the DR line at the top.
- M6: save "Majestic TF ≥ 25", change rules and layout, choose the view: URL and layout return;
  saving the same name replaces it; × deletes it.
- All: phones at 390px show the list with no selection, pins, or column menus; DR spinners resolve;
  `design-tokens.test.ts` passes; coverage stays 100%.

## Idempotence and Recovery

Each milestone is a separate pull request into `staging` and can be reverted alone. Page size is one
constant. Older code ignores the new cookie, Reset layout clears it, and a malformed value parses to
the default layout. No migration is planned before M6; if a query plan needs an index, stop and
record it here first (index writes cost D1 rows on every sync).

## Artifacts and Notes

Inspected 2026-10-08: the block's public preview and `https://shadcnstudio.com/license`. The
approved prototype is linked from #125. Nothing from the block is stored in this repository.

## Interfaces and Dependencies

No new packages. Stock components present: Dropdown Menu, Popover, Command, Select, Input, Input
Group, Combobox, Badge, Button, Checkbox, Table, Tooltip, Sonner. New: `filter-rules.ts` (`Rule`,
`rulesFromFilters`, `applyRule`), the `column-layout` cookie helpers in `table-columns.ts`, provider
color tokens in `globals.css`, and in M6 a saved-view store interface. `queryDomainListingsWithDatabase`
keeps its signature.

Revision notes:

- 2026-10-08: first version, written after the registry refused an unlicensed install.
- 2026-10-08: recorded the owner's four decisions: look-alike without a licence, a fixed 96-row page
  (new M1), flat metric headers with sources, and the category cap kept at 64 with maximum filters
  deferred.
- 2026-10-08: aligned with the approved prototype (#125): tooltips and footer DR attribution with its
  licence caveat, provider pills and tokens, countdown pill, DR ring, row selection and bar, row
  action menu, AS hidden by default, and saved views as M6; maximum filters moved to M7.
