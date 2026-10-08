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
- [ ] Owner answers the open questions in the Decision Log.
- [ ] M1 Rule contract: per-field operators in the URL, measured bind budget.
- [ ] M2 Client table shell with header menus (sort, Columns), no visible change in layout.
- [ ] M3 Pin and move, saved per browser.
- [ ] M4 Filter rule bar replaces the toolbar's filter controls on md and wider.
- [ ] M5 Cell polish: pills, header icons, row action menu.
- [ ] Move this plan to `docs/plans/completed/` with an outcome summary.

## Surprises & Discoveries

- The block is not free. Its card says "Basic", and "Basic Blocks" are licensed under the paid Basic
  License (US$99 one-time on `shadcnstudio.com/pricing` on 2026-10-08). The registry answers
  `https://shadcnstudio.com/r/blocks/base-nova/datatable-example-01.json` with HTTP 401, "License key
  and email are required"; other styles answer the same. No install was made.
- The licence forbids "publicly sharing a repository of Resources or derivatives".
  `serpcompany/auction-domains-finder` is public, so even with a licence the block's source must not
  be committed verbatim. This plan builds the same interactions from stock shadcn parts the
  repository already has, using the observed behavior as the specification.
- From the preview's shipped JavaScript (read, not copied): the block uses `@tanstack/react-table`
  (`useReactTable`, `flexRender`, core, sorted, filtered, and pagination row models). Its registry
  item has three files: a page, the block component, and `hooks/use-pagination.ts` (ellipsis page
  numbers). Its UI parts are Avatar, Badge, Button, Command, Dropdown Menu (with Sub and Checkbox
  items), Input, Popover, Select, Table, and Sonner toasts. Of these only Avatar is new here, and the
  plan does not need it.
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
  a reload resets everything. There is no column resizing. Status pills use Tailwind palette colors.
- The block filters as the user types. Here every rule change is a D1 request, so value inputs must
  commit on Enter, blur, or selection, never per keystroke.
- The page's DR and SEO lookups bind every domain on the page (`inArray(..., pageDomains)` in
  `domain-listings-query.ts`), so a rows-per-page option above about 98 would break D1's 100-value
  limit in that statement, not only in the listing query.

## Decision Log

- Decision: build the header menus and rule bar from stock shadcn components without TanStack, and
  keep `docs/technical-design/technology-stack.md`'s "no client table framework" rule. Rationale:
  sorting, filtering, and paging stay on the server, and the block's rules never used TanStack.
  What TanStack would hold is column order, pins, visibility, and sizes. Widths already live in CSS
  variables so a drag re-lays out the table without re-rendering rows; TanStack's sizing would
  re-render on every pointer move, and its pin offsets are pixel numbers where CSS `calc()` over the
  same variables stays correct mid-drag. The two-row Majestic/Semrush/Ahrefs header and the Ahrefs
  attribution need custom header rendering either way. The column model is about a hundred lines of
  pure functions that the server can render from cookies and that unit tests cover fully, against a
  new client dependency. If a later need (row virtualization, multi-sort, row selection) arrives,
  record an exception then, limited to column state with `manualSorting`, `manualFiltering`, and
  `manualPagination`. Date: 2026-10-08. Author: agent, pending owner approval.
