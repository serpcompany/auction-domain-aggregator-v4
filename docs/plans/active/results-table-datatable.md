# Rebuild the results table on datatable-example-01's interaction model

Issue: #123. Related: #13 (table UX gaps), #106 (saved searches), #122 (DR filter).

## Purpose / Big Picture

The owner wants the results table to behave like shadcn studio's "DataTable 1" (`datatable-example-01`,
the "Payouts" demo): a menu on every column header (Asc, Desc, Pin to left or right, Move to left or
right, Columns), a filter bar of rules (field, operator, value) with a Filters button and Clear, and
richer cells (pills, header icons, a row action menu). After this work a person can sort, pin, move,
and hide columns from the headers, and add, change, or remove filter rules on the table page without
opening `/filters/`. Every rule and sort is still a URL parameter that D1 answers for the 1.5M
listings, and the browser never filters or sorts rows itself. Pin and move survive a reload in the
same browser and never appear in a shared URL.

## Progress

- [x] (2026-10-08) Tried to install the block; read its behavior and dependencies from the public
  preview instead (see Surprises).
- [x] (2026-10-08) Wrote this plan.
- [x] (2026-10-08) Owner decided the four open questions (Decision Log).
- [ ] M1 Page size 96 and one DR request per page, with rows read measured.
- [ ] M2 Client table shell: flat metric headers and header menus (sort, Columns).
- [ ] M3 Pin and move, saved per browser.
- [ ] M4 Filter rule bar over today's parameters, with a measured bind count.
- [ ] M5 Cell polish: pills, header icons, row action menu.
- [ ] M6 (deferred) Maximum filters, only after the bind-budget decision below.
- [ ] Move this plan to `docs/plans/completed/` with an outcome summary.

## Surprises & Discoveries

- The block is not free. Its card says "Basic", and "Basic Blocks" are licensed under the paid Basic
  License (US$99 one-time on `shadcnstudio.com/pricing` on 2026-10-08). The registry answers
  `https://shadcnstudio.com/r/blocks/base-nova/datatable-example-01.json` with HTTP 401, "License key
  and email are required"; other styles answer the same. No install was made.
- The licence forbids "publicly sharing a repository of Resources or derivatives", and
  `serpcompany/auction-domains-finder` is public.
- From the preview's shipped JavaScript (read, not copied): the block uses `@tanstack/react-table`
  (`useReactTable`, `flexRender`, core, sorted, filtered, and pagination row models). Its registry
  item has three files: a page, the block component, and `hooks/use-pagination.ts` (ellipsis page
  numbers). Its UI parts are Avatar, Badge, Button, Command, Dropdown Menu (with Sub and Checkbox
  items), Input, Popover, Select, Table, and Sonner toasts. Only Avatar is new here, and this plan
  does not need it.
- State in the block: `columnOrder`, `columnPinning`, and `pagination` are controlled React state;
  sorting and visibility are TanStack's internal state. Filter rules are not TanStack column filters:
  they are an array of `{ id, fieldId, operator, value }` applied by a hand-written predicate before
  the data reaches TanStack. Operators by field type: text (contains, does not contain, starts
  with, ends with, is, is not, is empty, is not empty), number (is, is not, greater than, less
  than), select (is, is not), date (is, is before, is after). Each rule chip has a menu: Duplicate,
  Negate, Remove. The Filters button is a Popover with a Command list of fields not yet used. Clear
  resets rules, column order, pins, and sorting, but not visibility. Move swaps a column with its
  unpinned neighbour and is disabled on pinned columns. Pinned cells get `position: sticky` with
  offsets from TanStack's `getStart`/`getAfter`. Rows per page: 5, 10, 25, 50. Nothing persists:
  a reload resets everything. There is no column resizing, and its header is one flat row with an
  icon per column. Status pills use Tailwind palette colors.
- The block filters as the user types. Here every rule change is a D1 request, so value inputs must
  commit on Enter, blur, or selection, never per keystroke.
- The page's DR and SEO lookups bind every domain on the page (`inArray(..., pageDomains)` in
  `domain-listings-query.ts`; the DR one also binds `ahrefs_dr`), so a page may hold at most 98 rows.
- `DomainRatingsProvider` (`domain-ratings.tsx`) calls `router.refresh()` when a DR request stores
  ratings, and a refresh re-runs every D1 read of the page. Two DR requests per page must not mean
  two refreshes.

## Decision Log

- Decision (owner, 2026-10-08): do not buy the licence. Build a look-alike with the same
  functionality from the public preview's behavior and rendered DOM (devtools-level inspection is
  fine), from stock shadcn parts. Never commit the block's source.