- Decision: do not install or commit the block's source; the repository is public. Date: 2026-10-08.
- Decision: rules are the existing per-field parameters plus new maximums, not a new generic
  encoding. Old links, the Filters page, the chips, and saved searches (#106) keep working, and the
  bind budget stays per field. Date: 2026-10-08.
- Decision: pin and move live in one cookie, `column-layout`, beside `columns` and `column-widths`.
  The server renders from it, so there is no flash; the client writes it without `router.refresh()`,
  so a pin or move costs no D1 read. Date: 2026-10-08.
- Open question for the owner: buy the Basic licence for visual reference, or accept a look-alike
  built from stock parts? The plan assumes the look-alike.
- Open question: drop the rows-per-page select (fewer rows per page means more D1 requests to read
  the same listings), or offer 25 and 50 only? The plan assumes it is dropped.
- Open question: may metric columns pin and move only as their whole group (so the group header
  stays above them), with Move limited to neighbours in the same section? The plan assumes yes.
- Open question: lower the shared category cap from 64 to 48 values (see the budget table)?

## Outcomes & Retrospective

Nothing is implemented yet. Update at each milestone.

## Context and Orientation

Run every command from `apps/web/` unless stated. The page is `apps/web/src/app/page.tsx`. It reads
the `columns` and `column-widths` cookies and passes them to
`apps/web/src/components/auctions/auctions-page.tsx`, which renders the toolbar
(`auctions-toolbar.tsx`: search, source/type/TLD faceted filters, ending window, phone sort select,
Columns menu), the active-filter chips (`active-filters.tsx`), the table (`results-table.tsx`, a
server component), the phone list below `md` (`results-list.tsx`), and server pagination
(`results-pagination.tsx`, Next links). `column-resize.tsx` is the client island for drag and
keyboard resizing; widths are CSS variables named by `columnWidthVariable` in
`apps/web/src/domain/table-columns.ts`, the one column registry (`TABLE_COLUMNS`). Domain is always
shown, sticky left, and not in the registry. The Columns menu (`columns-menu.tsx`) writes the
`columns` cookie and calls `router.refresh()`, which re-runs the page's D1 reads.

`apps/web/src/domain/domain-table.ts` parses search parameters into `DomainTableFilters`
(`parseDomainTableFilters`) and builds links (`buildDomainTableHref`).
`apps/web/src/server/queries/domain-listings-query.ts` turns that value into D1 SQL in
`activeListingWhere`. "Bound values" are the `?` parameters of one statement; D1 rejects a statement
with more than 100. The worst accepted listing query binds 87 values on `staging` and 89 once #122
(`domainRatingMin`, open on `feat/domain-rating-filter`) merges; this plan assumes #122 has merged.

`auction_listings` indexes: `(status, provider)`, `(domain_name)`, `(tld, status, ends_at)`,
`(domain_length, status, ends_at)`. Price, bids, age, links, visitors, appraisal, and renewal have no
index; they are checked on rows the status or TLD index yields, so any comparison costs the same.
Metric filters are `domain_name in (select ...)` subqueries on `(value, domain_name)` indexes in
`domain_seo_metrics` and `(metric, value, domain_name)` in `domain_metrics`, which serve ranges.

The DR column shows a spinner (`PendingRating` in `domain-ratings.tsx`) for unfetched domains while
the column is visible, and its group header links "Domain Rating by Ahrefs", which the Ahrefs licence
requires to be visible and next to the values. UI rules: stock shadcn `base-nova` on
`@base-ui/react`, tokens only (`apps/web/src/design-tokens.test.ts` fails on palette colors), checks
at 1440px and 390px. Coverage is 100% over `src/`.

## Plan of Work

### URL format and operators (M1)

A rule is a field, an operator, and a value. The rule bar reads rules from `DomainTableFilters` and
writes them back as these parameters. Only operators an index serves, or that cost the same as
today's residual checks, are offered. Negations (is not, does not contain) and "is empty" are left
out: none can narrow an index, and a constraint already excludes unknown values.

| Field | Operators | Parameters | Served by | Max binds |
| --- | --- | --- | --- | ---: |
| Domain | contains | `q` | scan (as today) | 1 |
| Domain shape | has no hyphens, has no digits | `noHyphens`, `noDigits` | residual | 1 |
| Source, Type, TLD | is any of | repeated `source`, `type`, `tld` | `(status, provider)`, `(tld, ...)` | shared cap |
| Length | ≥, ≤, =, between | `domainLengthMin`, `domainLengthMax` | `(domain_length, ...)` | 2 |
| Price, Age | ≥, ≤, =, between | existing `Min`/`Max` | residual | 2 each |
| Bids, Links, Visitors, Appraisal | ≥, ≤, =, between | existing `Min`, new `Max` | residual | 2 each |
| Renewal | ≤, ≥, =, between | existing `renewalMax`, new `renewalMin` | residual | 2 |
| TF, CF, Ref. domains, AS | ≥, ≤, =, between | existing `Min`, new `Max` | metric index range | 2 each |
| Ahrefs DR | ≥, ≤, =, between | `domainRatingMin`, new `domainRatingMax` | `(metric, value, ...)` | 2 + 1 |
| Ends | within 1h to 7d | `endingWithin` | residual on `ends_at` | 1 |

"=" is written as equal minimum and maximum, and "between" as both; the parser already orders a
reversed range. Header sorts keep `sort=<key>&direction=asc|desc`, and every rule or sort change
resets `page`. Worst case, counted by hand (the test below settles it): 4 fixed (status, reference time, limit, offset), 3 for search, shape, and
ending, 16 for the eight listing ranges, 11 for the five metric ranges and the DR metric name, plus
the category cap: 98 with today's cap of 64, too close to 100. Lower `DOMAIN_TABLE_CATEGORY_VALUE_LIMIT`
to 48 (82 in all), or bind the constant strings `active`, `%-%`, and `ahrefs_dr` as SQL literals
(95). Replace the hand count with a test that reads `toSQL().params.length` of the worst accepted
count and row statements and fails above 90.

Edits: new `Max`/`Min` fields in `DomainTableFilters`, `parseDomainTableFilters`,
`buildDomainTableHref`, chips, `countAdvancedDomainTableFilters`, `apps/web/src/domain/filter-form.ts`
and the Filters page; matching predicates in `activeListingWhere` (metric maximums join the existing
subqueries); a new pure module `apps/web/src/domain/filter-rules.ts` with
`rulesFromFilters(filters): Rule[]` and `applyRule(filters, rule): DomainTableFilters`, the only code
the rule bar uses. No UI changes in M1. Update `docs/technical-design/domain-discovery.md`.

### Client table shell and header menus (M2)

Make `results-table.tsx` a client component that receives the page's rows, the filters, and the
layout (visibility, widths, and later pins and order) from the server, which still renders it first.
Each header cell holds a Dropdown Menu trigger (label, sort arrow, pin icon) and the existing
`ColumnResizeHandle`, whose pointer and key handlers stop propagation so a drag never opens the menu.
Asc and Desc are menu items rendered as Next `Link`s (`render` prop) to `buildDomainTableHref`, so
sorting stays a server navigation; `aria-sort` stays on the `th`. The Columns submenu holds checkbox
items for the registry; Domain cannot be hidden. Visibility now changes on the client and writes the
`columns` cookie without `router.refresh()`, so `DomainRatingsProvider` must take the DR-visible flag
from client state. The two-row grouped header and the Ahrefs link stay. Keep `ColumnsMenu` in the
toolbar for phones and keyboard users.

### Pin and move (M3)

Add to `table-columns.ts`: `COLUMN_LAYOUT_COOKIE = 'column-layout'`, `parseColumnLayout`,
`serializeColumnLayout` (for example `order=price,source,...;left=price;right=domainRating`; unknown
keys ignored, missing registry columns appended in registry order), `orderedColumns(layout,
visible)`, and `stickyOffsets(layout)`, which returns CSS `calc()` sums of `columnWidthCss` for each
pinned column. Domain stays first and sticky at `left: 0`; left-pinned columns stack after it,
right-pinned ones before the Details column, which gets a fixed width. Move swaps with the
neighbouring unpinned column in the same section (listing columns, or one metric group); a metric
column pins with its group. The Columns menu's reset also clears the layout. Pins and order are never
URL parameters.

### Rule bar (M4)

Replace the faceted filters, ending select, and chips on `md` and wider with one row: the search box
as the permanent "Domain contains" rule (keeping the `/` shortcut), one rule per active field built
from `rulesFromFilters`, a Filters button (Popover and Command listing fields not yet used, as the
toolbar's faceted filters already do), and Clear all (today's link, which keeps the sort). A rule
shows the field, an operator Select, and a value control: Input for numbers and money, the existing
Combobox chips for "is any of", Select for the ending window. Each rule's menu has Remove and, for
ranges, the operator choice. Values commit on Enter, blur, or selection via `router.push`. Below `md`
the toolbar keeps its phone layout and links to `/filters/`, which stays for every field. #122's
Fetch DR button stays at the end of the row.

### Cells (M5)

Type and ending urgency as Badge pills colored only through tokens (add tokens if needed), a lucide
icon per header from the registry, and a row action menu (Details, Open auction, Copy domain) in
place of the Details button. No rows-per-page select unless the owner asks for it.

## Concrete Steps

From `apps/web/`, per milestone: `corepack pnpm exec vitest related --run <files>`,
`corepack pnpm exec tsc --noEmit -p .`, `corepack pnpm exec biome check <files>`, then
`corepack pnpm check` (expect Biome, types, migrations, both Vitest projects at 100% coverage, and
Playwright to pass). For M1 also `corepack pnpm exec vitest run --project workers` and
`corepack pnpm benchmark:filters` (medians within 10% of the last recorded run for unchanged
shapes). For UI milestones run `corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001` and
check 1440px and 390px. From the repository root: `node .github/scripts/check-docs.mjs`.

## Validation and Acceptance

- M1: `/?bidsMin=3&bidsMax=3` shows only listings with 3 bids; `/?majesticTfMax=10&sort=majesticTf`
  returns no listing with TF above 10, and its plan uses the TF index (a workerd test with
  `EXPLAIN QUERY PLAN`); the bind-count test passes; every old URL parses to the same filters.
- M2: choosing Desc in the Price header menu navigates to `sort=price&direction=desc&page=1`; hiding
  a column re-renders without a new D1 request (no page request in the network log); resizing still
  works by mouse and keyboard; the Domain column and header stay sticky.
- M3: pin Price left, move Bids right, reload: the layout is unchanged and the URL has no layout
  parameter; a second browser profile shows the default layout.
- M4: adding "Price ≤ 500" from the Filters button navigates to `priceMax=500&page=1`; typing a value
  sends no request until Enter or blur; Clear all removes every rule and keeps the sort.
- All: phones at 390px show the list, not the table; DR spinners resolve; the Ahrefs link is visible
  next to DR; `design-tokens.test.ts` passes; coverage stays 100%.

## Idempotence and Recovery

Every milestone is a separate pull request into `staging` and can be reverted alone. M1 adds only
optional parameters, so reverting it leaves old links valid. The new cookie is ignored by older code
and reset by the Columns menu; a malformed value parses to the default layout. No migration is
planned; if M1's plans show a needed index, stop and record it here before adding one (index writes
cost D1 rows on every sync).

## Artifacts and Notes

Preview inspected: `https://shadcnstudio.com/preview/blocks/base/datatable/datatable-example/
datatable-example-01` and its JavaScript chunks, 2026-10-08. Licence: `https://shadcnstudio.com/
license` (last updated 2026-01-13). Nothing from the block is stored in this repository.

## Interfaces and Dependencies

No new packages. Stock components already present: Dropdown Menu (Sub, Checkbox items), Popover,
Command, Select, Input, Input Group, Combobox, Badge, Button, Table, Tooltip. New interfaces:
`filter-rules.ts` (`Rule`, `rulesFromFilters`, `applyRule`) and the `column-layout` cookie helpers in
`table-columns.ts`. `queryDomainListingsWithDatabase` keeps its signature.

Revision note, 2026-10-08: first version, written after the registry refused an unlicensed install.