- Decision: no TanStack; keep `docs/technical-design/technology-stack.md`'s "no client table
  framework" rule. Sorting, filtering, and paging stay on the server, and the block's rules never
  used TanStack. What TanStack would hold is column order, pins, visibility, and sizes. Widths live in
  CSS variables so a drag re-lays out the table without re-rendering rows; TanStack's sizing would
  re-render on every pointer move, and its pin offsets are pixel numbers where CSS `calc()` over the
  same variables stays correct mid-drag. The column model is about a hundred lines of pure functions
  the server renders from cookies and unit tests cover fully. If row virtualization, multi-sort, or
  row selection arrive, record an exception then, limited to column state with `manualSorting`,
  `manualFiltering`, and `manualPagination`. Author: agent, 2026-10-08.
- Decision: a fixed page size of 96 rows, no rows-per-page picker (owner asked for the fewest D1
  reads). Reasoning: a page load reads every matching row once for the count and, for most sorts,
  once more for the page (it sorts every match in a temporary B-tree), plus about 500 facet rows and
  two lookups of one row per page row. With N matches and P rows per page, browsing K listings reads
  about (K / P) × (2N + 500 + 2P) rows. On the default page N is about 960,000, so each load reads
  about 1.9 million rows and the 2P term is noise: 96 rows reads about half as much per listing seen
  as 50, and a person who looks only at page 1 pays the same either way. Smaller pages never save
  reads. The ceiling is the page lookups' bind count (P + 1 ≤ 100); 96 leaves 3 spare and splits into
  two DR requests of 48 under the route's 50-domain limit. M1 measures it. Author: agent, 2026-10-08.
- Decision: flatten the metric headers into one row; drop the Majestic/Semrush/Ahrefs group row.
  Each metric header names its vendor in a small muted line above the metric (Majestic over TF) and
  carries the vendor in its menu and tooltip. The DR header's vendor line is the "Domain Rating by
  Ahrefs" link, outside the menu button, so the attribution the Ahrefs licence requires stays
  visible, linked, and next to the values wherever the column is moved or pinned. Reasoning from
  mature grids: AG Grid states that "Pinned columns break groups" and splits a group into a pinned
  and an unpinned part, and offers `marryChildren` to stop a child leaving its group or a column
  entering it ([AG Grid column groups](https://www.ag-grid.com/react-data-grid/column-groups/)). MUI
  X stops grouped columns from being dragged out of their group unless the group sets
  `freeReordering` ([MUI X column groups](https://mui.com/x/react-data-grid/column-groups/)).
  TanStack builds separate header groups per pinned section (`getStartHeaderGroups`,
  `getCenterHeaderGroups`, `getEndHeaderGroups`; `getLeft`/`getRight` in v8), so a parent header is duplicated in each section
  that holds one of its children ([header groups guide](https://github.com/TanStack/table/blob/main/docs/guide/header-groups.md),
  `packages/table-core/src/features/column-pinning/columnPinningFeature.utils.ts`). Airtable has no
  column groups: fields are flat, hidden per view, and frozen by dragging a divider
  ([hiding fields](https://support.airtable.com/docs/hiding-fields-and-field-visibility-overview)).
  So every grid that keeps groups must either restrict moves or split headers; our groups hold one
  to three columns, so they carry too little to pay for either rule. A flat row also matches the
  block and lets every column pin and move the same way. Author: agent, 2026-10-08.
- Decision (owner, 2026-10-08): keep the shared category cap at 64. The owner expects to move off D1
  eventually, but not now. The worst accepted listing query binds 89 of D1's 100 values after #122.
  Maximum filters on the eight listing numbers and five metrics would reach 98 of 100, so any filter
  after that forces a choice: lower the cap, bind constant strings as SQL literals, or move off D1.
  Maximum filters are therefore deferred to M6, which starts only after that choice; M4 offers only
  the operators today's parameters express.
- Decision: rules use the existing per-field parameters, not a new generic encoding, so old links,
  the Filters page, the chips, and saved searches (#106) keep working. Author: agent, 2026-10-08.
- Decision: pin and move live in one cookie, `column-layout`, beside `columns` and `column-widths`.
  The server renders from it, so there is no flash; the client writes it without `router.refresh()`,
  so a pin or move costs no D1 read. Author: agent, 2026-10-08.

## Outcomes & Retrospective

Nothing is implemented yet. Update at each milestone.

## Context and Orientation

Run every command from `apps/web/` unless stated. The page is `apps/web/src/app/page.tsx`. It reads
the `columns` and `column-widths` cookies and passes them to
`apps/web/src/components/auctions/auctions-page.tsx`, which renders the toolbar
(`auctions-toolbar.tsx`: search, source/type/TLD faceted filters, ending window, phone sort select,
Columns menu), the active-filter chips (`active-filters.tsx`), the table (`results-table.tsx`, a
server component with a two-row header for the metric groups), the phone list below `md`
(`results-list.tsx`), and server pagination (`results-pagination.tsx`, Next links).
`column-resize.tsx` is the client island for drag and keyboard resizing; widths are CSS variables
named by `columnWidthVariable` in `apps/web/src/domain/table-columns.ts`, the one column registry
(`TABLE_COLUMNS`). Domain is always shown, sticky left, and not in the registry. The Columns menu
(`columns-menu.tsx`) writes the `columns` cookie and calls `router.refresh()`, which re-runs the
page's D1 reads.

`apps/web/src/domain/domain-table.ts` parses search parameters into `DomainTableFilters`
(`parseDomainTableFilters`) and builds links (`buildDomainTableHref`); `DOMAIN_TABLE_PAGE_SIZE` is
50. `apps/web/src/server/queries/domain-listings-query.ts` turns filters into SQL in
`activeListingWhere`. "Bound values" are the `?` parameters of one statement; D1 rejects more than
100. This plan assumes #122 (`domainRatingMin`, open on `feat/domain-rating-filter`) has merged.

`auction_listings` indexes: `(status, provider)`, `(domain_name)`, `(tld, status, ends_at)`,
`(domain_length, status, ends_at)`. Price, bids, age, links, visitors, appraisal, and renewal have no
index; they are checked on the rows the status or TLD index yields. Metric filters are
`domain_name in (select ...)` subqueries on `(value, domain_name)` indexes in `domain_seo_metrics`
and `(metric, value, domain_name)` in `domain_metrics`, which serve ranges.

The DR column shows a spinner (`PendingRating`) for unfetched domains while it is visible;
`DOMAIN_RATING_REQUEST_LIMIT` in `apps/web/src/server/enrichment/domain-rating.ts` caps a request
at 50 domains. UI rules: stock shadcn `base-nova` on `@base-ui/react`, tokens only
(`apps/web/src/design-tokens.test.ts`), checks at 1440px and 390px. Coverage is 100% over `src/`.

## Plan of Work

### M1 Page size 96

Set `DOMAIN_TABLE_PAGE_SIZE` to 96 and update pagination, skeleton row counts, fixtures, and e2e
expectations. `DomainRatingsProvider` splits pending domains into requests of at most 48 and
refreshes once, after all of them settle, if any stored a rating. Extend
`scripts/benchmark-domain-filters.ts` to sum D1's `meta.rows_read` per request (the D1 result meta
reports it) and record, for page sizes 50 and 96, rows read per load and per listing shown on the
default page, `.com`, and a DR sort. Keep 96 only if rows read per listing shown falls; record the
numbers here. Update `docs/technical-design/domain-discovery.md` ("page size is always 50").

### M2 Client table shell, flat headers, and header menus

Make `results-table.tsx` a client component that receives the page's rows, the filters, and the
layout (visibility, widths, later pins and order) from the server, which still renders it first.
Replace the two-row header with one row: each metric header shows its vendor line above the label,
and the DR vendor line is the Ahrefs link (see Decision Log). Each header cell holds a Dropdown Menu
trigger (icon, label, sort arrow, pin icon) and `ColumnResizeHandle`, whose pointer and key handlers
stop propagation so a drag never opens the menu. Asc and Desc are menu items rendered as Next
`Link`s (`render` prop) to `buildDomainTableHref`, so sorting stays a server navigation; `aria-sort`
stays on the `th`. The Columns submenu holds checkbox items; Domain cannot be hidden. Visibility now
changes on the client and writes the `columns` cookie without `router.refresh()`, so
`DomainRatingsProvider` takes the DR-visible flag from client state. Keep `ColumnsMenu` in the
toolbar for phones and keyboard users.

### M3 Pin and move

Add to `table-columns.ts`: `COLUMN_LAYOUT_COOKIE = 'column-layout'`, `parseColumnLayout`,
`serializeColumnLayout` (for example `order=price,source,...;left=price;right=domainRating`; unknown
keys ignored, missing registry columns appended in registry order), `orderedColumns(layout,
visible)`, and `stickyOffsets(layout)`, which returns CSS `calc()` sums of `columnWidthCss` for each
pinned column. Domain stays first and sticky at `left: 0`; left-pinned columns stack after it,
right-pinned ones before the Details column, which gets a fixed width. Move swaps with the
neighbouring unpinned column; pinned columns cannot move. The Columns menu's reset also clears the
layout. Pins and order are never URL parameters.

### M4 Rule bar over today's parameters

A new pure module `apps/web/src/domain/filter-rules.ts` exports `rulesFromFilters(filters): Rule[]`
and `applyRule(filters, rule): DomainTableFilters`, the only code the rule bar uses. Operators are
those today's parameters express, which no D1 change needs:

| Field | Operators | Parameters |
| --- | --- | --- |
| Domain | contains; has no hyphens; has no digits | `q`, `noHyphens`, `noDigits` |
| Source, Type, TLD | is any of | repeated `source`, `type`, `tld` |
| Length, Price, Age | ≥, ≤, = (equal ends), between | `<field>Min`, `<field>Max` |
| Bids, Links, Visitors, Appraisal, TF, CF, Ref. domains, AS, DR | ≥ | `<field>Min` |
| Renewal | ≤ | `renewalMax` |
| Ends | within 1h to 7d | `endingWithin` |

Negations and "is empty" are left out: none can narrow an index, and a constraint already excludes
unknown values. Header sorts keep `sort=<key>&direction=asc|desc`; every change resets `page`.
On `md` and wider, one row replaces the faceted filters, ending select, and chips: the search box as
the permanent "Domain contains" rule (keeping the `/` shortcut), one rule per active field, a Filters
button (Popover and Command listing unused fields), and Clear all (today's link, which keeps the
sort). A rule shows the field, an operator Select, and a value control (Input; the existing Combobox
chips for "is any of"; Select for the ending window) with a menu holding Remove. Values commit on
Enter, blur, or selection via `router.push`. Below `md` the toolbar keeps its phone layout and links
to `/filters/`, which stays. #122's Fetch DR button stays at the end of the row. Add a workerd test
that reads `toSQL().params.length` of the worst accepted count and row statements and fails above 89.

### M5 Cells

Type and ending urgency as Badge pills colored only through tokens (add tokens if needed), a lucide
icon per header from the registry, and a row action menu (Details, Open auction, Copy domain) in
place of the Details button.

### M6 Maximum filters (deferred)

Adds `Max` parameters for bids, links, visitors, appraisal, and the five metrics, and `renewalMin`,
which brings the worst query to 98 of 100 bound values. Start only after the owner chooses between a
lower category cap, SQL literals for the constants `active`, `%-%`, and `ahrefs_dr`, or leaving D1.

## Concrete Steps

From `apps/web/`, per milestone: `corepack pnpm exec vitest related --run <files>`,
`corepack pnpm exec tsc --noEmit -p .`, `corepack pnpm exec biome check <files>`, then
`corepack pnpm check` (Biome, types, migrations, both Vitest projects at 100% coverage, and Playwright
pass). For M1 and M4 also `corepack pnpm exec vitest run --project workers` and
`corepack pnpm benchmark:filters`. For UI milestones run
`corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001` and check 1440px and 390px. From the
repository root: `node .github/scripts/check-docs.mjs`.

## Validation and Acceptance

- M1: a page shows 96 rows; the benchmark records rows read per listing shown below the 50-row
  figure; a page with unfetched DRs sends two requests and refreshes at most once.
- M2: choosing Desc in the Price header menu navigates to `sort=price&direction=desc&page=1`; hiding
  a column sends no page request; resizing works by mouse and keyboard; the header and Domain column
  stay sticky; the Ahrefs link is visible in the DR header.
- M3: pin Price left, move Bids right, reload: the layout is unchanged and the URL has no layout
  parameter; another browser profile shows the default layout.
- M4: adding "Price ≤ 500" navigates to `priceMax=500&page=1`; typing sends no request until Enter
  or blur; Clear all removes every rule and keeps the sort; the bind-count test passes.
- All: phones at 390px show the list; DR spinners resolve; `design-tokens.test.ts` passes; coverage
  stays 100%.

## Idempotence and Recovery

Every milestone is a separate pull request into `staging` and can be reverted alone. Page size is
one constant. The new cookie is ignored by older code and reset by the Columns menu; a malformed
value parses to the default layout. No migration is planned; if a plan shows a needed index, stop
and record it here first (index writes cost D1 rows on every sync).

## Artifacts and Notes

Preview inspected: `https://shadcnstudio.com/preview/blocks/base/datatable/datatable-example/
datatable-example-01` and its JavaScript chunks, 2026-10-08. Licence: `https://shadcnstudio.com/
license` (last updated 2026-01-13). Nothing from the block is stored in this repository.

## Interfaces and Dependencies

No new packages. Stock components already present: Dropdown Menu (Sub, Checkbox items), Popover,
Command, Select, Input, Input Group, Combobox, Badge, Button, Table, Tooltip. New interfaces:
`filter-rules.ts` (`Rule`, `rulesFromFilters`, `applyRule`) and the `column-layout` cookie helpers in
`table-columns.ts`. `queryDomainListingsWithDatabase` keeps its signature.

Revision notes:

- 2026-10-08: first version, written after the registry refused an unlicensed install.
- 2026-10-08: recorded the owner's four decisions: look-alike without a licence; a fixed 96-row page
  for the fewest reads (new M1); flat metric headers, with sources; category cap kept at 64 and
  maximum filters deferred to M6.
